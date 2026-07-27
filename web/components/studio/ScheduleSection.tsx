'use client'

import type { CSSProperties } from 'react'
import Link from 'next/link'
import type { ReviewSchedule, StripDay } from './schedule'
import { agoLabel } from './schedule'
import { strandColorVar } from './chart-tokens'
import { T, ORDINAL, RULE, RADIUS, eyebrow, mintTile, pill } from './tokens'
import { CalendarIcon, ChevronRight } from './icons'

// The review schedule, made visible.
//
// The spacing schedule has driven Today's Review since Sprint 22, but nothing
// ever showed it: concepts appeared in the queue with no way to see when they
// would come back, or what had already been cleared. A one-line explanation was
// tried first and was worth nothing — a sentence cannot answer "what is coming
// on Thursday".
//
// Deliberately NOT a month calendar. A student has a handful of scheduled
// concepts at a time, so a 5×7 grid would be mostly empty cells, and it would
// dominate a dashboard whose job is "what do I do right now". A fortnight strip
// carries the same "when" reading at a fraction of the space, and the spacing
// intervals early on are days, not months.
//
// TODAY is deliberately absent from the columns: the Today's Review card sits
// directly above this section and lists exactly those concepts. Repeating them
// here would put the same names on the page twice. The strip's highlighted cell
// is what ties the three together.

const CELL = 36

const sectionLabel: CSSProperties = { ...eyebrow, color: T.muted, fontSize: 9.5 }

function StripCell({ d }: { d: StripDay }) {
  const base: CSSProperties = {
    height: CELL,
    borderRadius: RADIUS.tile,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  }

  // Past: a filled dot for a day that had a session, a hollow one for a day that
  // did not. Never a count — a past day's scheduled number was rewritten the
  // moment the concept was reviewed, so showing one would be a fabrication.
  if (d.isPast) {
    return (
      <div
        title={`${d.day} — ${d.studied ? 'studied' : 'no session'}`}
        style={{ ...base, background: 'transparent', color: T.muted }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: d.studied ? T.accentInk : T.dotInactive,
          }}
        />
      </div>
    )
  }

  const has = d.count > 0
  const cell = (
    <div
      title={
        d.isToday
          ? `Today — ${d.count} due`
          : `${d.day} — ${d.count} ${d.count === 1 ? 'concept' : 'concepts'} scheduled`
      }
      style={{
        ...base,
        width: d.isToday ? '100%' : undefined,
        background: d.isToday ? T.accent : has ? T.chip : 'transparent',
        color: d.isToday ? T.onAccent : has ? T.ink : T.faint,
        border: d.isToday ? 'none' : `1px solid ${has ? T.frame : 'transparent'}`,
        boxSizing: 'border-box',
      }}
    >
      {has ? d.count : '·'}
    </div>
  )

  // Today breathes — the same mint bloom the primary CTA gets, so the eye lands
  // on "now" without the cell having to shout in colour.
  return d.isToday ? (
    <span className="cx-glowwrap" style={{ display: 'flex' }}>
      <span aria-hidden className="cx-glow cx-breathe" />
      {cell}
    </span>
  ) : (
    cell
  )
}

function Strip({ strip }: { strip: StripDay[] }) {
  return (
    <div
      role="img"
      aria-label={`Two-week review schedule. ${strip.filter((d) => d.isPast && d.studied).length} of the last 7 days studied; ${strip.filter((d) => !d.isPast).reduce((a, d) => a + d.count, 0)} concepts scheduled over the next week.`}
      style={{ display: 'flex', gap: 5, minWidth: 0 }}
    >
      {strip.map((d) => (
        <div key={d.day} style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span
            aria-hidden="true"
            style={{
              fontSize: 9.5,
              textAlign: 'center',
              color: d.isToday ? T.accentInk : T.muted,
              fontWeight: d.isToday ? 600 : 500,
            }}
          >
            {d.tick}
          </span>
          <StripCell d={d} />
          <span
            aria-hidden="true"
            style={{
              fontSize: 9.5,
              textAlign: 'center',
              color: T.faint,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {d.dayOfMonth}
          </span>
        </div>
      ))}
    </div>
  )
}

function ConceptLine({ conceptKey, title, strand, meta }: { conceptKey: string; title: string; strand: string; meta: string }) {
  return (
    <Link
      href={`/notes/${encodeURIComponent(conceptKey)}`}
      className="cx-row-edge"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 11px',
        background: T.row,
        border: `1px solid ${T.frame}`,
        borderRadius: RADIUS.box,
        color: T.ink,
        textDecoration: 'none',
      }}
    >
      <span
        aria-hidden="true"
        style={{ flex: 'none', width: 6, height: 6, borderRadius: '50%', background: strandColorVar(strand) }}
      />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: 'block',
            fontSize: 13,
            fontWeight: 600,
            lineHeight: 1.35,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </span>
        <span style={{ display: 'block', fontSize: 11, color: T.muted, marginTop: 2 }}>{meta}</span>
      </span>
      <ChevronRight size={12} style={{ color: T.muted, flexShrink: 0 }} />
    </Link>
  )
}

