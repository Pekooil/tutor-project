import Link from 'next/link'
import type { ConceptDetail, RelatedConcept } from './detail-read'
import { formatLastPracticed } from '@/components/dashboard/format'
import { C, glassCard, sheen, eyebrow, entrance, pillAction, STATE_STYLE, pct } from './theme'
import type { MasteryState } from '@/lib/ai/profile'

function BackLink() {
  return (
    <Link href="/mastery" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: C.greenDeep, textDecoration: 'none', marginBottom: 14 }}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3 L5 8 L10 13" /></svg>
      All concepts
    </Link>
  )
}

function RelatedRow({ r }: { r: RelatedConcept }) {
  const style = r.state ? STATE_STYLE[r.state as MasteryState] : null
  return (
    <Link href={`/mastery/${r.conceptKey}`} className="cx-hover-soft" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 8px', borderRadius: 12, textDecoration: 'none', color: C.ink }}>
      <span style={{ fontSize: 13.5, fontWeight: 500, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</span>
      {style ? (
        <span style={{ flex: 'none', fontSize: 10, fontWeight: 600, letterSpacing: '.09em', textTransform: 'uppercase', borderRadius: 99, padding: '3px 9px', background: style.chipBg, color: style.ink }}>{style.label}</span>
      ) : (
        <span style={{ flex: 'none', fontSize: 11.5, color: C.faint }}>Not practiced</span>
      )}
      {r.mastery != null && <span style={{ flex: 'none', width: 36, textAlign: 'right', fontSize: 12.5, fontWeight: 600 }}>{pct(r.mastery)}%</span>}
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#9a988f" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><path d="M6 3 L11 8 L6 13" /></svg>
    </Link>
  )
}

export function ConceptDetailScreen({ detail }: { detail: ConceptDetail }) {
  const { node } = detail
  const style = node ? STATE_STYLE[node.state] : null

  return (
    <section data-screen-label="Concept">
      <header style={{ marginBottom: 22, animation: 'cxPop .5s cubic-bezier(.3,1.4,.4,1) both' }}>
        <BackLink />
        <p style={{ margin: '0 0 7px', fontSize: 10, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: detail.strandColor }}>{detail.strandLabel}</p>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: '34px', fontWeight: 600, letterSpacing: '-.015em' }}>{detail.title}</h1>
      </header>

      {/* Mastery summary */}
      <div style={{ ...glassCard, padding: '16px 19px', marginBottom: 16, ...entrance(0.06) }}>
        <span style={sheen} />
        {node ? (
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              {style && <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.09em', textTransform: 'uppercase', borderRadius: 99, padding: '3px 10px', background: style.chipBg, color: style.ink }}>{style.label}</span>}
              <span style={{ marginLeft: 'auto', fontSize: 22, fontWeight: 600 }}>{pct(node.mastery)}%</span>
            </div>
            <span style={{ display: 'block', height: 8, borderRadius: 99, background: 'rgba(28,28,26,.06)', overflow: 'hidden', marginBottom: 12 }}>
              <span style={{ display: 'block', height: 8, borderRadius: 99, background: style?.bar, width: `${pct(node.mastery)}%`, transformOrigin: 'left', animation: 'cxGrow .9s cubic-bezier(.3,1.2,.4,1) .2s both' }} />
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 12.5, color: C.muted }}>
              <span>{node.observationCount} observation{node.observationCount === 1 ? '' : 's'}</span>
              <span>{node.confidenceBand} confidence</span>
              <span>{formatLastPracticed(node.lastPracticedAt)}</span>
            </div>
          </div>
        ) : (
          <p style={{ position: 'relative', margin: 0, fontSize: 14, color: C.muted }}>Not practiced yet — this concept will fill in once you meet it in a session.</p>
        )}
        {detail.kitHref && (
          <div style={{ position: 'relative', marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.hair}` }}>
            <Link href={`/kits/${detail.kitHref}`} className="cx-hover-pill" style={pillAction}>Practice with study kit &rarr;</Link>
          </div>
        )}
      </div>

      {/* Misconceptions on this concept */}
      {detail.misconceptions.length > 0 && (
        <div style={{ ...glassCard, padding: '16px 19px', marginBottom: 16, ...entrance(0.12) }}>
          <span style={sheen} />
          <span style={{ ...eyebrow, position: 'relative', display: 'block', marginBottom: 10 }}>Misconceptions here</span>
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
            {detail.misconceptions.map((m) => (
              <Link key={m.id} href={`/misconceptions/${m.id}`} className="cx-hover-soft" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 8px', borderRadius: 12, textDecoration: 'none', color: C.ink }}>
                <span style={{ width: 8, height: 8, flex: 'none', borderRadius: 99, background: m.status === 'resolved' ? '#4ade80' : C.amber }} />
                <span style={{ fontSize: 13.5, fontWeight: 500, flex: 1, minWidth: 0 }}>{m.title}</span>
                <span style={{ flex: 'none', fontSize: 11.5, color: C.muted }}>{m.status === 'resolved' ? 'Resolved' : `Seen ${m.occurrenceCount}×`}</span>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#9a988f" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3 L11 8 L6 13" /></svg>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        {/* Prerequisites */}
        <div style={{ ...glassCard, padding: '16px 19px', ...entrance(0.18) }}>
          <span style={sheen} />
          <span style={{ ...eyebrow, position: 'relative', display: 'block', marginBottom: 10 }}>Build on first</span>
          <div style={{ position: 'relative' }}>
            {detail.prerequisites.length > 0 ? (
              detail.prerequisites.map((r) => <RelatedRow key={r.conceptKey} r={r} />)
            ) : (
              <p style={{ fontSize: 13, color: C.muted, padding: '4px 8px' }}>No prerequisites — this is a foundation concept.</p>
            )}
          </div>
        </div>

        {/* Dependents */}
        <div style={{ ...glassCard, padding: '16px 19px', ...entrance(0.24) }}>
          <span style={sheen} />
          <span style={{ ...eyebrow, position: 'relative', display: 'block', marginBottom: 10 }}>Leads to</span>
          <div style={{ position: 'relative' }}>
            {detail.dependents.length > 0 ? (
              detail.dependents.map((r) => <RelatedRow key={r.conceptKey} r={r} />)
            ) : (
              <p style={{ fontSize: 13, color: C.muted, padding: '4px 8px' }}>Nothing depends on this concept yet.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
