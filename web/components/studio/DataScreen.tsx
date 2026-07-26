import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import type { AnalyticsInput, OpenGap, ProgressScore, Signal, StrandRow } from './analytics'
import { CLOSES_AT_CONSECUTIVE_CORRECT, progressData } from './analytics'
import { strandColorVar } from './chart-tokens'
import { Meter, NUM, Sparkline } from './data-charts'
import { T, ORDINAL, RULE, accentButton, eyebrow, pill } from './tokens'
import { ChevronRight } from './icons'
import { STORE_URL } from '@/lib/store-url'

// Screen 4 — Progress. A direct build of the `Calyxa Data.dc.html` handoff:
// a stated reading of where the student stands, then the two things worth doing
// about it, then the by-subject breakdown, then one line of context.
//
// Rendered on the `@calyxa/ui` tokens rather than the prototype's hexes. The
// prototype is authored light; the studio's default is DARK, and every colour
// below routes through a token that flips — which is also what keeps the
// by-subject bars legible (their light values measure ~1.5:1 on the dark page).
// The hex-for-token mapping is noted at each non-obvious substitution.
//
// A server component: nothing here is interactive. The whole page is a pure
// function of the two server reads, so there is no client bundle to ship.

const MAX_W = 1020

const sectionLabel: CSSProperties = { ...eyebrow, color: T.muted }

/** The card surface the design draws everything on (#fff + #e5e3de border). */
function card(radius: number): CSSProperties {
  return { background: T.card, border: `1px solid ${T.border}`, borderRadius: radius }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** A section eyebrow with the design's 34px lead-in. */
function SectionLabel({ children }: { children: ReactNode }) {
  return <div style={{ ...sectionLabel, letterSpacing: '0.12em', margin: '34px 0 0' }}>{children}</div>
}

// ── Hero ─────────────────────────────────────────────────────────────────────

function DeltaPill({ delta }: { delta: number }) {
  // The design shows a green "▲ +4 this week". A fall gets the caution set
  // rather than the same green — the prototype only drew the happy case.
  const set = delta >= 0 ? ORDINAL.green : ORDINAL.amber
  return (
    <span
      style={{
        ...pill,
        ...set,
        ...NUM,
        gap: 6,
        padding: '4px 11px',
        fontSize: 12.5,
        fontWeight: 700,
      }}
    >
      <svg width="9" height="9" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
        <path d={delta >= 0 ? 'M6 1l5 8H1z' : 'M6 11L1 3h10z'} />
      </svg>
      {delta > 0 ? `+${delta}` : delta}
      {' this week'}
    </span>
  )
}

function SignalRow({ signal, limiting }: { signal: Signal; limiting: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ flex: '0 0 92px', fontSize: 13, fontWeight: 600 }}>{signal.label}</span>
      {signal.value === null ? (
        <span style={{ flex: 1, minWidth: 60, fontSize: 11.5, color: T.muted }}>{signal.unlock}</span>
      ) : (
        // The design paints the limiting signal amber and the rest green — the
        // one place colour carries meaning here, so it follows the data rather
        // than being fixed per row.
        <Meter value={signal.value} fill={limiting ? T.ink2 : T.accentInk} />
      )}
      <span style={{ ...NUM, fontSize: 13.5, fontWeight: 700, width: 30, textAlign: 'right' }}>
        {signal.value ?? '—'}
      </span>
    </div>
  )
}

