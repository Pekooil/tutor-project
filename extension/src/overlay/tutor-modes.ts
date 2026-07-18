import type { StatusPin, StatusPinKind } from '../types/messages';

// Tutor modes (design handoff section 8c, new feature): during a tutoring
// session the live MODE takes the logo's place in the session header --
// "the student always knows what kind of help they're getting" -- and
// Calyxa switches between them on its own. The server emits no mode field;
// the mode is derived CLIENT-SIDE from signals every turn already carries
// (the status pins, the solution-progress movement, the completion signal)
// -- the same display-ephemeral discipline as every other overlay surface:
// nothing here touches the wire, and a session that never fires a signal
// simply stays in Explore.
//
// Pure data + a pure reducer, no React/chrome.* dependency (the
// session-flow.ts precedent) so tutor-modes.test.ts can pin the transition
// table directly. Overlay.tsx owns the state and drives this with real
// turn results.

export type TutorModeKey =
  | 'explore'
  | 'coach'
  | 'build'
  | 'practice'
  | 'challenge'
  | 'verify'
  | 'review'
  | 'recover';

// The header identity's display data. `glyph` is a typographic glyph, never
// an emoji (brand rule) -- the design board's own set. Colors are NOT here:
// each key maps to a cx-mode-<key> class in Overlay.css whose text/bg/
// border values are theme.css's --calyxa-mode-* tokens (ADR-018).
export type TutorMode = {
  key: TutorModeKey;
  name: string;
  glyph: string;
};

export const TUTOR_MODES: Record<TutorModeKey, TutorMode> = {
  explore: { key: 'explore', name: 'Exploring', glyph: '✧' },
  coach: { key: 'coach', name: 'Coaching', glyph: '✚' },
  build: { key: 'build', name: 'Building', glyph: '▲' },
  practice: { key: 'practice', name: 'Practicing', glyph: '●' },
  challenge: { key: 'challenge', name: 'Challenging', glyph: '◆' },
  verify: { key: 'verify', name: 'Verifying', glyph: '✓' },
  review: { key: 'review', name: 'Reviewing', glyph: '↺' },
  recover: { key: 'recover', name: 'Recovering', glyph: '♡' },
};

// What one turn tells the mode reducer. `pins` is the turn's RAW pin list
// (plus the client-derived final-step pin when it fired this turn) -- raw,
// not the display-filtered set, because a signal suppressed by the toast
// dedupe is still real evidence of where the session is. `missStreak` is
// Overlay.tsx's count of consecutive turns whose eased progress moved
// DOWN (easeProgress regression = a wrong step -- the closest client-side
// read of the design's "two misses in a row"); `advanceStreak` is its
// mirror for consecutive UP moves, and `progress` is the turn's eased
// solution progress (ADR-028) -- the momentum inputs added 2026-07-18.
export type TurnSignal = {
  pins: readonly Pick<StatusPin, 'kind'>[];
  missStreak: number;
  advanceStreak: number;
  progress: number;
  complete: boolean;
};

// The kinds that pull the session into Coach ("Enters: a misconception
// fires or hints ramp up") -- every watch-out plus the tutor tightening
// its grip.
const COACH_KINDS: ReadonlySet<StatusPinKind> = new Set<StatusPinKind>([
  'misconception-detected',
  'prediction-confirmed',
  'pattern-detected',
  'guidance-up',
  'teaching-decompose',
  'teaching-visual',
  'difficulty-down',
]);

/**
 * The mode transition table (8c's "Enters:" copy, made deterministic).
 * Checked most-terminal-first so one turn carrying several signals lands on
 * the most significant: a completing turn is Reviewing no matter what else
 * fired; two straight misses force the soft reset; then the earned
 * transitions (verify/challenge/practice/build) outrank the corrective one
 * (coach). A turn with no matching signal keeps the current mode -- the
 * session starts in (and idles at) Explore.
 */
export function deriveTutorMode(current: TutorModeKey, signal: TurnSignal): TutorModeKey {
  const kinds = new Set(signal.pins.map((pin) => pin.kind));
  if (signal.complete) return 'review';
  if (signal.missStreak >= 2) return 'recover';
  if (kinds.has('final-step')) return 'verify';
  if (kinds.has('difficulty-up')) return 'challenge';
  if (kinds.has('pattern-broken') || kinds.has('guidance-down')) return 'practice';
  if (kinds.has('concept-understood')) return 'build';
  for (const kind of kinds) {
    if (COACH_KINDS.has(kind)) return 'coach';
  }

  // ---- Momentum transitions (2026-07-18, Darcy's ask) ----
  // The signal-driven table above fires only when the model emits an explicit
  // pin, which real sessions do rarely -- so the mode sat in Explore (idle
  // default) or Coach (the broad corrective set) most of the time. When a
  // quiet turn carries no pin, the mode now follows the arc of the SOLUTION
  // itself, from inputs every turn already has: eased progress and its
  // movement. The ladder mirrors the earned order above -- Explore climbs to
  // Build once real steps land, Build to Practice past mid-solution, anything
  // to Verify in the final stretch -- and one good step climbs OUT of the
  // corrective modes (coach/recover -> build). Pins still outrank momentum:
  // a misconception at 90% progress is Coaching, not Verifying.
  if (signal.progress >= STAGE_3_THRESHOLD) return 'verify';
  if (signal.advanceStreak >= 1 && (current === 'coach' || current === 'recover')) return 'build';
  if (signal.advanceStreak >= 2 && signal.progress >= STAGE_2_THRESHOLD) return 'practice';
  if (signal.advanceStreak >= 2 && current === 'explore') return 'build';
  return current;
}

// ---- The header subtitle's stage label (8a: "Stage 1 of 3 · spot the
// shortcut" -> ... -> "Stage 3 of 3 · proven") ----

// Thirds of the eased solution progress (ADR-028's client-clamped signal --
// already the overlay's one honest "how far along is this problem" read).
// STAGE_3 matches Overlay.tsx's FINAL_STEP_THRESHOLD: the same crossing
// that pins "Final step" advances the label to its last stage.
export const STAGE_2_THRESHOLD = 0.35;
export const STAGE_3_THRESHOLD = 0.85;

export function stageLabel(progress: number, complete: boolean): string {
  if (complete || progress >= STAGE_3_THRESHOLD) return 'Stage 3 of 3';
  if (progress >= STAGE_2_THRESHOLD) return 'Stage 2 of 3';
  return 'Stage 1 of 3';
}

// ---- The header clock (8a: live m:ss with the breathing dot) ----

export function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
