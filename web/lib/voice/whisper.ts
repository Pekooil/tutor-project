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

// Whisper infers the audio format from the upload's filename extension, not
// just its Content-Type — an extensionless filename risks a 400 even with a
// correct mimeType.
function filenameForMimeType(mimeType: string): string {
  const subtype = mimeType.split(';')[0].split('/')[1] ?? 'webm'
  return `utterance.${subtype}`
}

export async function transcribe({
  audio,
  mimeType,
}: {
  audio: ArrayBuffer | Uint8Array
  mimeType: string
}): Promise<{ transcript: string }> {
  const file = await toFile(audio, filenameForMimeType(mimeType), { type: mimeType })

  // Same OpenAI transcription endpoint ("OpenAI Whisper API" per the locked
  // stack), but the gpt-4o-mini-transcribe model, not whisper-1. Task 7's
  // 20-trial measurement showed whisper-1 batch latency (~1.7s) as the dominant
  // leg blowing the <2.5s budget; gpt-4o-mini-transcribe is materially faster on
  // short push-to-talk clips. Recorded in the ADR-010 amendment (2026-06-27).
  const response = await createClient().audio.transcriptions.create({
    model: 'gpt-4o-mini-transcribe',
    file,
  })

  return { transcript: response.text }
}
