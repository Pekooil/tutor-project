import 'server-only'
import { CONCEPT_KEYS } from '@calyxa/curriculum'
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

// Alias tables per concept key. Word aliases are \b-bounded to avoid
// substring false positives ("factor" must not fire on "satisfactory");
// the symbol/LaTeX patterns match the raw fragments the extractor recovers
// from KaTeX/MathJax. All matching runs on a lowercased haystack.
const TOPIC_ALIASES: ReadonlyArray<{ key: string; aliases: readonly RegExp[] }> = [
  {
    key: 'algebra.linear-equations.one-variable',
    aliases: [
      /\blinear equations?\b/,
      /\bsolve for [a-z]\b/,
      /\bone[- ]step equations?\b/,
      /\btwo[- ]step equations?\b/,
      /\bisolate (?:the )?variable\b/,
    ],
  },
  {
    key: 'algebra.linear-equations.two-variable',
    aliases: [
      /\bsystems? of (?:linear )?equations?\b/,
      /\bsimultaneous equations?\b/,
      /\bsubstitution method\b/,
      /\belimination method\b/,
      /\btwo variables?\b/,
      /\bslope[- ]intercept\b/,
    ],
  },
  {
    key: 'algebra.exponents.product-rule',
    aliases: [
      /\bproduct rule\b/,
      /\bproduct of powers\b/,
      /\bmultiply(?:ing)? powers\b/,
      /\bsame base\b/,
      /\bexponents?\b/,
    ],
  },
  {
    key: 'algebra.exponents.power-rule',
    aliases: [
      /\bpower rule\b/,
      /\bpower of a power\b/,
      // (x^a)^b — a parenthesised power raised to another power.
      /\(\s*[a-z0-9]+\s*\^[^)]{1,20}\)\s*\^/,
    ],
  },
  {
    key: 'algebra.polynomials.expanding',
    aliases: [/\bexpand(?:ing|ed)?\b/, /\bfoil\b/, /\bdistribut(?:e|ing|ive)\b/, /\bbinomials?\b/, /\bpolynomials?\b/],
  },
  {
    key: 'algebra.quadratics.factoring',
    aliases: [
      /\bfactor(?:s|ed|ing|ise|ize)?\b/,
      /\bquadratics?\b/,
      /\bparabola\b/,
      // A squared variable — x^2, x^{2} — in extracted LaTeX/plain text.
      /[a-z]\s*\^\s*\{?\s*2\s*\}?/,
      /[a-z]²/,
    ],
  },
  {
    key: 'algebra.quadratics.formula',
    aliases: [
      /\bquadratic formula\b/,
      /\bdiscriminant\b/,
      // b² − 4ac in LaTeX or plain text.
      /b\s*(?:\^\s*\{?\s*2\s*\}?|²)\s*-\s*4\s*a\s*c/,
      /\\pm\b/,
      /\bplus or minus\b/,
    ],
  },
  {
    key: 'algebra.inequalities.linear',
    aliases: [
      /\binequalit(?:y|ies)\b/,
      /\\[lg]eq?\b/,
      /[≤≥]/,
      /\b(?:less|greater) than or equal\b/,
      /\bflip (?:the )?(?:inequality )?sign\b/,
    ],
  },
]

// Curriculum order (CONCEPT_KEYS) is the deterministic tie-break for equal
// hit counts, and the guard that a returned key is always a real
// curriculum key even if the alias table drifts from the graph.
const CONCEPT_ORDER: ReadonlyMap<string, number> = new Map(CONCEPT_KEYS.map((key, index) => [key, index]))

function buildHaystack(pageContext: PageContext | undefined, recentMessages: RecentMessage[]): string {
  const parts: string[] = []

  if (pageContext) {
    if (pageContext.title) parts.push(pageContext.title)
    if (pageContext.text) parts.push(pageContext.text)
    for (const equation of pageContext.equations) {
      const body = equation.latex ?? equation.mathml ?? equation.text
      if (body) parts.push(body)
    }
  }

  for (const message of recentMessages.slice(-RECENT_MESSAGE_WINDOW)) {
    parts.push(message.content)
  }

  return parts.join('\n').toLowerCase().slice(0, MAX_HAYSTACK_CHARS)
}

// The page-relevant concept-key set for the profile bias (ADR-021).
// Deterministic (same inputs, same output, curriculum-order tie-break),
// bounded (haystack + result caps above), and never throws — any failure
// degrades to [], which reads as "no topic detected" downstream.
export function detectTopicKeys(pageContext: PageContext | undefined, recentMessages: RecentMessage[]): string[] {
  try {
    const haystack = buildHaystack(pageContext, recentMessages)

    if (!haystack) {
      return []
    }

    const scored: { key: string; hits: number; order: number }[] = []

    for (const { key, aliases } of TOPIC_ALIASES) {
      const order = CONCEPT_ORDER.get(key)

      if (order === undefined) {
        continue // alias table drifted from the curriculum graph — never emit an unknown key
      }

      const hits = aliases.reduce((total, alias) => total + (alias.test(haystack) ? 1 : 0), 0)

      if (hits > 0) {
        scored.push({ key, hits, order })
      }
    }

    return scored
      .sort((a, b) => b.hits - a.hits || a.order - b.order)
      .slice(0, MAX_TOPIC_KEYS)
      .map((entry) => entry.key)
  } catch {
    return []
  }
}
