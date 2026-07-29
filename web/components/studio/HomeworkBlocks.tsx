import Link from 'next/link'
import { countsOf, timeline, type HomeworkOutcome, type HomeworkSessionRow } from '@/lib/learning/homework-read'
import { T, ORDINAL, RULE, RADIUS, eyebrow, mintTile, pill } from './tokens'
import { ClockIcon } from './icons'

// The v4 dashboard's two homework blocks — the resume card and the latest
// homework-session summary with its problem-by-problem timeline.
//
// Server components: they only format the rows they are handed.

/**
 * The outcome palette, shared by the timeline, its legend, and the summary
 * detail's bars so a colour means ONE thing everywhere:
 *   green = got it · blue = not sure why · amber = worked together
 *
 * Amber, never red. "Worked together" is not a failure, and the v4 pass
 * deliberately retires every danger tone from these views.
 *
 * Deviation from the handoff, deliberately: it names the studio's INK tokens as
 * the segment fills, but in LIGHT mode those are wildly uneven in lightness
 * (`--studio-green-dot` #4ade80 is pale while `--studio-amber-ink` #92400e is
 * near-brown), so the timeline read as three unrelated materials with one
 * illegible number. The ORDINAL chip tints were the other candidate and are far
 * too faint (8–9% alpha) to encode anything in a chart. These are purpose-built
 * pastel-fill / dark-ink pairs, AA in both themes — see the globals.css block.
 */
export const OUTCOME_TONE: Record<HomeworkOutcome, { fill: string; ink: string; label: string }> = {
  ok: { fill: T.outcomeOk, ink: T.outcomeOkInk, label: 'Got it' },
  shaky: { fill: T.outcomeShaky, ink: T.outcomeShakyInk, label: 'Not sure why' },
  tutored: { fill: T.outcomeTutored, ink: T.outcomeTutoredInk, label: 'Worked together' },
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// ── Resume ───────────────────────────────────────────────────────────────────

/**
 * The paused set. Lossless resume is the mechanic, so this block's whole job is
 * to say "nothing was lost" and get out of the way — it is the shortest card on
 * the page and it leads with the position, not the pitch.
 *
 * The button links to the extension's own surface indirectly: the web app
 * cannot resume a set (the set lives on the homework page), so this says where
 * to go rather than pretending to be a control that works here.
 */
export function ResumeBlock({ row }: { row: HomeworkSessionRow }) {
  const done = row.problems.length
  const percent = row.denominator > 0 ? (done / row.denominator) * 100 : 0

  return (
    <section
      className="cx-card cx-rise"
      style={{ marginTop: 22, padding: '18px 22px', ['--cx-i' as string]: 1 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <span style={mintTile}>
          <ClockIcon size={16} />
        </span>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ ...eyebrow, color: T.accentInk }}>Paused set</div>
          <h3
            style={{
              fontSize: 18,
              lineHeight: '24px',
              fontWeight: 600,
              letterSpacing: '-0.01em',
              margin: '2px 0 0',
            }}
          >
            {row.title ?? row.concept ?? 'Homework set'} — paused at {done} of {row.denominator}
          </h3>
        </div>
        <span style={{ ...pill, ...ORDINAL.green, padding: '6px 13px', fontSize: 12.5, fontWeight: 600 }}>
          Resumes where it stopped
        </span>
      </div>

      {/* The bar is the reassurance: it is already this full, and it never
          moved backward while they were away. */}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={row.denominator}
        aria-valuenow={done}
        aria-label={`${done} of ${row.denominator} problems done`}
        style={{
          marginTop: 14,
          height: 8,
          borderRadius: RADIUS.pill,
          background: T.track,
          overflow: 'hidden',
        }}
      >
        <span
          style={{
            display: 'block',
            width: `${percent}%`,
            height: '100%',
            borderRadius: RADIUS.pill,
            background: T.greenDot,
          }}
        />
      </div>
      <p style={{ margin: '10px 0 0', fontSize: 12.5, color: T.muted }}>
        Open Calyxa on the same page and it picks up at number{' '}
        {row.problems[done - 1] ? Number(row.problems[done - 1].label) + 1 : done + 1}.
      </p>
    </section>
  )
}

// ── The timeline ─────────────────────────────────────────────────────────────

/**
 * Problem-by-problem, width proportional to minutes spent. The point of the
 * proportional width is the framing line the detail view states outright: long
 * bars are effort, not failure.
 */
export function Timeline({ row, height = 30 }: { row: HomeworkSessionRow; height?: number }) {
  const segments = timeline(row)
  if (segments.length === 0) return null

  return (
    <div
      role="img"
      aria-label={segments
        .map((s) => `Problem ${s.label}: ${OUTCOME_TONE[s.outcome].label}, ${plural(s.minutes, 'minute')}`)
        .join('. ')}
      style={{ display: 'flex', gap: 3, marginTop: 14 }}
    >
      {segments.map((segment) => (
        <span
          key={segment.index}
          title={`№${segment.label} · ${OUTCOME_TONE[segment.outcome].label} · ${plural(segment.minutes, 'min')}`}
          style={{
            width: `${segment.percent}%`,
            height,
            borderRadius: 7,
            // Pastel fill + dark ink, so the number on top stays legible in
            // both themes (see OUTCOME_TONE's note).
            background: OUTCOME_TONE[segment.outcome].fill,
            color: OUTCOME_TONE[segment.outcome].ink,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 600,
            boxSizing: 'border-box',
          }}
        >
          {segment.label}
        </span>
      ))}
    </div>
  )
}

export function TimelineLegend() {
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10 }}>
      {(Object.keys(OUTCOME_TONE) as HomeworkOutcome[]).map((outcome) => (
        <span
          key={outcome}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.muted }}
        >
          <span
            aria-hidden
            style={{ width: 8, height: 8, borderRadius: '50%', background: OUTCOME_TONE[outcome].fill }}
          />
          {OUTCOME_TONE[outcome].label}
        </span>
      ))}
    </div>
  )
}