function Hero({ progress }: { progress: ProgressScore }) {
  const { narrative } = progress
  return (
    <section
      style={{
        ...card(16),
        marginTop: 24,
        padding: '26px 28px',
        display: 'flex',
        gap: 40,
        flexWrap: 'wrap',
        alignItems: 'flex-start',
      }}
    >
      <div style={{ flex: '1 1 300px', minWidth: 280 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ ...NUM, fontSize: 64, fontWeight: 700, letterSpacing: '-0.045em', lineHeight: 0.9 }}>
            {progress.score ?? '—'}
          </span>
          <span style={{ ...NUM, fontSize: 16, fontWeight: 600, color: T.muted }}>/ 100</span>
          {progress.delta !== null && <DeltaPill delta={progress.delta} />}
        </div>

        <p
          style={{
            margin: '16px 0 0',
            fontSize: 15.5,
            lineHeight: 1.6,
            color: T.ink,
            maxWidth: 420,
            textWrap: 'pretty',
          }}
        >
          {narrative.lead} <strong style={{ fontWeight: 600 }}>{narrative.emphasis}</strong>
          {narrative.tail}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 22 }}>
          {progress.signals.map((signal) => (
            <SignalRow key={signal.key} signal={signal} limiting={signal.key === progress.limiting} />
          ))}
        </div>

        <p style={{ margin: '14px 0 0', fontSize: 11.5, lineHeight: 1.6, color: T.muted, maxWidth: 420 }}>
          {progress.scoreMath}
        </p>
      </div>

      <div style={{ flex: '0 0 330px', minWidth: 280 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ ...sectionLabel, letterSpacing: '0.12em' }}>Last 90 days</span>
          {progress.range && (
            <span style={{ ...NUM, fontSize: 11.5, color: T.muted }}>
              {progress.range.from} → {progress.range.to}
            </span>
          )}
        </div>

        {progress.series ? (
          <>
            <div style={{ marginTop: 10 }}>
              <Sparkline
                points={progress.series}
                label={`Progress score moving from ${progress.range!.from} to ${progress.range!.to} across ${plural(progress.series.length, 'recorded day')}`}
              />
            </div>
            <p style={{ margin: '10px 0 0', fontSize: 11.5, lineHeight: 1.6, color: T.muted }}>
              One point per day the model took a snapshot — gaps are days without one, never filled in.
            </p>
          </>
        ) : (
          // The prototype only drew the established case. A trend cannot be
          // faked backwards (mastery history starts the day snapshots start),
          // so the seat states that plainly rather than drawing a short stub.
          <p style={{ margin: '10px 0 0', fontSize: 11.5, lineHeight: 1.6, color: T.muted }}>
            The line starts once there are a few days of snapshots behind it. Mastery history is recorded forward
            from today — it is never filled in backwards.
          </p>
        )}
      </div>
    </section>
  )
}

// ── Worth doing next ─────────────────────────────────────────────────────────

