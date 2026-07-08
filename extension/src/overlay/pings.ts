import type { StatusPin, StatusPinKind } from '../types/messages';

// The ping system's pure display logic (design handoff section 8b, the
// "sixteen signals, three tones" redesign of ADR-034's status pins). The
// pins themselves -- kinds, labels, the priority/cap/dedupe gate -- are
// unchanged; this module only maps each kind onto the design's three toast
// TONES and decides which pins ALSO settle into the transcript as milestone
// markers. Pure data + string derivation, no React/chrome.* dependency
// (the voice-timing.ts / session-flow.ts precedent) so pings.test.ts can
// pin it directly.

// The design's three tones (8b): sage for wins, neutral for the tutor's own
// teaching moves, amber for watch-outs. Each maps to a cx-ping-<tone> class
// in Overlay.css whose colors are theme.css's --calyxa-ping-* tokens.
export type PingTone = 'positive' | 'adjust' | 'watch';

// Kind -> tone, per the 8b catalog. Tone is a KIND property, not a category
// one -- the same category splits ("Increasing guidance" is a neutral
// teaching move; "Less guidance needed" is a win). The three kinds the 8b
// table doesn't list (progress, streak-progress, due-review -- server kinds
// that predate the design) map by the same rule: earned = positive,
// tutor-initiated context = adjust.
export const PIN_TONE: Record<StatusPinKind, PingTone> = {
  'prediction-confirmed': 'watch',
  'misconception-detected': 'watch',
  'pattern-detected': 'watch',
  'pattern-broken': 'positive',
  'streak-progress': 'positive',
  'concept-understood': 'positive',
  progress: 'positive',
  'final-step': 'positive',
  'teaching-visual': 'adjust',
  'teaching-decompose': 'adjust',
  'pace-up': 'adjust',
  'guidance-up': 'adjust',
  'guidance-down': 'positive',
  'difficulty-up': 'positive',
  'difficulty-down': 'adjust',
  callback: 'adjust',
  'due-review': 'adjust',
  'confidence-up': 'positive',
  'self-caught': 'positive',
};

// Which pins settle into the transcript as milestone markers after the
// toast fades (8a: "milestones persist after the ping toast fades" -- the
// markers ARE the progress, replacing the retired progress bar). Exactly
// the three the design board shows: the amber new-misconception marker and
// the two sage wins. Every other kind is toast-only -- a teaching move or a
// pace change is context, not a milestone.
export const MILESTONE_KINDS: ReadonlySet<StatusPinKind> = new Set<StatusPinKind>([
  'misconception-detected',
  'concept-understood',
  'pattern-broken',
]);

// The marker's one-line copy. The server's pin labels use a colon between
// the event and its subject ("Pattern broken: sign errors", events.ts);
// the design's markers use a middle dot ("✓ Pattern broken · formula-
// first") -- same content, calmer typography. Only the FIRST colon is a
// separator; any later one is the subject's own text.
export function milestoneLine(pin: Pick<StatusPin, 'label'>): string {
  return pin.label.replace(': ', ' · ');
}

// What a committed milestone carries on its DisplayMessage (Overlay.tsx
// attaches this at the same moment the pin queues; Transcript.tsx renders
// the marker row from it; stripHistory drops the whole entry from the wire).
export type MilestoneMeta = {
  kind: StatusPinKind;
  tone: PingTone;
  line: string;
};
