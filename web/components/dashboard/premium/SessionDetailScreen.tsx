import Link from 'next/link'
import type { SessionDetail } from './snapshots-read'
import { C, glassCard, sheen, eyebrow, entrance } from './theme'
import { SnapshotBoardList } from './study-snapshots-board'

// ADR-055: the Sessions detail view (brief §3) — one tutoring session replayed
// as its ordered timeline of worked-problem snapshots (the tutor's annotated
// turns), with the session's own meta. Server-rendered, RLS-scoped via
// loadSessionDetail. Text-based: it replays persisted annotations, never a
// pixel capture.

function dateOf(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}
function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
function duration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return 'In progress'
  const mins = Math.max(1, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000))
  if (mins < 60) return `${mins} min`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

export function SessionDetailScreen({ detail }: { detail: SessionDetail }) {
  const withAnnotations = detail.snapshots.filter((s) => s.annotations.length > 0).length

  return (
    <section data-screen-label="Session">
      <header style={{ marginBottom: 22, animation: 'cxPop .5s cubic-bezier(.3,1.4,.4,1) both' }}>
        <Link href="/sessions" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: C.greenDeep, textDecoration: 'none', marginBottom: 14 }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3 L5 8 L10 13" /></svg>
          All sessions
        </Link>
        <p style={{ margin: '0 0 7px', fontSize: 10, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: C.muted }}>{dateOf(detail.startedAt)}</p>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: '34px', fontWeight: 600, letterSpacing: '-.015em', textTransform: 'capitalize' }}>{detail.mode} session</h1>
        <p style={{ margin: '8px 0 0', fontSize: 14, color: C.muted }}>
          {timeOf(detail.startedAt)} · {duration(detail.startedAt, detail.endedAt)} · {detail.snapshots.length} turn{detail.snapshots.length === 1 ? '' : 's'}
        </p>
      </header>

      {detail.snapshots.length === 0 ? (
        <div style={{ ...glassCard, padding: '28px 22px', fontSize: 14, color: C.muted }}>
          <span style={sheen} />
          <span style={{ position: 'relative' }}>This session has no recorded turns.</span>
        </div>
      ) : (
        <div style={{ ...glassCard, padding: '16px 19px', ...entrance(0.06) }}>
          <span style={sheen} />
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={eyebrow}>Worked-problem timeline</span>
            {withAnnotations > 0 && <span style={{ fontSize: 12, color: C.muted }}>{withAnnotations} annotated</span>}
          </div>
          <div style={{ position: 'relative' }}>
            <SnapshotBoardList snapshots={detail.snapshots} showConcept />
          </div>
        </div>
      )}
    </section>
  )
}
