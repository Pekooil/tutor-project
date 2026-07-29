// The v4 homework session's wire/storage shapes. Pure types only -- no
// React, no chrome.*, no DOM -- so the reducer, the reaction engine, the
// opener builder, and the summary all compile in a bare vitest environment
// (the session-flow.ts / voice-timing.ts precedent).

/** What one tap records. `tutored` is written on TUTORING EXIT, not on tap. */
export type Outcome = 'ok' | 'shaky' | 'tutored';

/** The page's own verdict for a problem, when the page exposes one. */
export type PageGrade = 'correct' | 'incorrect';

export type CompletedProblem = {
  /** Sequence position within the confirmed denominator, 0-based. */
  index: number;
  /** The problem's printed label at scan time ("5", "3b"). */
  label: string;
  outcome: Outcome;
  /** Wall-clock seconds spent on this problem, blur-pauses excluded. */
  seconds: number;
  /** Present only when the page exposed correctness for this problem. */
  pageGrade?: PageGrade;
};

/**
 * One problem in the confirmed set. `snippet` is what the tutoring handoff
 * quotes; the live Element is NOT here -- elements can't serialize and by
 * design never cross the messaging boundary or persist (ADR-023). The
 * content script holds the parallel element registry, exactly as
 * pageExtractor/annotations already do for equations.
 */
export type SetProblem = {
  label: string;
  snippet: string;
  /** Index into the ORIGINAL page enumeration (so "odds" keeps its identity). */
  sourceIndex: number;
};

/** The persisted, resumable state of one homework session. */
export type HomeworkSession = {
  id: string;
  /** origin + pathname. Resume is offered only on an exact match (spec §7). */
  locationKey: string;
  /** Display-only page title, for the resume chip. */
  pageTitle: string | null;
  /** Null whenever the concept read was absent or low-confidence (spec §1). */
  concept: string | null;
  /** Frozen at confirmation. A change starts a NEW session (spec §3). */
  denominator: number;
  problems: SetProblem[];
  graded: boolean;
  startedAt: number;
  endedAt: number | null;
  status: 'active' | 'paused' | 'complete';
  completed: CompletedProblem[];
  /**
   * The reaction engine's per-session memory -- persisted so a resume carries
   * cooldowns and the moment cap over rather than handing the student a fresh
   * budget of celebrations (spec §7).
   */
  reactions: ReactionMemory;
  /** Milliseconds of session time banked before the current run segment. */
  accumulatedMs: number;
  /** When the current run segment started (null while paused). */
  runningSince: number | null;
  /** When the clock stopped (null while running) -- the pause-shift reference. */
  pausedAt: number | null;
  /** When the current PROBLEM's clock started, already shifted for pauses. */
  problemStartedAt: number;
};

export type ReactionMemory = {
  /** Moment-tone reactions fired so far, excluding set-complete (cap 3). */
  momentsFired: number;
  /** Timestamp of the last moment-tone reaction, for the 90s cooldown. */
  lastMomentAt: number | null;
  /** Which copy variant each rule last used, so phrasing rotates. */
  variantCursor: Record<string, number>;
  /** Consecutive `ok` outcomes with no `tutored` in between. */
  comboRun: number;
  /** Combo reactions already fired this session (fires at 3, then every 3). */
  combosFired: number;
};

export const EMPTY_REACTION_MEMORY: ReactionMemory = {
  momentsFired: 0,
  lastMomentAt: null,
  variantCursor: {},
  comboRun: 0,
  combosFired: 0,
};

/** One completed set, kept locally as the ONLY source of pace history. */
export type HomeworkHistoryEntry = {
  concept: string | null;
  denominator: number;
  totalSeconds: number;
  endedAt: number;
  /** Longest run of problems completed with no help, within this one set. */
  longestUnaidedRun: number;
};

/**
 * The reaction the UI shows after a tap. `tone` drives the chip's colors and,
 * for `moment` ONLY, the breathing green glow -- that exclusivity is stated in
 * the design and is load-bearing (spec §5: if the glow fires on every tap it
 * stops meaning anything).
 */
export type ReactionTone = 'whisper' | 'moment' | 'review' | 'watch';

export type Reaction = {
  rule: string;
  tone: ReactionTone;
  text: string;
};