// ── Latest homework-session summary ──────────────────────────────────────────

function StatLine({ row, comparison }: { row: HomeworkSessionRow; comparison: string }) {
  const parts = [comparison]
  if (row.longestUnaidedRun > 0) {
    parts.push(`longest run without help: ${row.longestUnaidedRun}`)
  }
  return (
    <p style={{ margin: '4px 0 0', fontSize: 13.5, color: T.muted }}>{parts.join(' · ')}</p>
  )
}

/**
 * The auto-fired summary, kept. It fired in the extension when the last problem
 * was tapped; this is where it lives afterwards, which is the point — the
 * student closed the laptop and the summary is still here.
 */
export function LatestSetBlock({
  row,
  comparison,
  kitHref,
}: {
  row: HomeworkSessionRow
  comparison: string
  /** Study kit for the tutoring session this set opened, when there was one. */
  kitHref: string | null
}) {
  const counts = countsOf(row)

  return (
    <section
      className="cx-card cx-rise"
      style={{ marginTop: 18, padding: '22px 24px 20px', ['--cx-i' as string]: 2 }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ ...eyebrow, color: T.accentInk }}>Last homework session</div>
          <h3
            style={{
              fontSize: 21,
              lineHeight: '27px',
              fontWeight: 600,
              letterSpacing: '-0.015em',
              margin: '2px 0 0',
            }}
          >
            {row.concept ?? row.title ?? 'Homework set'} — {row.problems.length} of {row.denominator}
          </h3>
          <StatLine row={row} comparison={comparison} />
        </div>
        <Link
          href={`/sessions/homework/${row.id}`}
          style={{ fontSize: 13, fontWeight: 600, color: T.accentInk, textDecoration: 'none' }}
        >
          Full summary →
        </Link>
      </div>

      <Timeline row={row} />
      <TimelineLegend />

      <div style={{ borderTop: RULE, margin: '16px 0 0' }} />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          marginTop: 14,
        }}
      >
        {kitHref && (
          <Link
            href={kitHref}
            style={{ ...pill, ...ORDINAL.neutral, padding: '6px 13px', fontSize: 12.5, fontWeight: 600, textDecoration: 'none' }}
          >
            Notes &amp; flashcards from this set
          </Link>
        )}
        {/* Confidence self-reports are a mechanic, not a stat: a shaky is what
            pulls a concept forward in the review queue, so it gets named here
            rather than buried in the counts. */}
        {/* ONE text node each, not `{expr} literal`: `pill` is an inline-FLEX
            container, so adjacent text children become separate flex items and
            the whitespace between them is collapsed away ("1 conceptflagged").
            Template strings keep each chip a single node. */}
        {counts.shaky > 0 && (
          <span style={{ ...pill, ...ORDINAL.blue, padding: '6px 13px', fontSize: 12.5, fontWeight: 600 }}>
            {`${plural(counts.shaky, 'problem')} flagged “not sure why” · pulled forward`}
          </span>
        )}
        {counts.tutored > 0 && (
          <span style={{ ...pill, ...ORDINAL.amber, padding: '6px 13px', fontSize: 12.5, fontWeight: 600 }}>
            {`${plural(counts.tutored, 'problem')} worked together`}
          </span>
        )}
      </div>
    </section>
  )
}
