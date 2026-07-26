// The six-strand taxonomy over @calyxa/curriculum -- PURE (no server-only, no
// Supabase, no model calls), so it is directly unit-testable.
//
// History: this file was Sprint 17's (ADR-042) cold-start onboarding item bank.
// That diagnostic self-check was retired at public launch (2026-07-17) and its
// last remains -- selectAssessmentItems(), the Assessment* types, the choice
// scale, /api/onboarding and seed.ts -- were deleted with the two-workflow
// onboarding cleanup (2026-07-25); nothing had called them since. What survives
// is the strand vocabulary below, which the mastery dashboard, the study-kit
// reads and dashboard-read.ts all group by. The file keeps its path only
// because six live importers reference it; a rename is a safe follow-up.

// The six top-level strands, recovered from the concept key's first dotted
// segment (algebra1's keys are `algebra.*`, prob-stats' `stats.*`, etc.). This
// is the only stable, package-exported way to recover module membership -- the
// per-module arrays (ALGEBRA1_CONCEPTS, ...) are internal to @calyxa/curriculum
// and `Concept.strand` is the finer sub-topic, not the module.
// Exported (Sprint 22 Task 4): the dashboard read groups the full per-user
// graph by these same six top-level strands, so `dashboard-read.ts` reuses
// this vocabulary rather than defining a second copy — one source of truth for
// "the six strands" across onboarding and the mastery dashboard.
export const STRAND_ORDER = ['algebra', 'geometry', 'algebra2', 'precalc', 'calculus', 'stats'] as const
export const STRAND_LABELS: Record<string, string> = {
  algebra: 'Algebra 1',
  geometry: 'Geometry',
  algebra2: 'Algebra 2',
  precalc: 'Trig & Precalculus',
  calculus: 'Calculus',
  stats: 'Probability & Statistics',
}

export function strandOf(conceptKey: string): string {
  return conceptKey.split('.')[0]
}
