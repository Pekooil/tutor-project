import 'server-only'

// One on-page equation in whatever form the extractor recovered it (PLAN
// §2.6: MathML primary, LaTeX source from KaTeX/MathJax, plain text as a
// last resort). Mirrored in /extension/src/types/messages.ts (Task 5) --
// this file is the source of truth for the shape.
export type PageEquation = {
  latex?: string
  mathml?: string
  text?: string
}

// A single bounded per-turn page snapshot. No URL, no element rects --
// page-context persistence and the annotation layer are both deferred
// (ADR-012, ADR-013).
export type PageContext = {
  title?: string
  text?: string
  equations: PageEquation[]
}

// The §2.5 page-context token budget (~1,500 tokens) is enforced HERE,
// server-side. The extractor applies its own caps too (Task 5), but those
// are a courtesy only -- these are the authoritative budget (ADR-013).
export const MAX_EQUATIONS = 12
export const MAX_EQUATION_CHARS = 400
export const MAX_TEXT_CHARS = 2000

// Slices to max - 1 + the ellipsis so the result is exactly `max` chars,
// never max + 1.
function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function renderEquation(equation: PageEquation): string | null {
  const body = equation.latex ?? equation.mathml ?? equation.text
  return body ? `- ${truncate(body, MAX_EQUATION_CHARS)}` : null
}

// Renders a bounded PageContext into the prompt's PAGE CONTEXT block.
// Equations are kept up to MAX_EQUATIONS; page text is truncated first
// under budget pressure since equations are the higher-value signal (PLAN
// §2.5). Returns '' when there is nothing to show (e.g. an image-only
// page with no DOM math) so the caller falls back to the empty-slot
// wording instead of injecting an empty block.
export function renderPageContext(context: PageContext): string {
  const equationLines = context.equations
    .slice(0, MAX_EQUATIONS)
    .map(renderEquation)
    .filter((line): line is string => line !== null)

  const text = context.text ? truncate(context.text, MAX_TEXT_CHARS) : ''

  if (equationLines.length === 0 && !text) {
    return ''
  }

  const sections: string[] = []

  if (context.title) {
    sections.push(`Page title: ${truncate(context.title, 200)}`)
  }

  sections.push(
    'Visible on the page:',
    equationLines.length > 0 ? equationLines.join('\n') : '(no equations detected)'
  )

  if (text) {
    sections.push('', `Page text (excerpt): ${text}`)
  }

  return sections.join('\n')
}