function CardHead({ title, badge, tone }: { title: string; badge?: string; tone: 'amber' | 'green' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
      <h2 style={{ margin: 0, fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em' }}>{title}</h2>
      {badge && (
        <span
          style={{
            ...pill,
            ...(tone === 'amber' ? ORDINAL.amber : ORDINAL.green),
            ...NUM,
            padding: '3px 9px',
            fontSize: 12.5,
            fontWeight: 600,
          }}
        >
          {badge}
        </span>
      )}
    </div>
  )
}

function ReviewCardView({ review }: { review: ReturnType<typeof progressData>['review'] }) {
  const count = review.due.length
  return (
    <div style={{ ...card(14), padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <CardHead
        title={count === 0 ? 'Nothing due today' : `${plural(count, 'review')} due today`}
        badge={review.overdue > 0 ? `${review.overdue} overdue` : undefined}
        tone="amber"
      />

      {count === 0 ? (
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: T.muted }}>
          The spacing schedule has nothing waiting. Concepts come back on their own — this fills in as they fall due.
        </p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {review.due.slice(0, 6).map((c) => (
            <Link
              key={c.conceptKey}
              href={`/notes/${encodeURIComponent(c.conceptKey)}`}
              className="cx-row-edge"
              style={{
                ...pill,
                gap: 7,
                padding: '6px 12px',
                fontSize: 12.5,
                fontWeight: 600,
                border: `1px solid ${T.frame}`,
                color: T.ink,
                textDecoration: 'none',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  // Overdue reads danger; everything else carries its strand's
                  // colour, matching the by-subject rows below.
                  background: c.overdue ? T.danger : strandColorVar(c.strand),
                }}
              />
              {c.title}
            </Link>
          ))}
          {count > 6 && <span style={{ ...pill, padding: '6px 4px', fontSize: 12.5, color: T.muted }}>+{count - 6} more</span>}
        </div>
      )}

      <div style={{ flex: 1 }} />

      {count > 0 && review.startHref && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <Link href={review.startHref} style={{ ...accentButton, fontSize: 14, padding: '11px 20px' }}>
            Start review →
          </Link>
          <span style={{ fontSize: 12.5, color: T.muted }}>about {plural(review.minutes, 'minute')}</span>
        </div>
      )}
    </div>
  )
}

function GapRow({ gap }: { gap: OpenGap }) {
  return (
    <Link
      href={`/misconceptions/${gap.id}`}
      className="cx-row-edge"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '11px 13px',
        border: `1px solid ${T.frame}`,
        borderRadius: 11,
        color: T.ink,
        textDecoration: 'none',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          flex: 'none',
          width: 6,
          height: 6,
          borderRadius: '50%',
          // A confirmed pattern is the caution tone; a slip seen once is not yet
          // a gap, so it stays neutral rather than borrowing the same weight.
          background: gap.status === 'active' ? T.ink2 : T.muted,
        }}
      />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, lineHeight: 1.35 }}>{gap.description}</span>
        <span style={{ ...NUM, display: 'block', fontSize: 11.5, color: T.muted, marginTop: 3 }}>
          {gap.concept} · seen {plural(gap.occurrenceCount, 'time')}
        </span>
      </span>
      <span
        title={`${gap.consecutiveCorrect} of ${CLOSES_AT_CONSECUTIVE_CORRECT} correct in a row closes this`}
        style={{ display: 'flex', gap: 3, flexShrink: 0 }}
      >
        {Array.from({ length: CLOSES_AT_CONSECUTIVE_CORRECT }, (_, i) => (
          <span
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: i < gap.consecutiveCorrect ? T.accentInk : T.frame,
            }}
          />
        ))}
      </span>
    </Link>
  )
}

function GapsCardView({ gaps }: { gaps: ReturnType<typeof progressData>['gaps'] }) {
  return (
    <div style={{ ...card(14), padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <CardHead
        title={gaps.open.length === 0 ? 'No gaps open' : `${plural(gaps.open.length, 'gap')} still open`}
        badge={gaps.resolved > 0 ? `${gaps.resolved} fixed` : undefined}
        tone="green"
      />

      {gaps.open.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: T.muted }}>
          Nothing is currently going wrong more than once. Calyxa opens a gap the moment a mistake repeats.
        </p>
      ) : (
        gaps.open.slice(0, 2).map((gap) => <GapRow key={gap.id} gap={gap} />)
      )}

      <div style={{ flex: 1 }} />
      <span style={{ fontSize: 12, color: T.muted }}>
        {gaps.open.length > 2
          ? `${gaps.open.length - 2} more open. Three right in a row closes a gap for good.`
          : 'Three right in a row closes a gap for good.'}
      </span>
    </div>
  )
}

// ── By subject ───────────────────────────────────────────────────────────────

