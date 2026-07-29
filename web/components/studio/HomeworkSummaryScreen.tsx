import Link from 'next/link'
import {
  countsOf,
  scopeLine,
  totalMinutes,
  type HomeworkSessionRow,
} from '@/lib/learning/homework-read'
import { T, ORDINAL, RULE, RADIUS, eyebrow, pageEyebrow, mintTile, pill } from './tokens'
import { ClockIcon } from './icons'
import { OUTCOME_TONE, Timeline, TimelineLegend } from './HomeworkBlocks'

// The session-summary detail — reached from the dashboard's "Full summary" or a
// History homework row.
//
// Server component: it formats the row it is handed. Everything on this page is
// derived from what the extension actually recorded; nothing is estimated, and
// the honest-scope line at the bottom states exactly what Calyxa did and did not
// check.

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function StatChip({ value, caption, accent }: { value: string; caption: string; accent?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        borderRadius: RADIUS.box,
        padding: '10px 16px',
        ...(accent ? ORDINAL.green : ORDINAL.neutral),
      }}
    >
      <span style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
        {value}
      </span>
      <span style={{ fontSize: 12, fontWeight: 500, color: T.muted, marginTop: 2 }}>{caption}</span>
    </div>
  )
}

/**
 * "Where the time went" — one horizontal bar per problem, width proportional to
 * minutes. The framing line under the heading is not decoration: a student
 * looking at their own longest bar needs to be told, in words, that it is the
 * one they worked hardest on.
 */
function WhereTheTimeWent({ row }: { row: HomeworkSessionRow }) {
  const longest = Math.max(...row.problems.map((problem) => problem.seconds), 1)

  return (
    <section className="cx-card cx-rise" style={{ marginTop: 18, padding: '20px 24px 22px', ['--cx-i' as string]: 2 }}>
      <div style={{ ...eyebrow, color: T.muted }}>Where the time went</div>
      <p style={{ margin: '6px 0 0', fontSize: 13, color: T.muted }}>Long bars are effort, not failure.</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
        {row.problems.map((problem) => {
          const minutes = Math.max(1, Math.round(problem.seconds / 60))
          const tone = OUTCOME_TONE[problem.outcome]
          return (
            <div key={problem.index} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span
                style={{
                  width: 26,
                  flexShrink: 0,
                  fontSize: 12,
                  fontWeight: 600,
                  color: T.muted,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {problem.label}
              </span>
              <span style={{ flex: 1, minWidth: 0, height: 22, borderRadius: 7, background: T.track }}>
                <span
                  style={{
                    display: 'block',
                    width: `${Math.max(6, (problem.seconds / longest) * 100)}%`,
                    height: '100%',
                    borderRadius: 7,
                    background: tone.fill,
                  }}
                />
              </span>
              <span
                style={{
                  width: 128,
                  flexShrink: 0,
                  fontSize: 12,
                  color: T.muted,
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {plural(minutes, 'min')} · {tone.label}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/**
 * The page-grade conflict (spec §6), surfaced ONCE and gently. Framed as an
 * opportunity, never as a caught lie — and rendered in amber, because nothing
 * in this pass is punitive.
 */
function MismatchCard({ row }: { row: HomeworkSessionRow }) {
  const mismatches = row.problems.filter(
    (problem) => problem.outcome === 'ok' && problem.pageGrade === 'incorrect',
  )
  if (mismatches.length === 0) return null

  return (
    <section
      className="cx-card-soft cx-rise"
      style={{ marginTop: 18, padding: '16px 22px', borderLeft: `3px solid ${T.amber}`, ['--cx-i' as string]: 3 }}
    >
      <div style={{ ...eyebrow, color: T.amber }}>Worth one more look</div>
      {/* Built as ONE string rather than interleaved JSX expressions: mixing
          `{expr}` with adjacent literal text here kept losing the space around
          the quotation marks. */}
      <p style={{ margin: '7px 0 0', fontSize: 14, lineHeight: 1.55 }}>
        {[
          mismatches.length === 1 ? 'One problem you marked' : `${mismatches.length} problems you marked`,
          ' “got it”',
          mismatches.length <= 3 ? ` (number${mismatches.length === 1 ? '' : 's'} ${mismatches.map((p) => p.label).join(', ')})` : '',
          ' came back wrong on the page. ',
          mismatches.length === 1 ? "It's" : "They're",
          ' already pulled forward in your review queue.',
        ].join('')}
      </p>
    </section>
  )
}

export function HomeworkSummaryScreen({
  row,
  comparison,
  kitHref,
}: {
  row: HomeworkSessionRow
  comparison: string
  kitHref: string | null
}) {
  const counts = countsOf(row)
  const when = new Date(row.startedAt)

  return (
    <div style={{ padding: '26px 40px 56px', maxWidth: 1020, margin: '0 auto' }}>
      <div style={{ ...pageEyebrow, color: T.muted }}>
        <Link href="/sessions" style={{ color: 'inherit', textDecoration: 'none' }}>
          ← History
        </Link>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
        <h2 style={{ fontSize: 30, lineHeight: 1.18, fontWeight: 600, letterSpacing: '-0.015em', margin: 0 }}>
          {row.concept ?? row.title ?? 'Homework set'}
        </h2>
      </div>
      <p style={{ marginTop: 8, marginBottom: 0, fontSize: 14.5, color: T.muted }}>
        {when.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        {row.title && row.concept ? ` · ${row.title}` : ''}
      </p>

      {/* Stat chips */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 20 }}>
        <StatChip accent value={comparison} caption="total" />
        <StatChip
          accent
          value={`${row.problems.length} of ${row.denominator}`}
          caption="problems"
        />
        <StatChip value={`${row.longestUnaidedRun} in a row`} caption="without help" />
        <StatChip
          value={`${counts.ok} · ${counts.shaky} · ${counts.tutored}`}
          caption="sure · shaky · together"
        />
      </div>

      {/* The timeline, at the top so the shape of the night reads first. */}
      <section className="cx-card cx-rise" style={{ marginTop: 20, padding: '20px 24px 22px', ['--cx-i' as string]: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={mintTile}>
            <ClockIcon size={15} />
          </span>
          <div style={{ ...eyebrow, color: T.muted }}>The set, problem by problem</div>
        </div>
        <Timeline row={row} height={34} />
        <TimelineLegend />
      </section>

      <WhereTheTimeWent row={row} />

      <MismatchCard row={row} />

      {/* From this set — the kit links plus the honest-scope line. */}
      <section className="cx-card cx-rise" style={{ marginTop: 18, padding: '20px 24px', ['--cx-i' as string]: 4 }}>
        <div style={{ ...eyebrow, color: T.accentInk }}>From this set</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
          {kitHref ? (
            <Link
              href={kitHref}
              style={{ ...pill, ...ORDINAL.neutral, padding: '7px 14px', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}
            >
              Notes &amp; flashcards
            </Link>
          ) : (
            <span style={{ fontSize: 13, color: T.muted }}>
              No study kit for this one — kits are generated from the problems you worked through with Calyxa.
            </span>
          )}
        </div>
        <div style={{ borderTop: RULE, margin: '16px 0 0' }} />
        <p style={{ margin: '14px 0 0', fontSize: 13, lineHeight: 1.55, color: T.muted }}>{scopeLine(row)}</p>
      </section>

      <p style={{ margin: '14px 2px 0', fontSize: 12.5, color: T.faint }}>
        {plural(totalMinutes(row), 'minute')} across {plural(row.problems.length, 'problem')}.
      </p>
    </div>
  )
}
