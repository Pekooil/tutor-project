import 'server-only'
import OpenAI, { toFile } from 'openai'

// The only call site for the OpenAI SDK (ADR-010) — the route never imports
// `openai` directly. Audio is held only in memory and handed straight to
// Whisper; nothing here touches fs/Blob/DB (ADR-011).

function createClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set — Whisper transcription cannot run without it.')
  }

  return new OpenAI({ apiKey })
}

export async function transcribe({
  audio,
  mimeType,
}: {
  audio: ArrayBuffer | Uint8Array
  mimeType: string
}): Promise<{ transcript: string }> {
  const file = await toFile(audio, 'utterance', { type: mimeType })

  const response = await createClient().audio.transcriptions.create({
    model: 'whisper-1',
    file,
  })

  return { transcript: response.text }
}
