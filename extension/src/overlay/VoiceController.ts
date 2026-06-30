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
  /**
   * Current mic input level, 0 (silence) to 1 (loud), read live off the
   * captured stream via an AnalyserNode. Polled by the overlay (rAF) to
   * drive the listening waveform so it sits at rest until the user actually
   * makes sound, rather than animating on a fixed loop regardless of input.
   */
  getLevel: () => number;
};

// Chrome's MediaRecorder records webm/opus (its audio default); requesting it
// explicitly is just defensive. We do NOT send that webm to the STT proxy
// directly: the gpt-4o-mini-transcribe model (the ADR-010 latency amendment,
// 2026-06-27) rejects Chrome's MediaRecorder webm/opus as "corrupted or
// unsupported" where the old whisper-1 tolerated it. Instead every utterance
// is normalised to 16-bit PCM WAV in-browser before it leaves stop() (see
// toWavUtterance) — a format the model reliably accepts — so the STT leg works
// with no server-side transcode (Vercel has no ffmpeg) and no model change.
const PREFERRED_MIME_TYPE = 'audio/webm';

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return MediaRecorder.isTypeSupported(PREFERRED_MIME_TYPE) ? PREFERRED_MIME_TYPE : undefined;
}

// Decode whatever the recorder produced (webm/opus on Chrome) with the Web
// Audio API and re-encode it as a canonical 16-bit PCM WAV, the format
// gpt-4o-mini-transcribe accepts. Decoding happens entirely in-browser — no
// network, no persistence (ADR-011). If decoding ever fails, fall back to the
// raw recording rather than dropping the turn (no worse than before).
async function toWavUtterance(recorded: ArrayBuffer, recordedMimeType: string): Promise<Utterance> {
  try {
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return { bytes: recorded, mimeType: recordedMimeType };

    const ctx = new AudioCtx();
    try {
      // decodeAudioData detaches its input buffer, so hand it a copy — the
      // original `recorded` stays usable for the fallback path.
      const audioBuffer = await ctx.decodeAudioData(recorded.slice(0));
      const channels: Float32Array[] = [];
      for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
        channels.push(audioBuffer.getChannelData(c));
      }
      return { bytes: encodeWav(channels, audioBuffer.sampleRate), mimeType: 'audio/wav' };
    } finally {
      void ctx.close();
    }
  } catch {
    return { bytes: recorded, mimeType: recordedMimeType };
  }
}

// Minimal PCM-Float32 -> 16-bit PCM WAV encoder (RIFF/WAVE, format 1). No deps;
// short push-to-talk clips only, so a single contiguous buffer is fine.
function encodeWav(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const numChannels = channels.length;
  const numFrames = channels[0]?.length ?? 0;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // audio format: PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let off = 44;
  for (let f = 0; f < numFrames; f++) {
    for (let c = 0; c < numChannels; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][f]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }

  return buffer;
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

  // Live level metering, separate from the MediaRecorder pipeline above: an
  // AnalyserNode tapped off the same stream, read on demand (no persistence,
  // ADR-011 — this never touches the recorded bytes). RMS of the time-domain
  // samples is a cheap, good-enough loudness proxy for a waveform; the 4x
  // gain compensates for speech RMS normally sitting well under 1.
  const AudioCtx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  const meterCtx = AudioCtx ? new AudioCtx() : null;
  let getLevel: () => number = () => 0;
  if (meterCtx) {
    const source = meterCtx.createMediaStreamSource(stream);
    const analyser = meterCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);
    const samples = new Uint8Array(analyser.frequencyBinCount);
    getLevel = () => {
      analyser.getByteTimeDomainData(samples);
      let sumSquares = 0;
      for (let i = 0; i < samples.length; i++) {
        const normalized = (samples[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / samples.length);
      return Math.min(1, rms * 4);
    };
  }

  function release(): void {
    stream.getTracks().forEach((track) => track.stop());
    void meterCtx?.close();
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
              .then((recorded) => toWavUtterance(recorded, resolvedMimeType))
              .then(resolve)
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
    getLevel,
  };
}
