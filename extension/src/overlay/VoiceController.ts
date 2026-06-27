// Mic-capture helper for push-to-talk voice turns (ADR-010 / ADR-011).
//
// Presentational/browser-only: no chrome.* APIs, no persistence. Captures
// exactly ONE utterance per call -- start on mic-button press, stop on
// release -- with no VAD/endpointing this sprint (push-to-talk IS the
// end-of-speech signal). The mic track is stopped and released immediately
// after each utterance (in stop() and in cancel()), never held open between
// turns (ADR-011).

export type Utterance = {
  bytes: ArrayBuffer;
  mimeType: string;
};

export type RecordingHandle = {
  /** Stops capture and resolves the utterance recorded since start. */
  stop: () => Promise<Utterance>;
  /** Aborts capture without resolving an utterance (e.g. on unmount). */
  cancel: () => void;
};

// Whisper's supported formats include webm (the locked stack's STT target —
// see ADR-010); Chrome's MediaRecorder already defaults to this for audio,
// requesting it explicitly is just defensive.
const PREFERRED_MIME_TYPE = 'audio/webm';

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return MediaRecorder.isTypeSupported(PREFERRED_MIME_TYPE) ? PREFERRED_MIME_TYPE : undefined;
}

/**
 * Requests the microphone and starts recording immediately. Throws a
 * caller-friendly error -- distinguishing "no API" from "permission denied"
 * -- so the overlay can surface a clear notice and fall back to text.
 */
export async function startRecording(): Promise<RecordingHandle> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new Error('Microphone is not available in this browser.');
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    throw new Error('Microphone permission was denied.');
  }

  const chunks: BlobPart[] = [];
  const mimeType = pickMimeType();
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });

  function release(): void {
    stream.getTracks().forEach((track) => track.stop());
  }

  recorder.start();

  return {
    stop: () =>
      new Promise<Utterance>((resolve, reject) => {
        if (recorder.state === 'inactive') {
          reject(new Error('Recording already stopped.'));
          return;
        }
        recorder.addEventListener(
          'stop',
          () => {
            release();
            const resolvedMimeType = recorder.mimeType || mimeType || PREFERRED_MIME_TYPE;
            const blob = new Blob(chunks, { type: resolvedMimeType });
            blob
              .arrayBuffer()
              .then((bytes) => resolve({ bytes, mimeType: resolvedMimeType }))
              .catch(reject);
          },
          { once: true },
        );
        recorder.stop();
      }),
    cancel: () => {
      if (recorder.state !== 'inactive') recorder.stop();
      release();
    },
  };
}
