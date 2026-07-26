// The ONE place the studio maps a course onto a colour. The Progress tab's "By
// subject" rows read their dot and bar colour through here, so the token gate
// (`tests/chart-tokens.test.ts` — no hex literals under components/studio, and
// every `--chart-*` it names must exist in theme.css) has a single auditable
// source and no component picks a colour itself.
//
// The design prototype hard-codes a hex per subject (#3b6bb0, #1f9d5b,
// #b45309). Those are the LIGHT values of this palette; going through the
// token is what makes the same rows legible on the studio's dark default,
// where `@calyxa/ui` re-points each `--chart-N` to its dark counterpart.
//
// Eleven courses, eight tokens: the Integrated Math sequence deliberately
// shares the tokens of the core courses it mirrors, because a school runs one
// sequence or the other and the pair can never appear in one student's chart.
// The reasoning, the AA figures and the ≥32°-hue-gap caveat all live in
// `packages/ui/src/theme.css` beside the token definitions.

/** Course key → its `--chart-N` token, in `@calyxa/curriculum` catalog order. */
const COURSE_CHART_VAR: Record<string, string> = {
  'algebra-1': 'var(--chart-1)',
  geometry: 'var(--chart-2)',
  'algebra-2': 'var(--chart-3)',
  precalculus: 'var(--chart-4)',
  'ap-precalculus': 'var(--chart-7)',
  'ap-calculus-ab': 'var(--chart-5)',
  'ap-calculus-bc': 'var(--chart-8)',
  'ap-statistics': 'var(--chart-6)',
  'integrated-math-1': 'var(--chart-1)',
  'integrated-math-2': 'var(--chart-2)',
  'integrated-math-3': 'var(--chart-3)',
}

/** A course outside the eleven (a legacy or renamed key) falls back to the
 *  neutral unseen tone — visible, never an undefined colour. */
export function courseColorVar(courseKey: string | null | undefined): string {
  if (!courseKey) return 'var(--chart-state-unseen)'
  return COURSE_CHART_VAR[courseKey] ?? 'var(--chart-state-unseen)'
}

/** Retained name for the call sites that still speak of "strands"; the
 *  vocabulary is courses now and this forwards to it. */
export const strandColorVar = courseColorVar
