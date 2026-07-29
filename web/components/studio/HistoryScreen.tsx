import Link from 'next/link'
import type { RecentSession } from '@/lib/learning/activity-read'
import type { HomeworkSessionRow } from '@/lib/learning/homework-read'
import { T, ORDINAL, MOTION, RADIUS, mintTile, pageEyebrow, pill } from './tokens'
import { ChevronRight, HistoryIcon, MicIcon, NotesIcon } from './icons'

// Session history — a token-based studio view.
//
// This replaces the pre-studio `SessionsScreen` on /sessions. That component is
// built on premium/theme.ts's hardcoded LIGHT hexes over near-opaque white glass
// cards, so inside the dark studio shell it rendered as a washed-out white slab
// (white cards on #f2f1ed, no boundary against the rail) — visibly broken next to
// the four token-based tabs beside it. History is a primary nav destination, so it
// belongs in the same visual system as the rest, not pinned to light.
//
// Server component: it only formats the rows it is handed.

const MS_PER_DAY = 86_400_000

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Today / Yesterday / This week / month-year — the buckets a student thinks in. */
function bucketOf(iso: string, now: Date): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return 'Earlier'
  const days = Math.round((startOfDay(now) - startOfDay(then)) / MS_PER_DAY)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return 'This week'
  if (days < 30) return 'This month'
  return then.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function timeOf(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function dayOf(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/** Wall-clock minutes, or null while a session is still open. */
function minutesOf(session: RecentSession): number | null {
  if (!session.endedAt) return null
  const a = new Date(session.startedAt).getTime()
  const b = new Date(session.endedAt).getTime()
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null
  return Math.max(1, Math.round((b - a) / 60_000))
}

function SessionRow({ session }: { session: RecentSession }) {
  const voice = session.mode === 'voice'
  const minutes = minutesOf(session)

  // A row opens the NOTES for the concept the session worked on — the notebook is
  // the durable thing a session produces, and it is a studio view. It used to go
  // to `kitHref ?? /sessions/[id]`, both pre-studio light screens, which is what
  // made clicking a row feel like falling out of the app.
  //
  // A session with no concept (never got past the ungraded opening scan) has
  // nothing to open, so its row renders as a plain row rather than a dead link
  // into the old transcript page.
  const href = session.conceptKey ? `/notes/${encodeURIComponent(session.conceptKey)}` : null

  const rowStyle = {
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: 14,
    padding: '13px 15px',
    // Row inside the day-group card → its own raised fill and the soft frame.
    border: `1px solid ${T.frame}`,
    borderRadius: RADIUS.box,
    background: T.raised4,
    color: T.ink,
    textDecoration: 'none' as const,
    transition: `background ${MOTION.fast} ${MOTION.ease}, border-color ${MOTION.fast} ${MOTION.ease}`,
  }

  const body = (
    <>
      <span
        aria-hidden="true"
        style={{
          ...mintTile,
        }}
      >
        {voice ? <MicIcon size={16} /> : <NotesIcon size={16} />}
      </span>

      <span style={{ minWidth: 0, flex: 1 }}>
        {/* The concept leads — it's what makes a row identifiable. The mode and
            timing are the supporting detail, not the headline. */}
        {/* v4 relabel: a tutoring session that belonged to no homework set is
            "Quick help" — one problem, in passing. Naming it "Voice session"
            described the transport, which is not what the student came for.
            When there is no concept the TITLE is already "Quick help", so the
            meta line drops the label rather than saying it twice. */}
        <span style={{ display: 'block', fontSize: 14, fontWeight: 500 }}>
          {session.conceptTitle ?? 'Quick help'}
        </span>
        <span style={{ display: 'block', fontSize: 11.5, color: T.muted, marginTop: 2 }}>
          {[
            session.conceptTitle ? 'Quick help' : null,
            voice ? 'Voice' : 'Text',
            dayOf(session.startedAt),
            timeOf(session.startedAt),
            minutes !== null ? `${minutes} min` : 'still open',
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>

      {session.hasKit && (
        <span
          title="This session produced a study kit"
          style={{ ...pill, ...ORDINAL.green, padding: '3px 9px', fontSize: 11, fontWeight: 600 }}
        >
          Study kit
        </span>
      )}

      {href && <ChevronRight size={14} style={{ color: T.muted, flexShrink: 0 }} />}
    </>
  )

  if (!href) {
    return (
      <div style={{ ...rowStyle, opacity: 0.6 }} title="This session recorded no concept, so it has no notes">
        {body}
      </div>
    )
  }

  return (
    <Link href={href} className="cx-row-edge" style={rowStyle} title={`Open your ${session.conceptTitle} notes`}>
      {body}
    </Link>
  )
}

// ── v4: the homework session is the unit ─────────────────────────────────────
//
// Before v4 this page listed tutoring sessions flat, which told the student
// nothing about the shape of an evening: a homework hour with three tutored
// problems read as three unrelated rows. Now a homework set is the row, the
// tutoring it contained is NESTED inside it, and a genuine one-off tutoring
// session — one that belonged to no set — is relabelled "Quick help", which is
// what it actually is.

/** The tutored problems a set contains, rendered indented under its row. */
function NestedTutoring({ session }: { session: RecentSession }) {
  const minutes = minutesOf(session)
  const voice = session.mode === 'voice'
  const href = session.conceptKey ? `/notes/${encodeURIComponent(session.conceptKey)}` : null

  const body = (
    <>
      <span
        aria-hidden
        style={{ width: 6, height: 6, borderRadius: '50%', background: T.amber, flexShrink: 0 }}
      />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>
          {session.conceptTitle ?? 'Worked through together'}
        </span>
        <span style={{ display: 'block', fontSize: 11, color: T.muted, marginTop: 2 }}>
          Tutored inside the session · {voice ? 'Voice' : 'Text'}
          {minutes !== null ? ` · ${minutes} min` : ''}
        </span>
      </span>
      {session.hasKit && (
        <span style={{ ...pill, ...ORDINAL.green, padding: '3px 9px', fontSize: 11, fontWeight: 600 }}>
          Study kit
        </span>
      )}
    </>
  )

  const style = {
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: 11,
    // The indent IS the nesting: this row belongs to the one above it.
    margin: '7px 0 0 34px',
    padding: '10px 13px',
    borderLeft: `2px solid ${T.amberEdge}`,
    borderRadius: 8,
    background: T.row,
    color: T.ink,
    textDecoration: 'none' as const,
  }

  return href ? (
    <Link href={href} className="cx-row-edge" style={style}>
      {body}
    </Link>
  ) : (
    <div style={style}>{body}</div>
  )
}

function HomeworkRow({ row, nested }: { row: HomeworkSessionRow; nested: RecentSession[] }) {
  const minutes = Math.max(1, Math.round(row.totalSeconds / 60))
  const unfinished = row.status !== 'complete'

  return (
    <div
      style={{
        border: `1px solid ${T.frame}`,
        borderRadius: RADIUS.box,
        background: T.raised4,
        padding: '13px 15px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span aria-hidden style={mintTile}>
          <NotesIcon size={16} />
        </span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'block', fontSize: 14, fontWeight: 500 }}>
            {row.concept ?? row.title ?? 'Homework set'}
          </span>
          <span style={{ display: 'block', fontSize: 11.5, color: T.muted, marginTop: 2 }}>
            {dayOf(row.startedAt)} · {timeOf(row.startedAt)} · {row.problems.length} of {row.denominator}
            {row.status === 'complete' ? ` · ${minutes} min` : ' · paused'}
          </span>
        </span>

        {/* Amber for "still going", never red — an unfinished set is a state,
            not a failure, and the v4 pass retires every danger tone here. */}
        {unfinished ? (
          <span style={{ ...pill, ...ORDINAL.amber, padding: '3px 9px', fontSize: 11, fontWeight: 600 }}>
            Resumes where it stopped
          </span>
        ) : (
          <>
            {/* One text node: `pill` is inline-flex, so adjacent text children
                would become separate flex items and lose the space between
                them ("5in a row unaided"). */}
            {row.longestUnaidedRun > 1 && (
              <span style={{ ...pill, ...ORDINAL.green, padding: '3px 9px', fontSize: 11, fontWeight: 600 }}>
                {`${row.longestUnaidedRun} in a row unaided`}
              </span>
            )}
            <Link
              href={`/sessions/homework/${row.id}`}
              style={{ ...pill, ...ORDINAL.neutral, padding: '3px 9px', fontSize: 11, fontWeight: 600, textDecoration: 'none' }}
            >
              Summary
            </Link>
          </>
        )}
      </div>

      {nested.map((session) => (
        <NestedTutoring key={session.id} session={session} />
      ))}
    </div>
  )
}

type HistoryEntry =
  | { kind: 'homework'; at: string; row: HomeworkSessionRow; nested: RecentSession[] }
  | { kind: 'quick'; at: string; session: RecentSession }

export function HistoryScreen({
  sessions,
  homework,
  now,
}: {
  sessions: RecentSession[]
  /** v4: synced homework sets (ADR-057). Empty for an account with none. */
  homework: HomeworkSessionRow[]
  now: Date
}) {
  // A tutoring session that a homework set claims is nested inside it; whatever
  // is left over was genuinely one-off, and reads as "Quick help".
  const claimed = new Map<string, HomeworkSessionRow>()
  for (const row of homework) {
    if (row.tutoringSessionId) claimed.set(row.tutoringSessionId, row)
  }

  const inProgress = homework.filter((row) => row.status !== 'complete')
  const finished = homework.filter((row) => row.status === 'complete')

  const entries: HistoryEntry[] = [
    ...finished.map((row) => ({
      kind: 'homework' as const,
      at: row.startedAt,
      row,
      nested: sessions.filter((session) => claimed.get(session.id) === row),
    })),
    ...sessions
      .filter((session) => !claimed.has(session.id))
      .map((session) => ({ kind: 'quick' as const, at: session.startedAt, session })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())

  // Preserve newest-first order; group consecutive runs into day buckets.
  const groups: { label: string; items: HistoryEntry[] }[] = []
  for (const entry of entries) {
    const label = bucketOf(entry.at, now)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(entry)
    else groups.push({ label, items: [entry] })
  }

  const setCount = finished.length
  const empty = entries.length === 0 && inProgress.length === 0

  return (
    <div style={{ padding: '26px 40px 56px', maxWidth: 1020, margin: '0 auto' }}>
      <div style={{ ...pageEyebrow, color: T.muted }}>Sessions</div>
      <h2 style={{ fontSize: 32, lineHeight: '38px', fontWeight: 600, letterSpacing: '-0.015em', margin: '6px 0 0' }}>
        Your homework history
      </h2>
      <p style={{ marginTop: 8, marginBottom: 0, fontSize: 14.5, color: T.muted }}>
        {empty
          ? 'Nothing yet — your sessions appear here once you’ve worked a problem in the extension.'
          : setCount > 0
            ? `${setCount} homework set${setCount === 1 ? '' : 's'}, newest first. Anything you worked through with Calyxa is nested inside the set it happened in.`
            : `${entries.length} session${entries.length === 1 ? '' : 's'}, newest first.`}
      </p>

      {/* In progress — first, because a paused set is the one thing here that
          is still actionable. */}
      {inProgress.length > 0 && (
        <section className="cx-rise" style={{ marginTop: 26, ['--cx-i' as string]: 0 }}>
          <div style={{ ...pageEyebrow, color: T.amber }}>In progress</div>
          <div
            className="cx-card"
            style={{ marginTop: 10, padding: '11px 12px 14px', display: 'flex', flexDirection: 'column', gap: 7 }}
          >
            {inProgress.map((row) => (
              <HomeworkRow key={row.id} row={row} nested={[]} />
            ))}
          </div>
        </section>
      )}

      {empty ? (
        <div
          className="cx-card"
          style={{
            marginTop: 22,
            padding: '28px 26px',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            color: T.muted,
            fontSize: 14.5,
          }}
        >
          <HistoryIcon size={20} style={{ color: T.muted, flexShrink: 0 }} />
          Open the Calyxa extension on any math problem and start a session.
        </div>
      ) : (
        groups.map((group, i) => (
          <section key={group.label} className="cx-rise" style={{ marginTop: 26, ['--cx-i' as string]: i + 1 }}>
            <div style={{ ...pageEyebrow, color: T.muted }}>{group.label}</div>
            <div
              className="cx-card"
              style={{
                marginTop: 10,
                padding: '11px 12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 7,
              }}
            >
              {group.items.map((entry) =>
                entry.kind === 'homework' ? (
                  <HomeworkRow key={entry.row.id} row={entry.row} nested={entry.nested} />
                ) : (
                  <SessionRow key={entry.session.id} session={entry.session} />
                ),
              )}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
