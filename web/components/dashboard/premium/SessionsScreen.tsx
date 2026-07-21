import Link from 'next/link'
import type { RecentSession } from '@/lib/learning/activity-read'
import { Badge } from './primitives'
import { C, glassCard, sheen, eyebrow, entrance } from './theme'

// Sessions — the chronological history of tutoring sessions. Today the sessions
// table stores times + mode + whether a study kit was generated; richer per-
// session detail (subject, concept, misconception, AI summary, screenshot) is a
// follow-up that needs those columns/persistence. This view shows the real
// history honestly and links each session to the materials it produced.

function dayGroup(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((startOf(today) - startOf(d)) / 86_400_000)
  if (diff <= 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff <= 6) return 'This week'
  if (diff <= 30) return 'This month'
  return 'Earlier'
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function dateOf(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function duration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return 'In progress'
  const mins = Math.max(1, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000))
  if (mins < 60) return `${mins} min`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

export function SessionsScreen({ sessions }: { sessions: RecentSession[] }) {
  // Group into chronological buckets, preserving newest-first order.
  const groups: { label: string; items: RecentSession[] }[] = []
  for (const s of sessions) {
    const label = dayGroup(s.startedAt)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(s)
    else groups.push({ label, items: [s] })
  }

  return (
    <section data-screen-label="Sessions">
      <header style={{ marginBottom: 22, animation: 'cxPop .5s cubic-bezier(.3,1.4,.4,1) both' }}>
        <p style={{ margin: '0 0 7px', fontSize: 10, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: C.muted }}>Sessions</p>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: '34px', fontWeight: 600, letterSpacing: '-.015em' }}>Your tutoring history</h1>
        <p style={{ margin: '8px 0 0', fontSize: 14, color: C.muted }}>Every session with the Calyxa extension, newest first.</p>
      </header>

      {sessions.length === 0 ? (
        <div style={{ ...glassCard, padding: '28px 22px', fontSize: 14, color: C.muted }}>
          <span style={sheen} />
          <span style={{ position: 'relative' }}>No sessions yet — start one with the Calyxa extension and your history will build here.</span>
        </div>
      ) : (
        groups.map((g, gi) => (
          <div key={g.label + gi} style={{ marginBottom: 18, ...entrance(0.06 + gi * 0.05) }}>
            <p style={{ ...eyebrow, margin: '0 2px 9px' }}>{g.label}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {g.items.map((s) => {
                const row = (
                  <>
                    <span style={{ position: 'relative', flex: 'none', width: 38, height: 38, borderRadius: 12, background: C.mintTile, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="#166534" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        {s.mode === 'voice' ? (
                          <><rect x="6" y="2.4" width="4" height="7.2" rx="2" /><path d="M4 8 A4 4 0 0 0 12 8" /><path d="M8 12 V13.6" /></>
                        ) : (
                          <><rect x="2.6" y="3.4" width="10.8" height="8" rx="1.6" /><path d="M5 6.4 H11 M5 8.6 H9" /></>
                        )}
                      </svg>
                    </span>
                    <span style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-.005em', textTransform: 'capitalize' }}>{s.mode} session</span>
                      <span style={{ fontSize: 12.5, color: C.muted }}>{dateOf(s.startedAt)} · {timeOf(s.startedAt)} · {duration(s.startedAt, s.endedAt)}</span>
                    </span>
                    {s.hasKit && <Badge bg={C.mintPill} color={C.greenDeep} style={{ position: 'relative', flex: 'none' }}>Study kit</Badge>}
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#9a988f" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'relative', flex: 'none' }}><path d="M6 3 L11 8 L6 13" /></svg>
                  </>
                )
                // Every row opens its detail view (ADR-055) — the session's
                // annotated snapshot timeline, which links on to the kit.
                return (
                  <Link key={s.id} href={`/sessions/${s.id}`} className="cx-hover-soft" style={{ ...glassCard, padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 14, textDecoration: 'none', color: C.ink }}>
                    <span style={sheen} />
                    {row}
                  </Link>
                )
              })}
            </div>
          </div>
        ))
      )}
    </section>
  )
}
