import type { CompletedProblem, Outcome, Reaction, ReactionMemory, ReactionTone } from './types';

// The reaction vocabulary (spec §5). A RULES ENGINE, deliberately not the
// prototype's `vocab(n)` switch: that hardcodes one good script for one
// 8-problem set, and real assignments are 3 problems or 25.
//
// Every rule evaluates client-side, synchronously, with ZERO model calls, and
// every string is templated rather than generated. That is what keeps the
// working portion of a session free and instant (spec §10).

/** Firing order, verbatim from the spec. Lower fires first. */
const RULE_PRIORITY = [
  'set-complete',
  'combo',
  'misconception',
  'halfway',
  'near-end',
  'effort',
  'shaky',
  'default',
] as const;

export type RuleName = (typeof RULE_PRIORITY)[number];

/** Spec §5: a moment may not fire within 90s of the previous one. */
export const MOMENT_COOLDOWN_MS = 90_000;
/** Spec §5: at most 3 moment-tone reactions per session, excluding set complete. */
export const MAX_MOMENTS_PER_SESSION = 3;
/** Spec §5: halfway and near-the-end are noise on a short set. */
export const MIN_DENOMINATOR_FOR_POSITION_RULES = 6;
/** The effort rule needs a median worth comparing against. */
const MIN_SAMPLES_FOR_EFFORT = 3;

type Candidate = { rule: RuleName; tone: ReactionTone; variants: string[] };

export type ReactionInput = {
  /** The outcome just recorded. */
  outcome: Outcome;
  /** Seconds spent on the problem just completed. */
  seconds: number;
  /** Every completion so far INCLUDING the one just recorded. */
  completed: readonly CompletedProblem[];
  denominator: number;
  memory: ReactionMemory;
  /**
   * A misconception the student has logged for the NEXT problem's concept,
   * keyed by sequence index. Empty in slice 1: the just-in-time rule needs
   * BOTH mastery data for the concept and a confident problem-to-concept
   * mapping, and nothing client-side produces the second one yet. The rule is
   * built and tested; it stays silent rather than guessing (spec §2's "Omit
   * whenever either is missing. Never show a placeholder.").
   */
  flaggedProblems?: Readonly<Record<number, string>>;
  /** Label of the next problem, for the just-in-time rule's copy. */
  nextLabel?: string | null;
  now: number;
};

export type ReactionOutput = { reaction: Reaction; memory: ReactionMemory };

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Rounded to whole minutes, floored at 1 -- "0 minutes on that one" is absurd. */
function minutesOf(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}

/**
 * Advances the combo run. A `tutored` outcome BREAKS it -- the spec's combo is
 * "3+ consecutive ok with no tutored in between", and a shaky is honest
 * self-report rather than help, so it breaks the run of `ok` too (it simply
 * isn't an `ok`).
 */
function nextComboRun(previous: number, outcome: Outcome): number {
  return outcome === 'ok' ? previous + 1 : 0;
}

