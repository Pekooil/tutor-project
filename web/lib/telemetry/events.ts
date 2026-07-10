// Sprint 17 / Task 4 (ADR-043): the product-telemetry event union. Pure (no
// server-only, no Supabase, no Anthropic) -- like item-bank.ts, this is a
// plain data/validation module so it stays directly unit-testable and, per
// ADR-043, so its no-free-text guarantee is a property of the TYPES, not a
// review convention. Every variant below is built from numbers, booleans, and
// closed string-literal enums only -- there is no field a caller could put a
// transcript, a page URL, or student/tutor text into without changing this
// file (and tripping Task 8's telemetry.test.ts).
//
// Session first-vs-nth-ness is deliberately NOT a field here: it is a
// service-role analysis-time count over `session_started` rows per user, kept
// out of the wire event so the client never needs to know (or report) its own
// session index.

export type SessionMode = 'voice' | 'text'
export type DegradedCap = 'soft' | 'hard'
// Mirrors web/lib/tier/cost-model.ts's CostKind (Sprint 16, ADR-041) by NAME
// only -- deliberately not imported, so this module carries no dependency on
// Sprint 16's cost internals (out of scope per sprint-17-plan.md).
export type DegradedSource = 'claude_turn' | 'whisper_stt' | 'elevenlabs_tts'

export type TelemetryEvent =
  // Onboarding funnel (ADR-042): fired once, on completion (not on skip -- a
  // skip is simply the absence of this event, same discipline as
  // session_started below).
  | { kind: 'onboarding_completed'; itemCount: number; ms: number }
  // Funnel + usage-rate signal: one per session start.
  | { kind: 'session_started'; mode: SessionMode }
  // The Sprint 15 LatencyTrace (web/lib/voice/latency.ts), finally sent
  // somewhere (ADR-043) -- same five fields, unit-for-unit.
  | { kind: 'turn_latency'; sttMs: number; aiMs: number; ttsMs: number; networkMs: number; totalMs: number }
  // `fallback`: whether resolution needed the bbox last-resort anchor
  // (ADR-022's resolver chain) for any annotation in this turn -- a
  // content-free legibility signal, never the annotation's own text/target.
  | { kind: 'annotation_rendered'; count: number; fallback: boolean }
  // Usage-rate signal: fired once per turn that actually used voice I/O.
  | { kind: 'voice_used' }
  // Sprint 16's cost-guardrail (ADR-041) soft/hard cap firing -- the
  // "degraded-hit rate" this sprint's handoff names as a beta health signal.
  | { kind: 'degraded_hit'; cap: DegradedCap; source: DegradedSource }

export type TelemetryEventKind = TelemetryEvent['kind']

// Per-kind field spec: every field is a number, a boolean, or a closed
// string-literal enum -- deliberately no 'string' catch-all anywhere in this
// table, since an unconstrained string field is exactly the shape a future
// free-text field would sneak in as.
type FieldSpec = 'number' | 'boolean' | { enum: readonly string[] }

const SESSION_MODES: readonly SessionMode[] = ['voice', 'text']
const DEGRADED_CAPS: readonly DegradedCap[] = ['soft', 'hard']
const DEGRADED_SOURCES: readonly DegradedSource[] = ['claude_turn', 'whisper_stt', 'elevenlabs_tts']

const EVENT_FIELD_SPECS: Record<TelemetryEventKind, Record<string, FieldSpec>> = {
  onboarding_completed: { itemCount: 'number', ms: 'number' },
  session_started: { mode: { enum: SESSION_MODES } },
  turn_latency: { sttMs: 'number', aiMs: 'number', ttsMs: 'number', networkMs: 'number', totalMs: 'number' },
  annotation_rendered: { count: 'number', fallback: 'boolean' },
  voice_used: {},
  degraded_hit: { cap: { enum: DEGRADED_CAPS }, source: { enum: DEGRADED_SOURCES } },
}

function matchesSpec(value: unknown, spec: FieldSpec): boolean {
  if (spec === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (spec === 'boolean') return typeof value === 'boolean'
  return typeof value === 'string' && spec.enum.includes(value)
}

// Validates an unknown value against the union, structurally: an unknown
// `kind` is rejected, and so is any object carrying a property outside that
// kind's exact field set (whether mistyped or simply extra) -- this is what
// makes "an event with an unexpected string field" (e.g. a smuggled
// transcript/note) rejected at the boundary rather than merely undocumented.
// The route (`/api/telemetry`) calls this per-event before ever inserting.
export function validateEvent(value: unknown): value is TelemetryEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false

  const record = value as Record<string, unknown>
  const kind = record.kind

  if (typeof kind !== 'string' || !(kind in EVENT_FIELD_SPECS)) return false

  const spec = EVENT_FIELD_SPECS[kind as TelemetryEventKind]
  const expectedKeys = Object.keys(spec)
  const actualKeys = Object.keys(record).filter((key) => key !== 'kind')

  if (actualKeys.length !== expectedKeys.length) return false
  if (!actualKeys.every((key) => key in spec)) return false

  return expectedKeys.every((key) => matchesSpec(record[key], spec[key]))
}
