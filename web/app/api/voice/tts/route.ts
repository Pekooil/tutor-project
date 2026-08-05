import { NextResponse } from 'next/server'
import { clientFromBearer } from '@/lib/auth/bearer'
import { synthesize } from '@/lib/voice/elevenlabs'
import { timed } from '@/lib/voice/latency'
import { costGuard } from '@/lib/tier/cost-guard'
import { userOverFreeCap } from '@/lib/tier/session-gate'
import { voiceCreditGuard } from '@/lib/tier/voice-credit'
import { estimateCost } from '@/lib/tier/cost-model'

// No persistence, no DB write — the synthesized audio stream is relayed
// straight through to the caller.

// A generous cap for a single Socratic reply; bounds abuse, not normal usage.
const MAX_TEXT_LENGTH = 2000

export async function POST(request: Request) {
  const auth = await clientFromBearer(request)

  if ('error' in auth) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const text = typeof body?.text === 'string' ? body.text.trim() : ''

  if (!text || text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json(
      { error: 'text must be a non-empty string up to 2000 characters.' },
      { status: 400 }
    )
  }

  // Sprint 16 / Task 3 (ADR-041): the global cost guard, before the
  // ElevenLabs call. Either cap crossed degrades this leg to text — see
  // voice/stt/route.ts's identical guard for the fail-open contract.
  //
  // Public launch (2026-07-18): the per-free-user monthly voice credit
  // (migration 0023) rides in PARALLEL, same as voice/stt/route.ts.
  const estimatedCents = estimateCost('elevenlabs_tts', text.length)
  const [{ softExceeded, hardExceeded }, voiceCredit, overFreeCap] = await Promise.all([
    costGuard(auth.supabase, estimatedCents),
    voiceCreditGuard(auth.supabase, estimatedCents),
    userOverFreeCap(auth.supabase, auth.user.id),
  ])

  // Free monthly session cap: a free user past their allowance must generate
  // NO provider cost anywhere, not just on tutoring turns. The turn routes
  // already refuse via sessionOverFreeCap, but this leg was reachable
  // independently — the extension calls /api/voice/tts directly — so an
  // over-cap user could still bill ElevenLabs. Degrade-to-text, the same
  // contract as the cost caps, so the overlay needs no new branch. Rides the
  // parallel read above; Pro and comp accounts never reach here (the tier
  // predicate inside userOverFreeCap).
  if (overFreeCap) {
    return NextResponse.json({ degraded: true, degradedCap: 'free_limit' })
  }

  if (softExceeded || hardExceeded) {
    // `degradedCap` (Sprint 18 Task 8, ADR-043): telemetry support so the
    // extension can emit `degraded_hit.cap`. Hard takes precedence when both
    // are crossed. No change to the degrade-to-text behavior.
    return NextResponse.json({ degraded: true, degradedCap: hardExceeded ? 'hard' : 'soft' })
  }

  if (voiceCredit.exceeded) {
    // Same degrade-to-text contract; distinct tag so telemetry separates the
    // global caps from a free user's spent monthly voice credit.
    return NextResponse.json({ degraded: true, degradedCap: 'voice_credit' })
  }

  try {
    const { value: audioStream, ms } = await timed(() => synthesize({ text }))
    return new NextResponse(audioStream, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'x-tts-ms': String(ms),
      },
    })
  } catch (error) {
    // Server-side terminal only — never relay the provider's error text or
    // any key material to the client (the response below stays generic).
    console.error('voice/tts: ElevenLabs call failed', error)
    return NextResponse.json({ error: 'Could not generate audio right now.' }, { status: 502 })
  }
}
