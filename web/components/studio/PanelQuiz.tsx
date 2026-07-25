'use client'

import { useEffect, useRef, useState } from 'react'
import type { KitProblem } from '@/components/dashboard/premium/kit-read'
import { T, ORDINAL, MATH_FONT, MOTION, accentButton, ghostButton } from './tokens'
import { ChevronLeft, ChevronRight, LightbulbIcon, TrophyIcon } from './icons'

// The quiz runner, adapted to live INSIDE the Ask Calyxa panel rather than on its
// own full-screen route. Same behaviour as the route version it replaces, at
// panel width (~410px of content): the metrics are smaller, the answer controls
// stack instead of sitting side by side, and there is a back affordance to the
// panel's home state.
//
// SHELL SCOPE (unchanged): the study kit stores free-response problems with a
// worked solution and no distractors, so this is reveal-then-self-grade rather
// than multiple choice. Real MCQ needs the generator to emit options.

type Verdict = 'right' | 'wrong'

function Serif({ text }: { text: string }) {
  return <span style={{ fontFamily: MATH_FONT }}>{text}</span>
}

export function PanelQuiz({
  conceptKey,
  title,
  problems,
  onBack,
}: {
  conceptKey: string
  title: string
  problems: KitProblem[]
  onBack: () => void
}) {
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [hintOpen, setHintOpen] = useState(false)
  const [verdicts, setVerdicts] = useState<Record<number, Verdict>>({})
  const [done, setDone] = useState(false)

  const total = problems.length
  const problem = problems[index]
  const score = Object.values(verdicts).filter((v) => v === 'right').length
  // Only self-graded questions count as a graded attempt; marking none sends
  // total: 0, which /api/review/complete treats as a notes-only refresh.
  const graded = Object.keys(verdicts).length

  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const recorded = useRef(false)

  // Finishing a quiz IS completing a review — the same FSRS write the retired
  // /review flow made, so mastery and the next review date still move. Preserved
  // verbatim from the full-screen version; losing it would silently break spaced
  // repetition.
  useEffect(() => {
    if (!done || recorded.current) return
    recorded.current = true
    setSaveState('saving')

    let cancelled = false
    fetch('/api/review/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conceptKey, correct: score, total: graded }),
    })
      .then((r) => {
        if (!cancelled) setSaveState(r.ok ? 'saved' : 'error')
      })
      .catch(() => {
        if (!cancelled) setSaveState('error')
      })

    return () => {
      cancelled = true
    }
  }, [done, conceptKey, score, graded])

  function reset() {
    setIndex(0)
    setRevealed(false)
    setHintOpen(false)
    setVerdicts({})
    setDone(false)
    recorded.current = false
    setSaveState('idle')
  }

  function go(next: number) {
    setIndex(next)
    setRevealed(false)
    setHintOpen(false)
  }

  const back = (
    <button
      type="button"
      onClick={onBack}
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
      <ChevronLeft size={14} /> Back
    </button>
  )

  if (total === 0) {
    return (
      <>
        {back}
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: '14px 0 6px' }}>No quiz yet</h3>
        <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.55, margin: 0 }}>
          Calyxa builds practice problems from a finished session on {title}. Work it in the extension and
          they show up here.
        </p>
      </>
    )
  }

  if (done) {
    const perfect = score === total
    return (
      <>
        {back}
        <div style={{ textAlign: 'center', marginTop: 28 }}>
          <p style={{ fontSize: 44, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
            {score} / {total}
          </p>
          <p style={{ fontSize: 13.5, color: T.muted, lineHeight: 1.55, margin: '10px 0 4px' }}>
            {graded === 0
              ? 'You didn’t mark any, so nothing was scored — the concept just moves down the review queue.'
              : perfect
                ? 'Every one. This concept is holding.'
                : 'The ones you missed are what Calyxa will start the next session on.'}
          </p>
          <p style={{ fontSize: 12, color: saveState === 'error' ? T.danger : T.muted, margin: '0 0 20px' }}>
            {saveState === 'saving'
              ? 'Recording your review…'
              : saveState === 'saved'
                ? graded > 0
                  ? 'Mastery and your next review date are updated.'
                  : 'Your next review date is updated.'
                : saveState === 'error'
                  ? 'Couldn’t record this review — your mastery hasn’t changed.'
                  : ''}
          </p>
          <button type="button" onClick={reset} style={{ ...accentButton, width: '100%', padding: 12, fontSize: 14 }}>
            Restart quiz
          </button>
        </div>
      </>
    )
  }

  const progress = ((index + (revealed ? 1 : 0)) / total) * 100

  return (
    <>
      {back}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
        <TrophyIcon size={16} style={{ color: T.muted, flexShrink: 0 }} />
        <div style={{ flex: 1, height: 8, borderRadius: 4, background: T.surface, overflow: 'hidden' }}>
          <div
            style={{
              width: `${progress}%`,
              height: '100%',
              background: T.a1,
              transition: `width ${MOTION.base} ${MOTION.ease}`,
            }}
          />
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: T.muted, flexShrink: 0 }}>
          {index + 1} / {total}
        </span>
      </div>

      <p style={{ fontSize: 17, lineHeight: 1.5, fontWeight: 500, margin: '18px 0 0' }}>
        <Serif text={problem.statement} />
      </p>

      {!revealed ? (
        <>
          <p style={{ margin: '12px 0 0', fontSize: 12.5, color: T.muted, lineHeight: 1.55 }}>
            Work it out, then reveal the solution and mark whether you had it.
          </p>
          {hintOpen && (
            <div
              style={{
                marginTop: 12,
                background: T.accentSubtle,
                border: `1px solid ${T.a1Edge}`,
                borderRadius: 10,
                padding: '11px 13px',
                fontSize: 12.5,
                lineHeight: 1.55,
                // `accentSubtle` is dark-aware, so this block composites dark in
                // dark mode — theme-aware ink, not the fixed `a1Deep`.
                color: T.ink1,
              }}
            >
              <strong style={{ fontWeight: 700 }}>Hint: </strong>
              <Serif text={problem.solution.split(/[.;]/)[0]} />…
            </div>
          )}
          <button
            type="button"
            onClick={() => setRevealed(true)}
            style={{ ...accentButton, width: '100%', padding: 12, fontSize: 14, marginTop: 12 }}
          >
            Reveal the solution
          </button>
          <button
            type="button"
            onClick={() => setHintOpen((v) => !v)}
            style={{ ...ghostButton, width: '100%', padding: 11, fontSize: 13, marginTop: 8 }}
          >
            <LightbulbIcon size={14} />
            {hintOpen ? 'Hide hint' : 'Show hint'}
          </button>
        </>
      ) : (
        <>
          <div
            style={{
              marginTop: 14,
              background: T.surface,
              border: `1px solid ${T.border}`,
              borderRadius: 10,
              padding: '11px 13px',
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            <strong style={{ color: T.accentInk, fontWeight: 700 }}>Why: </strong>
            <Serif text={problem.solution} />
          </div>

          {/* Stacked, not side by side: at panel width two pills would wrap badly. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {(
              [
                { v: 'right' as Verdict, label: 'I had it', set: ORDINAL.green, glyph: '✓' },
                { v: 'wrong' as Verdict, label: 'I missed it', set: ORDINAL.danger, glyph: '✕' },
              ]
            ).map(({ v, label, set, glyph }) => {
              const on = verdicts[index] === v
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVerdicts((prev) => ({ ...prev, [index]: v }))}
                  aria-pressed={on}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    padding: '11px 14px',
                    borderRadius: 11,
                    fontSize: 13.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: on ? set.background : 'transparent',
                    border: on ? `1.5px solid ${set.color}` : `1.5px solid ${T.border}`,
                    color: on ? set.color : T.ink,
                    opacity: verdicts[index] && !on ? 0.55 : 1,
                  }}
                >
                  <span aria-hidden="true" style={{ fontWeight: 700 }}>
                    {glyph}
                  </span>
                  {label}
                </button>
              )
            })}
          </div>
        </>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 14 }}>
        <button
          type="button"
          onClick={() => go(Math.max(0, index - 1))}
          disabled={index === 0}
          style={{ ...ghostButton, padding: '9px 14px', fontSize: 13, opacity: index === 0 ? 0.45 : 1 }}
        >
          <ChevronLeft size={12} /> Previous
        </button>
        <button
          type="button"
          onClick={() => (index + 1 >= total ? setDone(true) : go(index + 1))}
          disabled={!revealed}
          style={{ ...ghostButton, padding: '9px 14px', fontSize: 13, opacity: revealed ? 1 : 0.45 }}
        >
          {index + 1 >= total ? 'Results' : 'Next'} <ChevronRight size={12} />
        </button>
      </div>
    </>
  )
}
