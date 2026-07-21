'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { CSSProperties } from 'react'
import type { DashboardStrandGroup } from '@/lib/learning/dashboard-read'
import { C, STATE_STYLE, strandStyle, pct } from './theme'
import { nodeMeta } from './derive'

type Sort = 'weakest' | 'strongest' | 'recent'

const toggleBase: CSSProperties = {
  border: 'none',
  borderRadius: 99,
  padding: '6px 13px',
  fontSize: 12.5,
  cursor: 'pointer',
}

function toggleStyle(active: boolean): CSSProperties {
  return {
    ...toggleBase,
    background: active ? 'rgba(134,239,172,.35)' : 'transparent',
    color: active ? C.greenDeep : C.muted,
    fontWeight: active ? 600 : 500,
  }
}

export function MasteryScreen({
  strands,
  nowMs,
  totalConcepts,
  hrefBase = '/mastery',
  heading,
}: {
  strands: DashboardStrandGroup[]
  nowMs: number
  totalConcepts: number
  /** Route prefix each concept row links to (`/mastery` or `/concepts`). */
  hrefBase?: string
  /** Optional header copy override (the Concepts view reframes this grid). */
  heading?: { kicker: string; title: string; subtitle: string }
}) {
  const [sort, setSort] = useState<Sort>('weakest')
  const now = new Date(nowMs)
  const populated = strands.filter((s) => s.nodes.length > 0)

  const cmp =
    sort === 'strongest'
      ? (a: { mastery: number }, b: { mastery: number }) => b.mastery - a.mastery
      : sort === 'recent'
        ? (a: { lastPracticedAt: string | null }, b: { lastPracticedAt: string | null }) =>
            (b.lastPracticedAt ?? '').localeCompare(a.lastPracticedAt ?? '')
        : (a: { mastery: number }, b: { mastery: number }) => a.mastery - b.mastery

  return (
    <section data-screen-label="Mastery">
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 22, animation: 'cxPop .5s cubic-bezier(.3,1.4,.4,1) both' }}>
        <div>
          <p style={{ margin: '0 0 7px', fontSize: 10, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: C.muted }}>{heading?.kicker ?? 'Mastery'}</p>
          <h1 style={{ margin: 0, fontSize: 28, lineHeight: '34px', fontWeight: 600, letterSpacing: '-.015em' }}>{heading?.title ?? 'All six strands'}</h1>
          <p style={{ margin: '8px 0 0', fontSize: 14, color: C.muted }}>{heading?.subtitle ?? `Updated as you study · ${totalConcepts} concept${totalConcepts === 1 ? '' : 's'} practiced so far`}</p>
        </div>
        <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,.72)', border: '1px solid rgba(28,28,26,.09)', borderRadius: 99, padding: 4, backdropFilter: 'blur(22px) saturate(1.5)', WebkitBackdropFilter: 'blur(22px) saturate(1.5)', boxShadow: '0 2px 8px rgba(28,40,30,.06)' }}>
          <button onClick={() => setSort('weakest')} style={toggleStyle(sort === 'weakest')}>Weakest first</button>
          <button onClick={() => setSort('strongest')} style={toggleStyle(sort === 'strongest')}>Strongest first</button>
          <button onClick={() => setSort('recent')} style={toggleStyle(sort === 'recent')}>Recently practiced</button>
        </div>
      </header>

      {populated.length === 0 && (
        <div style={{ position: 'relative', background: 'rgba(255,255,255,.8)', border: '1px solid rgba(28,28,26,.1)', borderRadius: 17, padding: '28px 22px', backdropFilter: 'blur(22px) saturate(1.5)', WebkitBackdropFilter: 'blur(22px) saturate(1.5)', boxShadow: '0 18px 44px rgba(28,40,30,.14),0 2px 8px rgba(28,40,30,.07)', fontSize: 14, color: C.muted }}>
          No concepts practiced yet — start a session with the Calyxa extension and your mastery will build here, strand by strand.
        </div>
      )}

      {populated.map((s, i) => {
        const st = strandStyle(s.strand)
        const avg = pct(s.averageMastery)
        const mastered = s.nodes.filter((n) => n.state === 'mastered').length
        const nodes = [...s.nodes].sort(cmp)
        return (
          <div key={s.strand} style={{ position: 'relative', background: 'rgba(255,255,255,.8)', border: '1px solid rgba(28,28,26,.1)', borderRadius: 17, padding: '16px 17px 10px', backdropFilter: 'blur(22px) saturate(1.5)', WebkitBackdropFilter: 'blur(22px) saturate(1.5)', boxShadow: '0 18px 44px rgba(28,40,30,.14),0 2px 8px rgba(28,40,30,.07)', overflow: 'hidden', marginBottom: 16, animation: `cxPop .5s cubic-bezier(.3,1.4,.4,1) ${(0.08 + i * 0.06).toFixed(2)}s both` }}>
            <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(255,255,255,.45),rgba(255,255,255,0) 42%)', pointerEvents: 'none' }} />
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 11, paddingBottom: 12 }}>
              <span style={{ flex: 'none', width: 34, height: 34, borderRadius: 11, background: st.tileBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ width: 10, height: 10, borderRadius: 99, background: st.color }} />
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', color: C.muted }}>{s.nodes.length} concepts · {mastered} mastered</span>
                <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.005em' }}>{st.label}</span>
              </span>
              <span style={{ flex: 'none', width: 30, height: 30, borderRadius: 99, background: `conic-gradient(${st.color} 0 ${avg}%, rgba(28,28,26,.07) 0)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ width: 20, height: 20, borderRadius: 99, background: 'rgba(255,255,255,.95)' }} />
              </span>
              <span style={{ flex: 'none', fontSize: 11.5, fontWeight: 600, borderRadius: 99, padding: '3px 10px', background: 'rgba(28,28,26,.05)' }}>{avg}%</span>
            </div>
            <div style={{ position: 'relative', height: 1, background: C.hair, marginBottom: 2 }} />
            {nodes.map((n) => {
              const style = STATE_STYLE[n.state]
              const p = pct(n.mastery)
              return (
                <Link key={n.conceptKey} href={`${hrefBase}/${n.conceptKey}`} className="cx-hover-soft" style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) 86px minmax(0,1fr) minmax(140px,180px)', gap: 14, alignItems: 'center', padding: '9px 8px', borderRadius: 12, textDecoration: 'none', color: C.ink }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.title}</span>
                  <span style={{ justifySelf: 'start', fontSize: 10, fontWeight: 600, letterSpacing: '.09em', textTransform: 'uppercase', borderRadius: 99, padding: '3px 9px', background: style.chipBg, color: style.ink }}>{style.label}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ flex: 1, height: 7, borderRadius: 99, background: 'rgba(28,28,26,.06)', overflow: 'hidden' }}>
                      <span style={{ display: 'block', height: 7, borderRadius: 99, background: style.bar, width: p + '%', transformOrigin: 'left', animation: 'cxGrow .9s cubic-bezier(.3,1.2,.4,1) .3s both' }} />
                    </span>
                    <span style={{ width: 36, fontSize: 12.5, fontWeight: 600 }}>{n.observationCount === 0 ? '—' : p + '%'}</span>
                  </span>
                  <span style={{ fontSize: 12, color: C.muted, textAlign: 'right' }}>{nodeMeta(n.observationCount, n.confidenceBand, n.lastPracticedAt, now)}</span>
                </Link>
              )
            })}
          </div>
        )
      })}
    </section>
  )
}
