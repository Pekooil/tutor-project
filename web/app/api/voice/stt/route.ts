import { NextResponse } from 'next/server'
import { clientFromBearer } from '@/lib/auth/bearer'
import { transcribe } from '@/lib/voice/whisper'
import { timed } from '@/lib/voice/latency'
import { costGuard } from '@/lib/tier/cost-guard'
import { voiceCreditGuard } from '@/lib/tier/voice-credit'
import { estimateCost } from '@/lib/tier/cost-model'
import { userOverFreeCap } from '@/lib/tier/session-gate'

// No storage/Blob/DB import in this module (ADR-011) — the request body is
// held only as an in-memory ArrayBuffer and handed straight to Whisper. This
// route writes nothing to disk or the database and returns only the
// transcript, never the audio.

// Push-to-talk utterances are short; this just bounds abuse/budget, not a
// realistic recording length. Kept well under proxy.ts's 10MB body-size
// ceiling (Next.js's default `proxyClientMaxBodySize`) — a body over that
// ceiling is silently truncated before this route ever sees it, so this cap
// must stay lower than 10MB or an oversized upload would be truncated to
// "fits" instead of rejected (found in Task 4's oversized-body test).
const MAX_AUDIO_BYTES = 5 * 1024 * 1024

export async function POST(request: Request) {
  const auth = await clientFromBearer(request)

  if ('error' in auth) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const mimeType = request.headers.get('content-type')

  if (!mimeType || !mimeType.startsWith('audio/')) {
    return NextResponse.json({ error: 'An audio/* Content-Type is required.' }, { status: 400 })
  }

  const audio = await request.arrayBuffer().catch(() => null)

  if (!audio || audio.byteLength === 0) {
    return NextResponse.json({ error: 'Audio body must not be empty.' }, { status: 400 })
  }

  if (audio.byteLength > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'Audio body is too large.' }, { status: 400 })
  }

  // Sprint 16 / Task 3 (ADR-041): the global cost guard, before the Whisper
  // call. Either cap crossed degrades this leg to text — the client is
  // expected to fall back rather than retry voice for this turn (see
  // web/lib/tier/cost-guard.ts's fail-open note: an RPC error here proceeds
  // as under-cap, never blocking transcription on a guard-layer hiccup).
  //
  // Public launch (2026-07-18): the per-free-user monthly voice credit
  // (migration 0023) rides the same round trip in PARALLEL — no added
  // latency on the voice-critical path. Both guards fail open independently.
  const estimatedCents = estimateCost('whisper_stt', audio.byteLength)
  const [{ softExceeded, hardExceeded }, voiceCredit, overFreeCap] = await Promise.all([
    costGuard(auth.supabase, estimatedCents),
    voiceCreditGuard(auth.supabase, estimatedCents),
    userOverFreeCap(auth.supabase, auth.user.id),
  ])

  // Free monthly session cap: see the identical guard in voice/tts/route.ts.
  // A free user past their allowance must bill no provider anywhere, and this
  // leg is reachable on its own (the extension posts audio here directly), so
  // without this an over-cap user could still spend Whisper budget. Same
  // degrade-to-text contract as the cost caps. Pro and comp accounts never
  // reach here (userOverFreeCap's tier predicate).
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
    // Same degrade-to-text contract as the global caps; the distinct cap tag
    // lets telemetry separate "the fleet is hot" from "this free user spent
    // their monthly voice credit".
    return NextResponse.json({ degraded: true, degradedCap: 'voice_credit' })
  }

  try {
    const { value, ms } = await timed(() => transcribe({ audio, mimeType }))
    return NextResponse.json({ transcript: value.transcript, sttMs: ms })
  } catch (error) {
    // Server-side terminal only — never relay the provider's error text or
    // any key material to the client (the response below stays generic).
    console.error('voice/stt: Whisper call failed', error)
    return NextResponse.json({ error: 'Could not transcribe audio right now.' }, { status: 502 })
  }
}
