// The per-concept shape, shared by every strand module (ADR-032). `aliases`
// is the only new field this sprint — the student-language phrases topic
// detection should match; `topic.ts` derives its table from these at import
// time (Task 3), retiring its hand-maintained parallel list. Every other
// field's meaning is unchanged from `concepts.ts` before the strand split.
export type Concept = {
  key: string
  strand: string
  title: string
  strandLabel: string
  prerequisites: readonly string[]
  difficultyPrior: number
  aliases: readonly string[]
}