function Column({ label, empty, children }: { label: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ ...sectionLabel, marginBottom: 10 }}>{label}</div>
      {children.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: T.muted }}>{empty}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>{children}</div>
      )}
    </div>
  )
}

export function ScheduleSection({ schedule }: { schedule: ReviewSchedule }) {
  const studiedLast7 = schedule.strip.filter((d) => d.isPast && d.studied).length

  return (
    <section className="cx-card cx-rise" style={{ marginTop: 22, padding: '20px 24px 22px', ['--cx-i' as string]: 3 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={mintTile}>
            <CalendarIcon size={15} />
          </span>
          <div style={{ ...eyebrow, color: T.muted }}>Review schedule</div>
        </div>
        <span style={{ fontSize: 12, color: T.muted }}>
          Calyxa spaces each concept out as it sticks, and pulls it back sooner when you slip.
        </span>
      </div>

      <div style={{ marginTop: 16 }}>
        <Strip strip={schedule.strip} />
      </div>

      <div
        style={{
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
          marginTop: 12,
          fontSize: 11.5,
          color: T.muted,
        }}
      >
        <span>
          Studied {studiedLast7} of the last 7 days
        </span>
        <span aria-hidden="true">·</span>
        <span>
          {schedule.upcomingTotal === 0
            ? 'nothing scheduled ahead'
            : `${schedule.upcomingTotal} ${schedule.upcomingTotal === 1 ? 'concept' : 'concepts'} scheduled ahead`}
        </span>
        {schedule.overdueCount > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <span style={{ ...pill, ...ORDINAL.danger, padding: '2px 9px', fontWeight: 600 }}>
              {schedule.overdueCount} overdue
            </span>
          </>
        )}
      </div>

      {/* `cx-progress-pair` rather than a schedule-specific class: it already is
          "two equal columns that collapse to one", which is exactly this. */}
      <div
        className="cx-progress-pair"
        style={{ marginTop: 20, paddingTop: 18, borderTop: RULE, gap: 24 }}
      >
        <Column
          label="Already done"
          empty="Nothing reviewed in the last two weeks."
          children={schedule.done.map((d) => (
            <ConceptLine
              key={d.conceptKey}
              conceptKey={d.conceptKey}
              title={d.title}
              strand={d.strand}
              meta={`Reviewed ${agoLabel(d.daysAgo)} · ${d.label}`}
            />
          ))}
        />

        <Column
          label="Coming up"
          empty="Nothing scheduled yet — concepts get a review date once you have been tutored on them."
          children={schedule.upcoming.map((u) => (
            <div
              key={u.day}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 11px',
                border: `1px solid ${T.frame}`,
                borderRadius: 10,
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, lineHeight: 1.35 }}>
                  {u.label}
                </span>
                <span
                  style={{
                    display: 'block',
                    fontSize: 11,
                    color: T.muted,
                    marginTop: 2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {u.titles.slice(0, 2).join(', ')}
                  {u.titles.length > 2 ? ` +${u.titles.length - 2} more` : ''}
                </span>
              </span>
              <span
                style={{
                  ...pill,
                  fontSize: 12,
                  fontWeight: 600,
                  color: T.muted,
                  fontVariantNumeric: 'tabular-nums',
                  flexShrink: 0,
                }}
              >
                {u.count}
              </span>
            </div>
          ))}
        />
      </div>
    </section>
  )
}
