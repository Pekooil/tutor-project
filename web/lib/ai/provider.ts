import 'server-only'
import {
  runTutorTurn,
  runTutorTurnEnvelopeStream,
  runTutorTurnStream,
  runOpeningScanTool,
  type TurnMessage,
  type EnvelopeStreamEvent,
  type OpeningScanResult,
} from './claude'
import {
  runTurnOpenAI,
  runTurnEnvelopeStreamOpenAI,
  runTurnStreamOpenAI,
  runOpeningScanToolOpenAI,
} from './tutor-openai'
import type { SessionStartPrompt } from './system-prompt'
import type { TurnEnvelope } from './envelope'
import type { LearningProfile } from './profile'
import type { PageContext } from './page-context'

// Sprint 24 (ADR-038) — the TutorProvider seam, re-ported onto the forced-tool
// pipeline (Sprint 14/15 redesigns: ENVELOPE_TOOL turns, SESSION_START_TOOL
// kickoff, OPENING_SCAN_TOOL scan-with-classification). Every tutor model call
// the routes make goes through this interface so the two providers are
// swappable per-env in ONE flag (TUTOR_PROVIDER) without touching call sites.
//
// ADR-052 (2026-07-17, Darcy's sign-off): OpenAI GPT-4o-mini is the DEFAULT
// provider; Anthropic (Haiku 4.5) is RETAINED in-tree as the backup + eval
// baseline, selected via TUTOR_PROVIDER=anthropic — the one-env-var rollback.
// @anthropic-ai/sdk stays a dependency for exactly that reason. Envelope
// semantics stay provider-neutral (parseEnvelope / parseEnvelopeObject in
// envelope.ts); only the model mechanics differ per implementation. The
// study-kit generator (web/lib/study/generate.ts) sits outside this seam on
// its own STUDY_KIT_PROVIDER flag (same default, independently flippable).

export type TurnArgs = {
  messages: TurnMessage[]
  pageContext?: PageContext
  profile: LearningProfile
  sessionStart?: SessionStartPrompt
}
export type StreamArgs = {
  messages: TurnMessage[]
  pageContext?: PageContext
  profile: LearningProfile
}
export type OpeningScanArgs = {
  pageContext: PageContext
  profile: LearningProfile
}

export interface TutorProvider {
  runTurn(args: TurnArgs): Promise<TurnEnvelope>
  runTurnEnvelopeStream(args: StreamArgs): AsyncGenerator<EnvelopeStreamEvent>
  runTurnStream(args: StreamArgs): AsyncGenerator<string>
  runOpeningScan(args: OpeningScanArgs): Promise<OpeningScanResult>
}

// --- Anthropic (default) -----------------------------------------------------
// Pure delegation: every method IS the claude.ts function the routes called
// directly before the seam existed, so the Anthropic path stays byte-identical.
const anthropicProvider: TutorProvider = {
  runTurn: (args) => runTutorTurn(args),
  runTurnEnvelopeStream: (args) => runTutorTurnEnvelopeStream(args),
  runTurnStream: (args) => runTutorTurnStream(args),
  runOpeningScan: (args) => runOpeningScanTool(args),
}

// --- OpenAI (opt-in, gated) --------------------------------------------------
const openaiProvider: TutorProvider = {
  runTurn: (args) => runTurnOpenAI(args),
  runTurnEnvelopeStream: (args) => runTurnEnvelopeStreamOpenAI(args),
  runTurnStream: (args) => runTurnStreamOpenAI(args),
  runOpeningScan: (args) => runOpeningScanToolOpenAI(args),
}

// TUTOR_PROVIDER selects the implementation; default 'openai' (ADR-052).
// Read per-call (not memoized) so a test / rollback env can flip it without
// a process restart — TUTOR_PROVIDER=anthropic is the instant flip-back.
export function getTutorProvider(): TutorProvider {
  return process.env.TUTOR_PROVIDER === 'anthropic' ? anthropicProvider : openaiProvider
}

export function activeTutorProviderName(): 'anthropic' | 'openai' {
  return process.env.TUTOR_PROVIDER === 'anthropic' ? 'anthropic' : 'openai'
}
