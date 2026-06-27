import 'server-only'

// Plain server-side fetch to the ElevenLabs streaming TTS endpoint (ADR-010
// — fetch is acceptable in place of the SDK). The only call site for
// ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID; no persistence, the audio stream
// is relayed straight through to the caller.

// Overridable for tests (voice.test.ts points this at a local fake server,
// mirroring how @anthropic-ai/sdk and openai read ANTHROPIC_BASE_URL /
// OPENAI_BASE_URL); unset in production, so this defaults to the real API.
const ELEVENLABS_TTS_URL = process.env.ELEVENLABS_API_BASE_URL ?? 'https://api.elevenlabs.io/v1/text-to-speech'
const MODEL_ID = 'eleven_flash_v2_5'

export async function synthesize({ text }: { text: string }): Promise<ReadableStream<Uint8Array>> {
  const apiKey = process.env.ELEVENLABS_API_KEY
  const voiceId = process.env.ELEVENLABS_VOICE_ID

  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY is not set — TTS cannot run without it.')
  }
  if (!voiceId) {
    throw new Error('ELEVENLABS_VOICE_ID is not set — TTS cannot run without it.')
  }

  const response = await fetch(`${ELEVENLABS_TTS_URL}/${voiceId}/stream`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({ text, model_id: MODEL_ID }),
  })

  if (!response.ok || !response.body) {
    throw new Error(`ElevenLabs TTS request failed with status ${response.status}`)
  }

  return response.body
}
