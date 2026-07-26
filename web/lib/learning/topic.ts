import 'server-only'
import { CONCEPTS, CONCEPT_KEYS, conceptKeysOfCourse } from '@calyxa/curriculum'
import type { PageContext } from '@/lib/ai/page-context'

// Turn-time topic detection (ADR-021): map the already-extracted page
// context + recent transcript to the curriculum's CONCEPT_KEYS so
// loadProfile can order page-relevant concepts first (PLAN §2.3 query 1's
// `$2` bias, the join ADR-014 deferred). Deliberately a keyword/alias
// match — NO model call, NO persistence (no page_url_hash / topic history;
// that stays the privacy sprint). A miss or an empty result degrades to []
// and the profile reads exactly as it did before this sprint; a match only
// REORDERS and ADDS — detection can never drop the weakest-overall set.

// The transcript window mirrors the §2.5 "last 6–8 turns" prompt budget —
// older turns are stale topic signal anyway.
const RECENT_MESSAGE_WINDOW = 6
// Everything matched against is sliced to this before the regexes run, so
// detection cost is bounded no matter what the client sends.
const MAX_HAYSTACK_CHARS = 16_000
// At most this many detected keys are returned (highest hit-count first) —
// the profile bias needs "what's on screen," not an exhaustive tagging.
const MAX_TOPIC_KEYS = 4

type RecentMessage = {
  role: 'user' | 'assistant'
  content: string
}

// Escapes regex metacharacters in a literal alias string before it's wrapped
// in a \b-bounded pattern below. None of today's curriculum aliases contain
// one, but aliases are data (ADR-032) — a future one that does must not
// throw or silently misbehave.
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// \b-bounded so a short alias can't fire on a longer word ("factor" must not
// match "satisfactory"); case-insensitive as a second, redundant guard on
// top of the lowercased haystack (defensive, not load-bearing).
function aliasPattern(alias: string): RegExp {
  return new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'i')
}

// Derived from @calyxa/curriculum's `aliases` field at import time (ADR-032
// Task 3) — replaces the Sprint 11 hand-maintained alias table the audit
// flagged as drift-prone. A concept cannot ship without ≥2 aliases (Task 2's
// build-time invariant), so it cannot silently exempt itself from topic bias
// here either: this table is exactly as current as the curriculum graph is.
const TOPIC_ALIASES: ReadonlyArray<{ key: string; aliases: readonly RegExp[] }> = CONCEPTS.map((concept) => ({
  key: concept.key,
  aliases: concept.aliases.map(aliasPattern),
}))

// Curriculum order (CONCEPT_KEYS) is the deterministic tie-break for equal
// hit counts. The `order === undefined` guard below is now unreachable in
// practice (both this table and CONCEPT_ORDER derive from the same
// CONCEPTS/CONCEPT_KEYS source) but stays as defense-in-depth: a returned
// key can never be one the curriculum graph doesn't recognize.
const CONCEPT_ORDER: ReadonlyMap<string, number> = new Map(CONCEPT_KEYS.map((key, index) => [key, index]))

function buildHaystack(pageContext: PageContext | undefined, recentMessages: RecentMessage[]): string {
  const parts: string[] = []

  if (pageContext) {
    if (pageContext.title) parts.push(pageContext.title)
    if (pageContext.text) parts.push(pageContext.text)
    for (const equation of pageContext.equations) {
      // Same fix as renderEquation in page-context.ts: prefer readable
      // `text` over raw `mathml` markup when there's no `latex` source --
      // matching regexes against literal `<math><msup>...` tags can never
      // hit a word/symbol alias, while the flattened text at least has a
      // chance to.
      const body = equation.latex ?? equation.text ?? equation.mathml
      if (body) parts.push(body)
    }
  }

  for (const message of recentMessages.slice(-RECENT_MESSAGE_WINDOW)) {
    parts.push(message.content)
  }

  return parts.join('\n').toLowerCase().slice(0, MAX_HAYSTACK_CHARS)
}

// Concept keys of the student's course, memoized per course key. The course
// prior below is consulted on every turn, and rebuilding a ~30-key Set each
// time would be pure waste on a hot path.
const COURSE_KEY_SETS = new Map<string, ReadonlySet<string>>()

function courseKeySet(courseKey: string | null | undefined): ReadonlySet<string> | null {
  if (!courseKey) return null
  const cached = COURSE_KEY_SETS.get(courseKey)
  if (cached) return cached
  const keys = conceptKeysOfCourse(courseKey)
  if (keys.length === 0) return null // unknown course — no prior, not an error
  const set = new Set(keys)
  COURSE_KEY_SETS.set(courseKey, set)
  return set
}

// The page-relevant concept-key set for the profile bias (ADR-021).
// Deterministic (same inputs, same output, curriculum-order tie-break),
// bounded (haystack + result caps above), and never throws — any failure
// degrades to [], which reads as "no topic detected" downstream.
//
// `courseKey` (the course the student picked at signup) is a TIE-BREAK ONLY:
// among concepts the text matches EQUALLY well, one the student's course
// actually teaches wins. It can never promote a weaker match over a stronger
// one, and it can never drop a match — so a student working outside their
// syllabus is still detected correctly.
//
// This became load-bearing with the 11-course restructure, because the graph
// now holds genuinely ambiguous aliases that it did not before: "limits" hits
// both `precalc.limits.intuitive` and `calculus.limits.formal`, and several
// sequence/series and probability aliases span two courses. Without the prior,
// the curriculum-order tie-break would hand an AP Calculus student the
// precalculus concept every time.
export function detectTopicKeys(
  pageContext: PageContext | undefined,
  recentMessages: RecentMessage[],
  courseKey?: string | null
): string[] {
  try {
    const haystack = buildHaystack(pageContext, recentMessages)

    if (!haystack) {
      return []
    }

    const inCourse = courseKeySet(courseKey)
    const scored: { key: string; hits: number; courseRank: number; order: number }[] = []

    for (const { key, aliases } of TOPIC_ALIASES) {
      const order = CONCEPT_ORDER.get(key)

      if (order === undefined) {
        continue // alias table drifted from the curriculum graph — never emit an unknown key
      }

      const hits = aliases.reduce((total, alias) => total + (alias.test(haystack) ? 1 : 0), 0)

      if (hits > 0) {
        // 0 sorts before 1: in the student's course first, on equal hits.
        scored.push({ key, hits, courseRank: inCourse?.has(key) ? 0 : 1, order })
      }
    }

    return scored
      .sort((a, b) => b.hits - a.hits || a.courseRank - b.courseRank || a.order - b.order)
      .slice(0, MAX_TOPIC_KEYS)
      .map((entry) => entry.key)
  } catch {
    return []
  }
}
