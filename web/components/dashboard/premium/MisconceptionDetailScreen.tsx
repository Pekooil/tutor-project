import Link from 'next/link'
import type { MisconceptionDetail } from './detail-read'
import { formatDay, formatLastPracticed } from '@/components/dashboard/format'
import { C, glassCard, sheen, eyebrow, entrance, pillAction, STATE_STYLE, pct } from './theme'

function BackLink() {
  return (
    <Link href="/dashboard" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: C.greenDeep, textDecoration: 'none', marginBottom: 14 }}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3 L5 8 L10 13" /></svg>
      Dashboard
    </Link>
  )
}

export function MisconceptionDetailScreen({ detail }: { detail: MisconceptionDetail }) {
  const m = detail.misconception
  const filled = Math.min(detail.resolutionStreak, Math.max(0, m.consecutiveCorrect))
  const resolved = m.status === 'resolved'
  // `pending` — seen once, not yet a confirmed pattern. Previously fell through
  // to "Active", which overstated a single slip.
  const watching = m.status === 'pending'
  const category = m.category ? m.category.charAt(0).toUpperCase() + m.category.slice(1) : 'Pattern'
  const node = detail.conceptNode
  const nodeStyle = node ? STATE_STYLE[node.state] : null

  return (
    <section data-screen-label="Misconception">
      <header style={{ marginBottom: 22, animation: 'cxPop .5s cubic-bezier(.3,1.4,.4,1) both' }}>
        <BackLink />
        <p style={{ margin: '0 0 7px', fontSize: 10, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: detail.strandColor }}>{m.strandLabel}</p>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: '34px', fontWeight: 600, letterSpacing: '-.015em' }}>{m.title}</h1>
      </header>

      <div style={{ ...glassCard, padding: '16px 19px', marginBottom: 16, ...entrance(0.06) }}>
        <span style={sheen} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.09em', textTransform: 'uppercase', color: C.muted, background: 'rgba(28,28,26,.05)', borderRadius: 99, padding: '3px 9px' }}>{category}</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 600, letterSpacing: '.09em', textTransform: 'uppercase', borderRadius: 99, padding: '3px 9px', background: resolved ? 'rgba(134,239,172,.3)' : watching ? 'rgba(37,99,235,.1)' : 'rgba(146,64,14,.09)', color: resolved ? C.greenDeep : watching ? C.blue : C.amber }}>{resolved ? 'Resolved' : watching ? 'Watching' : 'Active'}</span>
        </div>
        {m.description && <p style={{ position: 'relative', margin: '0 0 14px', fontSize: 14, lineHeight: '21px', color: '#1c1c1a' }}>{m.description}</p>}

        {/* Resolution progress */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, paddingTop: 12, borderTop: `1px solid ${C.hair}` }}>
          <span style={{ fontSize: 12.5, color: C.muted }}>{resolved ? 'Resolved' : watching ? 'Seen once — not a confirmed pattern yet' : `${detail.resolutionStreak - filled} more correct in a row to resolve`}</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
            {Array.from({ length: detail.resolutionStreak }).map((_, i) => (
              <span key={i} style={{ width: 18, height: 6, borderRadius: 99, background: resolved || i < filled ? '#4ade80' : 'rgba(28,28,26,.08)' }} />
            ))}
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: filled > 0 || resolved ? C.greenInk : C.muted }}>{resolved ? detail.resolutionStreak : filled} of {detail.resolutionStreak}</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        {/* History */}
        <div style={{ ...glassCard, padding: '16px 19px', ...entrance(0.12) }}>
          <span style={sheen} />
          <span style={{ ...eyebrow, position: 'relative', display: 'block', marginBottom: 10 }}>History</span>
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, color: C.muted }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Times seen</span><span style={{ color: C.ink, fontWeight: 500 }}>{m.occurrenceCount}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>First seen</span><span style={{ color: C.ink, fontWeight: 500 }}>{formatDay(m.firstSeenAt)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Last seen</span><span style={{ color: C.ink, fontWeight: 500 }}>{formatDay(m.lastSeenAt)}</span></div>
            {resolved && m.resolvedAt && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Resolved</span><span style={{ color: C.greenInk, fontWeight: 500 }}>{formatDay(m.resolvedAt)}</span></div>}
          </div>
        </div>

        {/* Related concept */}
        <div style={{ ...glassCard, padding: '16px 19px', ...entrance(0.18) }}>
          <span style={sheen} />
          <span style={{ ...eyebrow, position: 'relative', display: 'block', marginBottom: 10 }}>Concept</span>
          <Link href={`/notes/${encodeURIComponent(m.conceptKey)}`} className="cx-hover-soft" style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 8px', borderRadius: 12, textDecoration: 'none', color: C.ink }}>
            <span style={{ fontSize: 13.5, fontWeight: 500, flex: 1, minWidth: 0 }}>{node?.title ?? m.title}</span>
            {nodeStyle && node ? (
              <>
                <span style={{ flex: 'none', fontSize: 10, fontWeight: 600, letterSpacing: '.09em', textTransform: 'uppercase', borderRadius: 99, padding: '3px 9px', background: nodeStyle.chipBg, color: nodeStyle.ink }}>{nodeStyle.label}</span>
                <span style={{ flex: 'none', fontSize: 12.5, fontWeight: 600 }}>{pct(node.mastery)}%</span>
              </>
            ) : (
              <span style={{ flex: 'none', fontSize: 11.5, color: C.faint }}>Not practiced</span>
            )}
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#9a988f" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3 L11 8 L6 13" /></svg>
          </Link>
          {node && <p style={{ position: 'relative', margin: '8px 8px 0', fontSize: 12, color: C.muted }}>{formatLastPracticed(node.lastPracticedAt)}</p>}
          {detail.kitHref && (
            <div style={{ position: 'relative', marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.hair}` }}>
              <Link href={`/kits/${detail.kitHref}`} className="cx-hover-pill" style={pillAction}>Practice with study kit &rarr;</Link>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
