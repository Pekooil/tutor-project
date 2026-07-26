// The ONE place the studio maps a strand onto a colour. The Progress tab's "By
// subject" rows read their dot and bar colour through here, so the token gate
// (`tests/chart-tokens.test.ts` — no hex literals under components/studio, and
// every `--chart-*` it names must exist in theme.css) has a single auditable
// source and no component picks a colour itself.
//
// The design prototype hard-codes a hex per strand (#3b6bb0, #1f9d5b, #b45309).
// Those are the LIGHT values of this palette; going through the token is what
// makes the same rows legible on the studio's dark default, where `@calyxa/ui`
// re-points each `--chart-N` to its dark counterpart.

/** Strand key (the `strandOf` prefix) → its `--chart-N` token, in the exact
 *  `@calyxa/curriculum` file order the palette was assigned in. */
const STRAND_CHART_VAR: Record<string, string> = {
  algebra: 'var(--chart-1)',
  geometry: 'var(--chart-2)',
  algebra2: 'var(--chart-3)',
  precalc: 'var(--chart-4)',
  calculus: 'var(--chart-5)',
  stats: 'var(--chart-6)',
}

/** A strand outside the six known modules (a legacy or renamed key) falls back
 *  to the neutral unseen tone — visible, never an undefined colour. */
export function strandColorVar(strand: string): string {
  return STRAND_CHART_VAR[strand] ?? 'var(--chart-state-unseen)'
}
