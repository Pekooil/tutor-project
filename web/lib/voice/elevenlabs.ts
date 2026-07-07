import 'server-only'

// Plain server-side fetch to the ElevenLabs streaming TTS endpoint (ADR-010
// — fetch is acceptable in place of the SDK). The only call site for
// ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID; no persistence, the audio stream
// is relayed straight through to the caller.

// Overridable for tests (voice.test.ts points this at a local fake server,
// mirroring how @anthropic-ai/sdk and openai read ANTHROPIC_BASE_URL /
// OPENAI_BASE_URL); unset in production, so this defaults to the real API.
const ELEVENLABS_TTS_URL = process.env.ELEVENLABS_API_BASE_URL ?? 'https://api.elevenlabs.io/v1/text-to-speech'

// Pinned explicitly (Sprint 15 Task 7, ADR-033): a request that omits
// model_id/voice_settings gets ElevenLabs' PROVIDER-SIDE DEFAULTS, which can
// change over time (a model deprecation, a default-settings tweak on their
// end) and shift how the same configured voice sounds with no change on our
// side at all -- exactly the silent-drift shape the wrong-voice defect
// investigation named as a prime suspect (see this file's ADR-033 amendment
// box). Named constants, not inline literals, so tuning either later is a
// one-line reviewable diff. stability/similarity_boost/style/use_speaker_boost
// are ElevenLabs' own documented default values -- pinning them is about
// removing drift risk, not retuning the voice's character.
const MODEL_ID = 'eleven_flash_v2_5'
const VOICE_SETTINGS = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0,
  use_speaker_boost: true,
} as const

// Deliberately lenient about the exact ID SHAPE -- real ElevenLabs voice ids
// observed today are a 20-char alphanumeric string, but nothing guarantees
// that never changes (a custom/cloned voice, a future id format), and
// voice.test.ts's local fake-provider fixture intentionally uses a
// hyphenated placeholder id since its fake server never validates the id at
// all. This only rejects the unambiguous failure modes: unset, empty, too
// short to plausibly be a real id, or containing whitespace (a common
// copy-paste mistake from an env file or dashboard).
const MIN_VOICE_ID_LENGTH = 8

/**
 * Fails at MODULE LOAD (this file's first import), not at the first student
 * turn's synthesize() call -- an unset or malformed ELEVENLABS_VOICE_ID
 * should surface as a boot-time crash the deploy pipeline catches, never as
 * a live turn that silently plays the wrong voice (or, before this task, an
 * unset id that only threw once a student actually spoke). This is the
 * ADR-033 Decision 3 "fail loud, never fall back" rule applied to the
 * likeliest cause class this task's diagnosis named: env drift between
 * environments landing an empty/wrong value here.
 */
function assertVoiceIdWellFormed(voiceId: string | undefined): asserts voiceId is string {
  if (!voiceId || voiceId.length < MIN_VOICE_ID_LENGTH || /\s/.test(voiceId)) {
    throw new Error(
      `ELEVENLABS_VOICE_ID is missing or malformed (${JSON.stringify(voiceId)}) -- refusing to start. Set a real ElevenLabs voice id in this environment before any voice route is called.`,
    )
  }
}

assertVoiceIdWellFormed(process.env.ELEVENLABS_VOICE_ID)

export async function synthesize({ text }: { text: string }): Promise<ReadableStream<Uint8Array>> {
  const apiKey = process.env.ELEVENLABS_API_KEY
  // Asserted present + well-formed at module load, above -- re-reading here
  // (rather than closing over the module-load value) still picks up a
  // same-process env change in a test/dev reload, same discipline as the
  // apiKey read on the next line.
  const voiceId = process.env.ELEVENLABS_VOICE_ID!

  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY is not set — TTS cannot run without it.')
  }

  // Per-request diagnostic (Sprint 15 Task 7): the exact voice_id/model_id
  // actually sent on the wire, and nothing else -- never the student's text.
  // This is the reproduction aid the wrong-voice investigation needed; the
  // ADR-033 amendment box records what (if anything) it found live.
  console.debug('voice/tts: synthesizing', { voiceId, modelId: MODEL_ID })

  const response = await fetch(`${ELEVENLABS_TTS_URL}/${voiceId}/stream`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({ text, model_id: MODEL_ID, voice_settings: VOICE_SETTINGS }),
  })

  if (!response.ok || !response.body) {
    throw new Error(`ElevenLabs TTS request failed with status ${response.status}`)
  }

  return response.body
}