function candidatesFor(input: ReactionInput, comboRun: number): Candidate[] {
  const { outcome, seconds, completed, denominator, memory, flaggedProblems, nextLabel } = input;
  const done = completed.length;
  const remaining = denominator - done;
  const out: Candidate[] = [];

  if (done >= denominator) {
    out.push({ rule: 'set-complete', tone: 'moment', variants: ["That's the set."] });
  }

  // Fires at 3, then every 3 after (6, 9, …) -- never twice for the same run
  // length, which `combosFired` guards across a resume too.
  if (comboRun >= 3 && comboRun % 3 === 0 && comboRun / 3 > memory.combosFired) {
    out.push({
      rule: 'combo',
      tone: 'moment',
      variants: [
        `That's ${comboRun} in a row without help.`,
        `${comboRun} straight, no help.`,
        `${comboRun} in a row — you're on it.`,
      ],
    });
  }

  const flagged = flaggedProblems?.[done];
  if (flagged && remaining > 0) {
    out.push({
      rule: 'misconception',
      tone: 'watch',
      variants: [
        `Heads up — ${nextLabel ? `number ${nextLabel}` : 'the next one'} is the ${flagged} one.`,
        `${nextLabel ? `Number ${nextLabel}` : 'This next one'} is where ${flagged} usually shows up.`,
      ],
    });
  }

  if (denominator >= MIN_DENOMINATOR_FOR_POSITION_RULES) {
    const half = denominator / 2;
    // "Crosses" 50%: the tap that took the count from below half to at-or-above.
    if (done >= half && done - 1 < half) {
      out.push({
        rule: 'halfway',
        tone: 'moment',
        variants: ['Halfway.', 'Halfway there.', "That's the halfway mark."],
      });
    }
    if (remaining === 1) {
      out.push({ rule: 'near-end', tone: 'whisper', variants: ['One left.', 'Last one.'] });
    } else if (remaining === 2) {
      out.push({ rule: 'near-end', tone: 'whisper', variants: ['Two to go.', 'Two left.'] });
    }
  }

  const priorSeconds = completed.slice(0, -1).map((problem) => problem.seconds);
  if (
    (outcome === 'ok' || outcome === 'shaky') &&
    priorSeconds.length >= MIN_SAMPLES_FOR_EFFORT &&
    seconds >= 2 * median(priorSeconds)
  ) {
    const minutes = minutesOf(seconds);
    out.push({
      rule: 'effort',
      tone: 'whisper',
      variants: [
        `${minutes} minutes on that one. It shows.`,
        `That one took ${minutes} minutes — and you got there.`,
        `${minutes} minutes. The hard ones are the ones that stick.`,
      ],
    });
  }

  if (outcome === 'shaky') {
    out.push({
      rule: 'shaky',
      tone: 'review',
      variants: [
        "Noted the shaky — we'll dig into the why after the set.",
        "Marked it shaky. That's the useful kind of honest.",
        'Shaky logged. Worth a second pass later.',
      ],
    });
  }

  out.push({ rule: 'default', tone: 'whisper', variants: defaultVariants(outcome, done) });
  return out;
}

function defaultVariants(outcome: Outcome, done: number): string[] {
  if (outcome === 'tutored') {
    return [
      'Back to the set — that one counts the same as any other.',
      "Worked through. The bar moved just like it would've anyway.",
    ];
  }
  if (done === 1) return ['One down.'];
  if (done === 2) return ['Two for two.', "That's two."];
  return ["That one's in.", 'Next.', 'Down.'];
}

/**
 * Picks EXACTLY ONE reaction per tap -- never two (spec §5's firing
 * discipline). Highest priority among the qualifying rules wins; a moment
 * blocked by the 90s cooldown or the per-session cap is DEMOTED to a whisper
 * rather than dropped, so the tap is still acknowledged.
 *
 * Pure: `memory` goes in, a NEW memory comes out. The caller persists it, so a
 * resume carries cooldowns and the moment budget over (spec §7).
 */
export function pickReaction(input: ReactionInput): ReactionOutput {
  const comboRun = nextComboRun(input.memory.comboRun, input.outcome);
  const candidates = candidatesFor(input, comboRun);
  const chosen =
    candidates.sort((a, b) => RULE_PRIORITY.indexOf(a.rule) - RULE_PRIORITY.indexOf(b.rule))[0];

  const isSetComplete = chosen.rule === 'set-complete';
  const cooldownActive =
    input.memory.lastMomentAt !== null && input.now - input.memory.lastMomentAt < MOMENT_COOLDOWN_MS;
  const capReached = input.memory.momentsFired >= MAX_MOMENTS_PER_SESSION;
  // Set complete is exempt from both the cooldown and the cap: it is the one
  // moment the student has definitionally earned, and it can only fire once.
  const demoted = chosen.tone === 'moment' && !isSetComplete && (cooldownActive || capReached);
  const tone: ReactionTone = demoted ? 'whisper' : chosen.tone;

  const cursor = input.memory.variantCursor[chosen.rule] ?? 0;
  const text = chosen.variants[cursor % chosen.variants.length];

  const firedMoment = tone === 'moment';
  return {
    reaction: { rule: chosen.rule, tone, text },
    memory: {
      comboRun,
      combosFired: chosen.rule === 'combo' ? Math.floor(comboRun / 3) : input.memory.combosFired,
      momentsFired: firedMoment && !isSetComplete ? input.memory.momentsFired + 1 : input.memory.momentsFired,
      lastMomentAt: firedMoment ? input.now : input.memory.lastMomentAt,
      variantCursor: { ...input.memory.variantCursor, [chosen.rule]: cursor + 1 },
    },
  };
}
