'use client'

import Link from 'next/link'
import type { StudyKitDetail } from './kit-read'
import { C, glassCard, sheen, eyebrow, entrance } from './theme'
import { FlashcardsGrid, ProblemsList } from './study-cards'

// The web study-kit viewer (the practice surface — reviews happen here now, not
// a spaced-repetition tab). Mirrors the extension recap card's StudyKitView:
// notes as an ordered list, practice problems with a per-item show/hide
// solution toggle, and flip flashcards. Client component for the reveal + flip
// interaction.

function BackLink() {
  return (
    <Link href="/library" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: C.greenDeep, textDecoration: 'none', marginBottom: 14 }}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3 L5 8 L10 13" /></svg>
      Library
    </Link>
  )
}

function SectionHead({ icon, kicker, title, note }: { icon: React.ReactNode; kicker: string; title: string; note?: string }) {
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 11, paddingBottom: 13 }}>
      <span style={{ flex: 'none', width: 34, height: 34, borderRadius: 11, background: C.mintTile, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
        <span style={eyebrow}>{kicker}</span>
        <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.005em' }}>{title}</span>
      </span>
      {note && <span style={{ fontSize: 12, color: C.muted }}>{note}</span>}
    </div>
  )
}

export function KitViewer({ kit }: { kit: StudyKitDetail }) {
  return (
    <section data-screen-label="Study kit">
      <header style={{ marginBottom: 22, animation: 'cxPop .5s cubic-bezier(.3,1.4,.4,1) both' }}>
        <BackLink />
        <p style={{ margin: '0 0 7px', fontSize: 10, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: C.muted }}>Study kit</p>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: '34px', fontWeight: 600, letterSpacing: '-.015em' }}>{kit.title}</h1>
        <p style={{ margin: '8px 0 0', fontSize: 14, color: C.muted }}>{kit.meta}</p>
      </header>

      {kit.empty && (
        <div style={{ ...glassCard, padding: '28px 22px', fontSize: 14, color: C.muted }}>
          <span style={sheen} />
          <span style={{ position: 'relative' }}>This kit has no content yet.</span>
        </div>
      )}

      {kit.notes.length > 0 && (
        <div style={{ ...glassCard, padding: '16px 19px', marginBottom: 16, ...entrance(0.08) }}>
          <span style={sheen} />
          <SectionHead
            kicker="Notes"
            title="Key takeaways"
            icon={<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#166534" strokeWidth="1.5" strokeLinejoin="round"><rect x="3" y="2" width="10" height="12" rx="1.6" /><path d="M5.5 5.5 H10.5" /><path d="M5.5 8 H10.5" /><path d="M5.5 10.5 H8.5" /></svg>}
          />
          <div style={{ position: 'relative', height: 1, background: C.hair, marginBottom: 10 }} />
          <ol style={{ position: 'relative', margin: 0, paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {kit.notes.map((note, i) => (
              <li key={i} style={{ fontSize: 13.5, lineHeight: '21px' }}>{note}</li>
            ))}
          </ol>
        </div>
      )}

      {kit.problems.length > 0 && (
        <div style={{ ...glassCard, padding: '16px 19px', marginBottom: 16, ...entrance(0.14) }}>
          <span style={sheen} />
          <SectionHead
            kicker="Practice problems"
            title="Work these, then check"
            note={`${kit.problems.length}`}
            icon={<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#166534" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8 L6.5 11.5 L13 4.5" /></svg>}
          />
          <div style={{ position: 'relative', height: 1, background: C.hair, marginBottom: 12 }} />
          <ProblemsList problems={kit.problems} />
        </div>
      )}

      {kit.flashcards.length > 0 && (
        <div style={{ ...glassCard, padding: '16px 19px', ...entrance(0.2) }}>
          <span style={sheen} />
          <SectionHead
            kicker="Flashcards"
            title="Tap to flip"
            note={`${kit.flashcards.length}`}
            icon={<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#166534" strokeWidth="1.5" strokeLinejoin="round"><rect x="2.5" y="4" width="9" height="8" rx="1.4" /><path d="M5.5 2.2 H13 a1 1 0 0 1 1 1 V10" /></svg>}
          />
          <div style={{ position: 'relative', height: 1, background: C.hair, marginBottom: 14 }} />
          <FlashcardsGrid cards={kit.flashcards} />
        </div>
      )}
    </section>
  )
}
