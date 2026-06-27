// Shared per-turn timing contract (ADR-010). The extension re-declares this
// same shape in its types — this file is the source of truth.

export type LatencyTrace = {
  sttMs: number
  aiMs: number
  ttsMs: number
  networkMs: number
  totalMs: number
}

export async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = performance.now()
  const value = await fn()
  const ms = Math.round(performance.now() - start)

  return { value, ms }
}
