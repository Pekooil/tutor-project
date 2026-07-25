import Link from 'next/link'
import type { RecentSession } from '@/lib/learning/activity-read'
import { T, ORDINAL, MOTION, eyebrow, pill } from './tokens'
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
    padding: '13px 16px',
    border: `1px solid ${T.border}`,
    borderRadius: 11,
    background: 'transparent',
    color: T.ink,
    textDecoration: 'none' as const,
    transition: `background ${MOTION.fast} ${MOTION.ease}, border-color ${MOTION.fast} ${MOTION.ease}`,
  }

  const body = (
    <>
      <span
        aria-hidden="true"
        style={{
          width: 34,
          height: 34,
          flexShrink: 0,
          borderRadius: 10,
          background: T.accentSubtle,
          color: T.accentInk,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {voice ? <MicIcon size={16} /> : <NotesIcon size={16} />}
      </span>

      <span style={{ minWidth: 0, flex: 1 }}>
        {/* The concept leads — it's what makes a row identifiable. The mode and
            timing are the supporting detail, not the headline. */}
        <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600 }}>
          {session.conceptTitle ?? (voice ? 'Voice session' : 'Text session')}
        </span>
        <span style={{ display: 'block', fontSize: 11.5, color: T.muted, marginTop: 2 }}>
          {voice ? 'Voice' : 'Text'} · {dayOf(session.startedAt)} · {timeOf(session.startedAt)}
          {minutes !== null ? ` · ${minutes} min` : ' · still open'}
          {!session.conceptKey ? ' · no concept recorded' : ''}
        </span>
      </span>

      {session.hasKit && (
        <span
          title="This session produced a study kit"
          style={{ ...pill, ...ORDINAL.green, padding: '3px 9px', fontSize: 11, fontWeight: 700 }}
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

export function HistoryScreen({ sessions, now }: { sessions: RecentSession[]; now: Date }) {
  // Preserve the newest-first order the loader gives us; group consecutive runs.
  const groups: { label: string; items: RecentSession[] }[] = []
  for (const s of sessions) {
    const label = bucketOf(s.startedAt, now)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(s)
    else groups.push({ label, items: [s] })
  }

  const withKit = sessions.filter((s) => s.hasKit).length

  return (
    <div style={{ padding: '8px 40px 48px', maxWidth: 1020, margin: '0 auto' }}>
      <div style={{ ...eyebrow, color: T.muted }}>Sessions</div>
      <h2 style={{ fontSize: 32, lineHeight: 1.18, fontWeight: 600, letterSpacing: '-0.015em', margin: '6px 0 0' }}>
        Your tutoring history
      </h2>
      <p style={{ marginTop: 8, marginBottom: 0, fontSize: 14.5, color: T.muted }}>
        {sessions.length === 0
          ? 'Nothing yet — your sessions appear here once you’ve worked a problem in the extension.'
          : `${sessions.length} session${sessions.length === 1 ? '' : 's'}, newest first${
              withKit > 0 ? ` · ${withKit} produced a study kit` : ''
            }.`}
      </p>

      {sessions.length === 0 ? (
        <div
          style={{
            marginTop: 22,
            background: T.card,
            border: `1px solid ${T.border}`,
            borderRadius: 14,
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
        groups.map((group) => (
          <section key={group.label} style={{ marginTop: 26 }}>
            <div style={{ ...eyebrow, color: T.muted, fontWeight: 600, letterSpacing: '0.14em' }}>
              {group.label}
            </div>
            <div
              style={{
                marginTop: 10,
                background: T.card,
                border: `1px solid ${T.border}`,
                borderRadius: 14,
                padding: '8px 12px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              {group.items.map((s) => (
                <SessionRow key={s.id} session={s} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
