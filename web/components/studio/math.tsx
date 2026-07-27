import { Fragment } from 'react'
import { T } from './tokens'

// Math rendering for the studio, matched to the EXTENSION so a student sees the
// same treatment in the overlay and in their notes.
//
// The reference implementation is `extension/src/overlay/Transcript.tsx`
// (prettifyMathSymbols / toMathTokens) and `extension/src/overlay/Overlay.tsx`'s
// `renderSay`, which wraps a math block in:
//
//   inline-block max-w-full rounded-lg bg-accent-subtle px-2.5 py-0.5
//   text-[14.5px] font-semibold leading-relaxed text-accent-emphasis
//
// That matters for two reasons:
//   - NO serif and NO italic. The capsule inherits the page's sans font; the
//     green fill is what marks it as math, not a typeface.
//   - `accent-subtle` / `accent-emphasis` are both theme-aware in theme.css, so
//     the capsule stays legible in dark mode without a special case.
//
// The logic is duplicated rather than imported: the extension is a separate build
// with its own tsconfig, so `web` cannot reach into it. It is small and pure, and
// `tests/studio-math.test.ts` pins the same cases the extension's
// transcript-math tests do, so drift shows up as a failure rather than a
// difference a student notices. Consolidating both into a shared package is the
// real fix and is not done here.

/** Calculator notation → real symbols. Deliberately conservative: anything
 *  unrecognised passes through verbatim. Mirrors the extension's
 *  prettifyMathSymbols exactly. */
export function prettifyMathSymbols(text: string): string {
  return text
    .replace(/<=/g, '≤')
    .replace(/>=/g, '≥')
    .replace(/!=/g, '≠')
    .replace(/\+\/-|\+-/g, '±')
    .replace(/\bsqrt\b/g, '√')
    .replace(/\bpi\b/g, 'π')
    .replace(/\btheta\b/g, 'θ')
    .replace(/\binfinity\b|\binf\b/g, '∞')
    .replace(/\s*\*\s*/g, ' · ')
}

export type MathToken = { kind: 'text' | 'sup'; text: string }

/** `x^2`, `x^-1`, `x^(2n)`, `x^{2n}` → a sup token holding "2", "-1", "2n".
 *  Mirrors the extension's toMathTokens. */
export function toMathTokens(text: string): MathToken[] {
  const pretty = prettifyMathSymbols(text)
  const tokens: MathToken[] = []
  const pattern = /\^(?:\(([^)]+)\)|\{([^}]+)\}|(-?[A-Za-z0-9]+))/g

  let cursor = 0
  for (const match of pretty.matchAll(pattern)) {
    const at = match.index ?? 0
    if (at > cursor) tokens.push({ kind: 'text', text: pretty.slice(cursor, at) })
    tokens.push({ kind: 'sup', text: match[1] ?? match[2] ?? match[3] ?? '' })
    cursor = at + match[0].length
  }
  if (cursor < pretty.length) tokens.push({ kind: 'text', text: pretty.slice(cursor) })

  return tokens
}

/** The tokenised expression, with no wrapper — for use inside an existing
 *  treatment (a flagged step's amber highlight, an annotation's target span). */
export function MathText({ expr }: { expr: string }) {
  return (
    <>
      {toMathTokens(expr).map((token, i) =>
        token.kind === 'sup' ? <sup key={i}>{token.text}</sup> : <Fragment key={i}>{token.text}</Fragment>
      )}
    </>
  )
}

/** Which colour family the capsule wears.
 *
 *  `correct` is the extension's green. `mistake` is the amber misconception set —
 *  green means "known/right" in the brand's colour language, so a green capsule
 *  around the student's own wrong work would read as approval. Same SHAPE either
 *  way, so the two read as one system. */
export type CapsuleTone = 'correct' | 'mistake'

/** The extension's math capsule. `size` exists only so a capsule inside smaller
 *  body copy (an annotation row) can shrink without losing the treatment. */
export function MathCapsule({
  expr,
  tone = 'correct',
  size = 14.5,
}: {
  expr: string
  tone?: CapsuleTone
  size?: number
}) {
  const correct = tone === 'correct'
  return (
    <span
      style={{
        display: 'inline-block',
        maxWidth: '100%',
        // rounded-lg → --radius-lg (16px), per the extension's class.
        borderRadius: 16,
        background: correct ? T.greenTint : T.amberBg,
        // Both theme-aware on the correct path. The amber tint has no dark variant,
        // so it pairs with its own `-deep` ink (the ADR-029 AA'd pairing).
        color: correct ? T.accentInk : T.amber,
        padding: '2px 10px',
        fontSize: size,
        fontWeight: 600,
        lineHeight: 1.625,
      }}
    >
      <MathText expr={expr} />
    </span>
  )
}

/** A capsule on its own centred line — the extension's `my-1.5 block text-center`
 *  wrapper, for a featured expression that is not inline in a sentence. */
export function MathCapsuleBlock({ expr, tone = 'correct' }: { expr: string; tone?: CapsuleTone }) {
  return (
    <span style={{ display: 'block', textAlign: 'center', margin: '6px 0' }}>
      <MathCapsule expr={expr} tone={tone} />
    </span>
  )
}
