import Link from 'next/link'
import type { DashboardData } from '@/lib/learning/dashboard-read'
import { C, glassCard, glassCardSoft, sheen, entrance } from './theme'
import { misconceptionCards, resolvedLine, RESOLUTION_STREAK } from './derive'

export function MisconceptionsScreen({ data }: { data: DashboardData }) {
  const { active, resolved, activeCount, resolvedCount } = misconceptionCards(data)

  return (
    <section data-screen-label="Misconceptions">
      <header style={{ marginBottom: 22, animation: 'cxPop .5s cubic-bezier(.3,1.4,.4,1) both' }}>
        <p style={{ margin: '0 0 7px', fontSize: 10, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: C.muted }}>Misconceptions</p>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: '34px', fontWeight: 600, letterSpacing: '-.015em' }}>Recurring mistakes</h1>
        <p style={{ margin: '8px 0 0', fontSize: 14, color: C.muted }}>{activeCount} active, {resolvedCount} resolved · {RESOLUTION_STREAK} corrections in a row resolves one</p>
      </header>

      {active.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          {active.map((m, i) => (
            <Link key={m.key} href={`/misconceptions/${m.id}`} style={{ ...glassCard, padding: '16px 19px', ...entrance(0.08 + i * 0.06), display: 'block', textDecoration: 'none', color: C.ink }}>
              <span style={sheen} />
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.09em', textTransform: 'uppercase', color: C.muted, background: 'rgba(28,28,26,.05)', borderRadius: 99, padding: '3px 9px' }}>{m.category}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: m.strandColor, background: m.strandBg, borderRadius: 99, padding: '3px 9px' }}>{m.strandLabel}</span>
              </div>
              <h2 style={{ position: 'relative', margin: '0 0 6px', fontSize: 14.5, fontWeight: 600 }}>{m.title}</h2>
              <p style={{ position: 'relative', margin: '0 0 14px', fontSize: 13, lineHeight: '19px', color: C.muted }}>{m.description}</p>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, paddingTop: 12, borderTop: `1px solid ${C.hair}` }}>
                <span style={{ fontSize: 12, color: C.muted }}>{m.seen}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
                  {m.dots.map((filled, di) => (
                    <span key={di} style={{ width: 16, height: 6, borderRadius: 99, background: filled ? '#4ade80' : 'rgba(28,28,26,.08)' }} />
                  ))}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: m.dots.some(Boolean) ? C.greenInk : C.muted }}>{m.progress}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div style={{ ...glassCardSoft, padding: '16px 19px 12px', ...entrance(0.32) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, paddingBottom: 11 }}>
          <span style={{ flex: 'none', width: 34, height: 34, borderRadius: 11, background: C.mintTile, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#166534" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5 L6.5 12 L13 4.5" /></svg>
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', color: C.muted }}>Fixed for good</span>
            <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.005em' }}>Resolved</span>
          </span>
        </div>
        <div style={{ height: 1, background: C.hair }} />
        {resolved.length > 0 ? (
          resolved.map((m) => (
            <div key={m.conceptKey} className="cx-hover-soft" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 8px', borderRadius: 12 }}>
              <span style={{ width: 8, height: 8, flex: 'none', borderRadius: 99, background: '#4ade80' }} />
              <span style={{ fontSize: 13.5, color: C.muted, flex: 1 }}>
                {m.title} <span style={{ color: C.faint }}>· {m.strandLabel}</span>
              </span>
              <span style={{ fontSize: 12, color: C.muted }}>{resolvedLine(m)}</span>
            </div>
          ))
        ) : (
          <p style={{ fontSize: 13, color: C.muted, padding: '12px 8px 4px' }}>Nothing resolved yet — corrected patterns move here after four corrections in a row.</p>
        )}
      </div>
    </section>
  )
}
