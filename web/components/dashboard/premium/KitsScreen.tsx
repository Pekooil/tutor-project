import Link from 'next/link'
import type { StudyKit } from './kits-read'
import { C, glassCard, sheen, entrance } from './theme'

export function KitsScreen({ kits }: { kits: StudyKit[] }) {
  return (
    <section data-screen-label="Study kits">
      <header style={{ marginBottom: 22, animation: 'cxPop .5s cubic-bezier(.3,1.4,.4,1) both' }}>
        <p style={{ margin: '0 0 7px', fontSize: 10, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: C.muted }}>Study kits</p>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: '34px', fontWeight: 600, letterSpacing: '-.015em' }}>Generated from your sessions</h1>
        <p style={{ margin: '8px 0 0', fontSize: 14, color: C.muted }}>Every session can leave notes, practice problems, and flashcards behind.</p>
      </header>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(240,253,244,.75)', border: '1px dashed #bbf7d0', borderRadius: 17, padding: '13px 19px', marginBottom: 16, backdropFilter: 'blur(22px) saturate(1.5)', WebkitBackdropFilter: 'blur(22px) saturate(1.5)', ...entrance(0.06) }}>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.09em', textTransform: 'uppercase', color: C.greenInk, background: C.greenBg, borderRadius: 99, padding: '3px 9px' }}>Sprint 21</span>
        <span style={{ fontSize: 13, color: C.greenDeep }}>The generator and storage are live — this page lists the kits your sessions leave behind.</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {kits.length > 0 ? (
          kits.map((k, i) => (
            <div key={k.key} style={{ ...glassCard, padding: '15px 17px', display: 'flex', alignItems: 'center', gap: 14, ...entrance(0.12 + i * 0.07) }}>
              <span style={sheen} />
              <span style={{ position: 'relative', flex: 'none', width: 38, height: 38, borderRadius: 12, background: C.mintTile, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="#166534" strokeWidth="1.5" strokeLinejoin="round"><rect x="2.8" y="3" width="10.4" height="10" rx="1.6" /><path d="M6.2 3 V13" /></svg>
              </span>
              <span style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: '-.005em' }}>{k.title}</span>
                <span style={{ fontSize: 12.5, color: C.muted }}>{k.meta}</span>
              </span>
              <span style={{ position: 'relative', display: 'flex', gap: 6 }}>
                {k.kinds.notes && <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: C.muted, background: 'rgba(28,28,26,.05)', borderRadius: 99, padding: '4px 10px' }}>Notes</span>}
                {k.kinds.problems && <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: C.blue, background: 'rgba(37,99,235,.08)', borderRadius: 99, padding: '4px 10px' }}>Problems</span>}
                {k.kinds.flashcards && <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: C.amber, background: 'rgba(146,64,14,.09)', borderRadius: 99, padding: '4px 10px' }}>Flashcards</span>}
              </span>
              <Link href={`/kits/${k.href}`} style={{ position: 'relative', flex: 'none', border: 'none', borderRadius: 99, padding: '8px 16px', fontSize: 12.5, fontWeight: 600, color: C.greenDeep, background: 'rgba(134,239,172,.28)', cursor: 'pointer', textDecoration: 'none' }} className="cx-hover-pill">Open</Link>
            </div>
          ))
        ) : (
          <div style={{ ...glassCard, padding: '28px 22px', fontSize: 14, color: C.muted }}>
            <span style={sheen} />
            <span style={{ position: 'relative' }}>No study kits yet — finish a tutoring session and Calyxa will turn it into notes, practice problems, and flashcards here.</span>
          </div>
        )}
      </div>
    </section>
  )
}
