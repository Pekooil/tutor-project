'use client'

import { useState } from 'react'
import type { KitProblem, KitFlashcard } from './kit-read'
import { C, pillAction } from './theme'

// The interactive study widgets (reveal-solution problems + flip flashcards),
// shared between the full kit viewer (KitViewer) and the concept workspace so
// both render practice material identically. Client components — the reveal/flip
// is local interaction.

export function ProblemItem({ statement, solution, index }: { statement: string; solution: string; index: number }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ border: '1px solid rgba(28,28,26,.1)', borderRadius: 13, padding: '13px 15px', background: 'rgba(255,255,255,.5)' }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <span style={{ flex: 'none', fontSize: 12.5, fontWeight: 600, color: C.greenInk }}>{index + 1}.</span>
        <span style={{ fontSize: 13.5, lineHeight: '20px' }}>{statement}</span>
      </div>
      <button onClick={() => setOpen((o) => !o)} className="cx-hover-pill" style={{ ...pillAction, marginTop: 11 }}>
        {open ? 'Hide solution' : 'Show solution'}
      </button>
      {open && (
        <div style={{ marginTop: 11, paddingTop: 11, borderTop: `1px solid ${C.hair}`, fontSize: 13, lineHeight: '20px', color: '#1c1c1a', whiteSpace: 'pre-wrap' }}>{solution}</div>
      )}
    </div>
  )
}

export function FlipCard({ front, back }: { front: string; back: string }) {
  const [flipped, setFlipped] = useState(false)
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={flipped}
      onClick={() => setFlipped((f) => !f)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setFlipped((f) => !f)
        }
      }}
      style={{ perspective: 1000, cursor: 'pointer', outline: 'none' }}
    >
      <div style={{ position: 'relative', height: 132, transformStyle: 'preserve-3d', transition: 'transform .5s cubic-bezier(.3,1.1,.4,1)', transform: flipped ? 'rotateY(180deg)' : 'none' }}>
        {[false, true].map((isBack) => (
          <div
            key={String(isBack)}
            style={{
              position: 'absolute',
              inset: 0,
              backfaceVisibility: 'hidden',
              transform: isBack ? 'rotateY(180deg)' : 'none',
              borderRadius: 14,
              border: '1px solid rgba(28,28,26,.1)',
              background: isBack ? 'rgba(134,239,172,.18)' : 'rgba(255,255,255,.7)',
              boxShadow: '0 8px 22px rgba(28,40,30,.1)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '14px 16px',
              textAlign: 'center',
            }}
          >
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', color: C.muted, marginBottom: 8 }}>{isBack ? 'Answer' : 'Prompt'}</span>
            <span style={{ fontSize: 14, lineHeight: '20px', fontWeight: isBack ? 500 : 600 }}>{isBack ? back : front}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** A grid of flip flashcards. */
export function FlashcardsGrid({ cards }: { cards: KitFlashcard[] }) {
  return (
    <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
      {cards.map((c, i) => (
        <FlipCard key={i} front={c.front} back={c.back} />
      ))}
    </div>
  )
}

/** A stacked list of reveal-solution practice problems. */
export function ProblemsList({ problems }: { problems: KitProblem[] }) {
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {problems.map((p, i) => (
        <ProblemItem key={i} statement={p.statement} solution={p.solution} index={i} />
      ))}
    </div>
  )
}