function StrandRowView({ row }: { row: StrandRow }) {
  const color = strandColorVar(row.strand)
  return (
    <div
      style={{
        padding: '16px 0',
        borderTop: RULE,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexWrap: 'wrap',
      }}
    >
      <span aria-hidden="true" style={{ flex: 'none', width: 8, height: 8, borderRadius: 2, background: color }} />
      <span style={{ flex: '0 0 150px', fontSize: 14.5, fontWeight: 600 }}>{row.label}</span>
      <Meter value={row.mastery} fill={color} height={8} />
      <span style={{ ...NUM, fontSize: 14.5, fontWeight: 700, width: 44, textAlign: 'right' }}>{row.mastery}%</span>
      <span style={{ ...NUM, fontSize: 12, color: T.muted, width: 80, textAlign: 'right' }}>
        {plural(row.concepts, 'concept')}
      </span>
      {row.weakest && (
        <Link
          href={`/notes/${encodeURIComponent(row.weakest.conceptKey)}`}
          className="cx-weakest"
          style={{
            flex: '0 0 210px',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            justifyContent: 'flex-end',
            fontSize: 12,
            color: T.muted,
            textDecoration: 'none',
            minWidth: 0,
          }}
        >
          <span>Weakest: {row.weakest.title}</span>
          <ChevronRight size={11} />
        </Link>
      )}
    </div>
  )
}

// ── Empty state ──────────────────────────────────────────────────────────────

function ColdStart() {
  return (
    <div style={{ ...card(16), marginTop: 32, padding: '56px 32px', textAlign: 'center' }}>
      <div style={{ ...sectionLabel, letterSpacing: '0.12em' }}>Progress</div>
      <h2 style={{ margin: '12px 0 0', fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em' }}>
        Nothing to show yet
      </h2>
      <p style={{ margin: '10px auto 0', maxWidth: 400, fontSize: 14.5, lineHeight: 1.65, color: T.muted }}>
        This page is built only from your own tutored sessions, so there is no sample to show you. Work through one
        problem with Calyxa and your first reading appears here.
      </p>
      {/* Sessions start in the extension, not the web app, so this points at the
          install rather than pretending the web app can open one. */}
      <a href={STORE_URL} style={{ ...accentButton, marginTop: 22, fontSize: 14.5, padding: '12px 22px' }}>
        Add Calyxa to Chrome →
      </a>
    </div>
  )
}

// ── The screen ───────────────────────────────────────────────────────────────

export function DataScreen({ input }: { input: AnalyticsInput }) {
  const data = progressData(input)
  const now = new Date(input.nowIso)
  const today = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })

  return (
    <div style={{ padding: '8px 40px 56px' }}>
      <div style={{ maxWidth: MAX_W, margin: '0 auto' }}>
        {data.cold ? (
          <ColdStart />
        ) : (
          <>
            <div style={{ ...sectionLabel, letterSpacing: '0.14em', fontWeight: 600 }}>{today}</div>
            <h1 style={{ margin: '6px 0 0', fontSize: 32, lineHeight: 1.18, fontWeight: 600, letterSpacing: '-0.015em' }}>
              Progress
            </h1>

            <Hero progress={data.progress} />

            <SectionLabel>Worth doing next</SectionLabel>
            <section className="cx-progress-pair" style={{ marginTop: 12 }}>
              <ReviewCardView review={data.review} />
              <GapsCardView gaps={data.gaps} />
            </section>

            {data.strands.length > 0 && (
              <>
                <SectionLabel>By subject</SectionLabel>
                <section style={{ ...card(14), marginTop: 12, padding: '4px 22px 18px' }}>
                  {data.strands.map((row) => (
                    <StrandRowView key={row.strand} row={row} />
                  ))}
                  <p style={{ margin: '16px 0 0', fontSize: 11.5, lineHeight: 1.6, color: T.muted }}>
                    Decay-adjusted: a concept you have not touched in weeks reads lower than the day you learned it.
                  </p>
                </section>
              </>
            )}

            <div
              style={{
                marginTop: 26,
                paddingTop: 18,
                borderTop: RULE,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 20,
                flexWrap: 'wrap',
              }}
            >
              <span style={{ ...NUM, fontSize: 12.5, color: T.muted }}>
                {plural(data.footer.conceptsTutored, 'concept')} tutored · studied {data.footer.studiedLast7} of the
                last 7 days · best streak {plural(data.footer.bestStreak, 'day')}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
