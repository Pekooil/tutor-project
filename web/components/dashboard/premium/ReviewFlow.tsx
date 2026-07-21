'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { KitProblem, KitFlashcard } from './kit-read'
import { C, glassCard, sheen, eyebrow, entrance, pillAction } from './theme'
import { FlashcardsGrid } from './study-cards'

// The guided concept review (the product vision's "Start Review"). A three-stage
// flow over the concept's existing study material: warm up on the notes +
// flashcards, answer up to three self-graded questions (its practice problems,
// or flashcards when there are no problems), then a summary that records the
// completion — which recalculates when the concept next comes back for review.
//
// Scope: questions are drawn from the concept's already-generated kit rather
// than freshly generated per review, and the self-grade recalculates the review
// schedule (not FSRS mastery). Both are honest next steps, not hidden.

type Question = { prompt: string; answer: string }

function buildQuestions(problems: KitProblem[], flashcards: KitFlashcard[]): Question[] {
  if (problems.length > 0) return problems.slice(0, 3).map((p) => ({ prompt: p.statement, answer: p.solution }))
  return flashcards.slice(0, 3).map((f) => ({ prompt: f.front, answer: f.back }))
}

export function ReviewFlow({
  conceptKey,
  title,
  strandLabel,
  strandColor,
  notes,
  flashcards,
  problems,
}: {
  conceptKey: string
  title: string
  strandLabel: string
  strandColor: string
  notes: string[]
  flashcards: KitFlashcard[]
  problems: KitProblem[]
}) {
  const questions = buildQuestions(problems, flashcards)
  const [stage, setStage] = useState<'warmup' | 'quiz' | 'done'>('warmup')
  const [qIndex, setQIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [correct, setCorrect] = useState(0)

  const total = questions.length

  const grade = (got: boolean) => {
    if (got) setCorrect((c) => c + 1)
    if (qIndex + 1 < total) {
      setQIndex((i) => i + 1)
      setRevealed(false)
    } else {
      setStage('done')
    }
  }

  return (
    <section data-screen-label="Review">
      <header style={{ marginBottom: 22, animation: 'cxPop .5s cubic-bezier(.3,1.4,.4,1) both' }}>
        <Link href={`/concepts/${conceptKey}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: C.greenDeep, textDecoration: 'none', marginBottom: 14 }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3 L5 8 L10 13" /></svg>
          Back to concept
        </Link>
        <p style={{ margin: '0 0 7px', fontSize: 10, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: strandColor }}>{strandLabel} · Review</p>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: '34px', fontWeight: 600, letterSpacing: '-.015em' }}>{title}</h1>
      </header>

      {stage === 'warmup' && (
        <>
          {notes.length > 0 && (
            <div style={{ ...glassCard, padding: '16px 19px', marginBottom: 16, ...entrance(0.06) }}>
              <span style={sheen} />
              <span style={{ ...eyebrow, position: 'relative', display: 'block', marginBottom: 10 }}>Refresh — key takeaways</span>
              <ol style={{ position: 'relative', margin: 0, paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {notes.map((n, i) => (
                  <li key={i} style={{ fontSize: 13.5, lineHeight: '21px' }}>{n}</li>
                ))}
              </ol>
            </div>
          )}
          {flashcards.length > 0 && (
            <div style={{ ...glassCard, padding: '16px 19px', marginBottom: 16, ...entrance(0.12) }}>
              <span style={sheen} />
              <span style={{ ...eyebrow, position: 'relative', display: 'block', marginBottom: 12 }}>Flashcards · tap to flip</span>
              <div style={{ position: 'relative' }}>
                <FlashcardsGrid cards={flashcards} />
              </div>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', ...entrance(0.18) }}>
            <button
              onClick={() => (total > 0 ? setStage('quiz') : setStage('done'))}
              style={{ border: 'none', borderRadius: 99, background: C.mint, color: C.greenDeep, fontSize: 15, fontWeight: 600, padding: '13px 26px', cursor: 'pointer', boxShadow: '0 2px 8px rgba(28,40,30,.14)' }}
            >
              {total > 0 ? `Start questions · ${total} →` : 'Mark as reviewed →'}
            </button>
          </div>
        </>
      )}

      {stage === 'quiz' && total > 0 && (
        <div style={{ ...glassCard, padding: '22px 24px', ...entrance(0.06) }}>
          <span style={sheen} />
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span style={eyebrow}>Question {qIndex + 1} of {total}</span>
            <span style={{ display: 'flex', gap: 5 }}>
              {questions.map((_, i) => (
                <span key={i} style={{ width: 22, height: 5, borderRadius: 99, background: i < qIndex ? C.greenInk : i === qIndex ? C.mint : 'rgba(28,28,26,.1)' }} />
              ))}
            </span>
          </div>
          <p style={{ position: 'relative', margin: '0 0 16px', fontSize: 16, lineHeight: '24px', fontWeight: 500 }}>{questions[qIndex].prompt}</p>

          {!revealed ? (
            <button onClick={() => setRevealed(true)} className="cx-hover-pill" style={{ ...pillAction, position: 'relative', padding: '9px 18px', fontSize: 13 }}>
              Reveal answer
            </button>
          ) : (
            <div style={{ position: 'relative' }}>
              <div style={{ padding: '13px 15px', borderRadius: 13, background: 'rgba(134,239,172,.14)', border: '1px solid rgba(134,239,172,.4)', fontSize: 13.5, lineHeight: '20px', whiteSpace: 'pre-wrap', marginBottom: 16 }}>
                {questions[qIndex].answer}
              </div>
              <p style={{ margin: '0 0 10px', fontSize: 12.5, color: C.muted }}>How did you do?</p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => grade(true)} style={{ flex: 1, border: 'none', borderRadius: 12, background: C.mint, color: C.greenDeep, fontSize: 13.5, fontWeight: 600, padding: '11px 0', cursor: 'pointer' }}>
                  I got it
                </button>
                <button onClick={() => grade(false)} style={{ flex: 1, border: '1px solid rgba(146,64,14,.25)', borderRadius: 12, background: 'rgba(146,64,14,.06)', color: C.amber, fontSize: 13.5, fontWeight: 600, padding: '11px 0', cursor: 'pointer' }}>
                  I missed it
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {stage === 'done' && (
        <ReviewSummary conceptKey={conceptKey} correct={correct} total={total} />
      )}
    </section>
  )
}

function ReviewSummary({ conceptKey, correct, total }: { conceptKey: string; correct: number; total: number }) {
  const [status, setStatus] = useState<'saving' | 'saved' | 'error'>('saving')
  const [masteryUpdated, setMasteryUpdated] = useState(false)

  // Record the completion once → applies the outcome to mastery (when graded)
  // and recalculates the concept's next review date.
  useEffect(() => {
    let cancelled = false
    fetch('/api/review/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conceptKey, correct, total }),
    })
      .then(async (r) => {
        if (cancelled) return
        if (!r.ok) {
          setStatus('error')
          return
        }
        const data = (await r.json().catch(() => ({}))) as { masteryUpdated?: boolean }
        setMasteryUpdated(data.masteryUpdated === true)
        setStatus('saved')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [conceptKey, correct, total])

  return (
    <div style={{ ...glassCard, padding: '30px 28px', textAlign: 'center', ...entrance(0.06) }}>
      <span style={sheen} />
      <div style={{ position: 'relative' }}>
        <span style={{ display: 'inline-flex', width: 56, height: 56, borderRadius: 99, background: C.mintTile, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
          <svg width="26" height="26" viewBox="0 0 16 16" fill="none" stroke="#166534" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.4 L6.4 11.6 L13 4.6" /></svg>
        </span>
        <h2 style={{ margin: 0, fontSize: 23, fontWeight: 600, letterSpacing: '-.01em' }}>Review complete</h2>
        <p style={{ margin: '8px 0 0', fontSize: 14.5, color: C.muted }}>
          {total > 0 ? `You got ${correct} of ${total} on your own.` : 'Nice — you refreshed this concept.'}
        </p>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: C.muted }}>
          {status === 'saving' && 'Updating your learning model…'}
          {status === 'saved' && (masteryUpdated ? 'Mastery and next review date updated.' : 'Next review date updated.')}
          {status === 'error' && "Couldn't reach the server — your progress will sync next time."}
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20 }}>
          <Link href="/dashboard" style={{ border: 'none', borderRadius: 99, background: C.mint, color: C.greenDeep, fontSize: 14, fontWeight: 600, padding: '11px 22px', textDecoration: 'none' }}>
            Back to dashboard
          </Link>
          <Link href={`/concepts/${conceptKey}`} className="cx-hover-pill" style={{ ...pillAction, padding: '11px 20px', fontSize: 14 }}>
            Concept workspace
          </Link>
        </div>
      </div>
    </div>
  )
}
