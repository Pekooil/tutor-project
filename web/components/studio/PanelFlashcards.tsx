'use client'

import { useState } from 'react'
import type { KitFlashcard } from '@/components/dashboard/premium/kit-read'
import { T, SHADOW, MOTION, RADIUS, accentButton, ghostButton } from './tokens'
import { MathText } from './math'
import { ChevronLeft } from './icons'

// The flashcard viewer, adapted to live INSIDE the Ask Calyxa panel rather than on
// its own full-screen route. Same two stages and the same flip mechanic, at panel
// width: a shorter card, a compact deck-size picker, and a back affordance to the
// panel's home state.
//
// SHELL SCOPE (unchanged): the size picker chooses how many of the EXISTING cards
// to study — it does not generate new ones. The options are built from the deck
// that actually exists, so the button never promises cards Calyxa cannot deal.

const SIZES: { n: number; label: string }[] = [
  { n: 10, label: 'Quick' },
  { n: 20, label: 'Standard' },
  { n: 30, label: 'Full' },
]

function sizeOptions(total: number): { n: number; label: string }[] {
  const rungs = SIZES.filter((s) => s.n < total)
  return [...rungs, { n: total, label: rungs.length === 0 ? 'All' : 'Everything' }]
}

export function PanelFlashcards({
  title,
  cards,
  onBack,
}: {
  title: string
  cards: KitFlashcard[]
  onBack: () => void
}) {
  const options = sizeOptions(cards.length)
  const [stage, setStage] = useState<'setup' | 'cards'>('setup')
  const [count, setCount] = useState(
    () => options.find((o) => o.n === 20)?.n ?? options[options.length - 1]?.n ?? cards.length
  )
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)

  const back = (
    <button
      type="button"
      onClick={stage === 'cards' ? () => setStage('setup') : onBack}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        color: T.muted,
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      <ChevronLeft size={14} /> {stage === 'cards' ? 'Deck size' : 'Back'}
    </button>
  )

  if (cards.length === 0) {
    return (
      <>
        {back}
        <h3 style={{ fontSize: 16, fontWeight: 600, margin: '14px 0 6px' }}>No flashcards yet</h3>
        <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.55, margin: 0 }}>
          Calyxa builds a deck from a finished session on {title}. Work it in the extension and the cards show
          up here.
        </p>
      </>
    )
  }

  if (stage === 'setup') {
    return (
      <>
        {back}
        <h3 style={{ fontSize: 16, fontWeight: 600, margin: '14px 0 4px' }}>Flashcards</h3>
        <p style={{ fontSize: 13, color: T.muted, margin: '0 0 14px' }}>
          How many of your {cards.length} cards do you want?
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${options.length}, 1fr)`, gap: 8 }}>
          {options.map((size) => {
            const on = count === size.n
            return (
              <button
                key={size.n}
                type="button"
                onClick={() => setCount(size.n)}
                aria-pressed={on}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  padding: '14px 6px',
                  borderRadius: RADIUS.box,
                  cursor: 'pointer',
                  background: on ? T.accent : 'transparent',
                  border: `1.5px solid ${on ? T.accent : T.frame}`,
                  color: on ? T.onAccent : T.ink,
                }}
              >
                <span style={{ fontSize: 20, fontWeight: 600 }}>{size.n}</span>
                <span style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>{size.label}</span>
              </button>
            )
          })}
        </div>

        <button
          type="button"
          onClick={() => {
            setIndex(0)
            setFlipped(false)
            setStage('cards')
          }}
          style={{ ...accentButton, width: '100%', padding: 12, fontSize: 14, marginTop: 14 }}
        >
          Study {Math.min(count, cards.length)} cards
        </button>
      </>
    )
  }

  const deck = cards.slice(0, Math.min(count, cards.length))
  const card = deck[index]

  function step(delta: number) {
    setFlipped(false)
    setIndex((i) => (i + delta + deck.length) % deck.length)
  }

  const face = {
    position: 'absolute' as const,
    inset: 0,
    backfaceVisibility: 'hidden' as const,
    borderRadius: RADIUS.capsule,
    padding: 20,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    textAlign: 'center' as const,
  }

  const label = { fontSize: 10, fontWeight: 600, letterSpacing: '0.09em', textTransform: 'uppercase' as const }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {back}
        <span style={{ fontSize: 12, fontWeight: 600, color: T.muted }}>
          {index + 1} / {deck.length}
        </span>
      </div>

      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        aria-label={flipped ? 'Show the prompt' : 'Show the answer'}
        style={{
          width: '100%',
          height: 210,
          perspective: 900,
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          marginTop: 14,
        }}
      >
        <span
          style={{
            position: 'relative',
            display: 'block',
            width: '100%',
            height: '100%',
            transformStyle: 'preserve-3d',
            transform: flipped ? 'rotateY(180deg)' : 'none',
            transition: `transform calc(${MOTION.base} * 2.25) ${MOTION.ease}`,
          }}
        >
          <span style={{ ...face, background: T.raised, border: `1px solid ${T.frame}`, boxShadow: SHADOW.flashcard }}>
            <span style={{ ...label, color: T.muted }}>Prompt</span>
            <span style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.45, color: T.ink }}>
              <MathText expr={card.front} />
            </span>
            <span style={{ fontSize: 11.5, color: T.muted }}>Click to flip</span>
          </span>

          <span
            style={{
              ...face,
              transform: 'rotateY(180deg)',
              background: T.mintTile,
              border: `1px solid ${T.mintEdge}`,
              boxShadow: SHADOW.flashcard,
            }}
          >
            {/* The mint face is theme-aware (unlike the annotation tints), so the
                ink on it must be too — `accentInk`, not the fixed `a1Deep`, which
                measured 2.38:1 here. */}
            <span style={{ ...label, color: T.accentInk }}>Answer</span>
            <span style={{ fontSize: 14.5, fontWeight: 500, lineHeight: 1.5, color: T.ink }}>
              <MathText expr={card.back} />
            </span>
          </span>
        </span>
      </button>

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button type="button" onClick={() => step(-1)} style={{ ...ghostButton, flex: 1, padding: 11, fontSize: 13 }}>
          ‹ Previous
        </button>
        <button type="button" onClick={() => step(1)} style={{ ...accentButton, flex: 1, padding: 11, fontSize: 13 }}>
          Next ›
        </button>
      </div>
    </>
  )
}
