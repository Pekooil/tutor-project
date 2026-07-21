import Link from 'next/link'
import type { ReactNode } from 'react'
import type { NbConcept } from '../notebook-read'
import { C, glassCard, sheen, eyebrow, pct, STATE_STYLE } from '../theme'
import { relativeDueLabel } from '../derive'
import { ReviewTimeline } from './ReviewTimeline'
import { MustKnowList, MethodFlow, LooseMistakes, attachedCategories } from './ConceptNotes'

// One concept, rendered as a section of the continuous notebook document
// ("live notebook" redesign). The page is now real study notes in a fixed order
// the product brief defines:
//   1. header — mastery + where you stand (the running summary)
//   2. Must know — the numbered key points (facts/results)
//   3. How to solve it — the ordered method, with step-level mistake annotations
//      grounded in what the student actually got wrong (+ the live count/date)
//   4. Study kit — practice + flashcards bundled behind ONE button
//   5. Review timeline
// A concept with nothing yet renders a light "not studied" placeholder.

/** A titled sub-block inside a concept page (the notebook's "callout"). */
function Block({
  label,
  count,
  hint,
  children,
}: {
  label: string
  count?: number
  hint?: string
  children: ReactNode
}) {
  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <span style={eyebrow}>{label}</span>
        {hint ? (
          <span style={{ fontSize: 11.5, color: C.faint }}>{hint}</span>
        ) : (
          count != null && <span style={{ fontSize: 12, color: C.muted }}>{count}</span>
        )}
      </div>
      {children}
    </div>
  )
}

export function ConceptPage({ concept, now }: { concept: NbConcept; now: Date }) {
  const { node, notebook, misconceptions, kit, review, timeline } = concept
  const style = node ? STATE_STYLE[node.state] : null
  const anchorId = `concept-${concept.conceptKey}`

  // A concept nobody has touched yet — a placeholder page so the notebook still
  // lists it, honest about there being nothing here yet.
  if (!concept.hasContent) {
    return (
      <section id={anchorId} data-concept={concept.conceptKey} className="nb-anchor" style={{ marginBottom: 16 }}>
        <div style={{ ...glassCard, padding: '15px 19px', opacity: 0.82 }}>
          <span style={sheen} />
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 99, background: 'rgba(28,28,26,.16)' }} />
            <span style={{ fontSize: 15, fontWeight: 600, flex: 1, minWidth: 0 }}>{concept.title}</span>
            <span style={{ flex: 'none', fontSize: 11.5, color: C.faint }}>Not studied yet</span>
          </div>
          <p style={{ position: 'relative', margin: '9px 0 0', fontSize: 12.5, color: C.muted, paddingLeft: 20 }}>
            Meet this in a tutoring session and its notes, method, and mistakes will build here.
          </p>
        </div>
      </section>
    )
  }

  // Live mistake join: map each tracked misconception by category so the method's
  // step annotations can show how often / when the slip last happened. Active
  // misconceptions the AI didn't pin to a step are surfaced separately below.
  const miscByCategory = new Map(misconceptions.map((m) => [m.category, m]))
  const method = notebook?.method ?? []
  const attached = attachedCategories(method)
  const looseActive = misconceptions.filter((m) => m.status === 'active' && !attached.has(m.category))

  return (
    <section id={anchorId} data-concept={concept.conceptKey} className="nb-anchor" style={{ marginBottom: 26 }}>
      <div style={{ ...glassCard, padding: '22px 24px 24px' }}>
        <span style={sheen} />
        <div style={{ position: 'relative' }}>
          {/* ── 1 · Header: title · mastery · where you stand ─────────────── */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: '0 0 5px', fontSize: 10, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', color: C.faint }}>
                {concept.chapterLabel}
              </p>
              <h2 style={{ margin: 0, fontSize: 23, lineHeight: '28px', fontWeight: 600, letterSpacing: '-.015em' }}>
                {concept.title}
              </h2>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
              {node && style && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.09em', textTransform: 'uppercase', borderRadius: 99, padding: '3px 10px', background: style.chipBg, color: style.ink }}>
                    {style.label}
                  </span>
                  <span style={{ fontSize: 19, fontWeight: 600 }}>{pct(node.mastery)}%</span>
                </span>
              )}
            </div>
          </div>

          {/* Mastery bar + meta */}
          {node && style && (
            <div style={{ marginTop: 12 }}>
              <span style={{ display: 'block', height: 7, borderRadius: 99, background: 'rgba(28,28,26,.06)', overflow: 'hidden' }}>
                <span style={{ display: 'block', height: 7, borderRadius: 99, background: style.bar, width: `${pct(node.mastery)}%` }} />
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', marginTop: 9, fontSize: 12, color: C.muted }}>
                <span>
                  {node.observationCount} practice{node.observationCount === 1 ? '' : 's'}
                </span>
                <span>{node.confidenceBand} confidence</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke={C.muted} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="8" cy="8" r="6" />
                    <path d="M8 4.8 V8 L10.2 9.4" />
                  </svg>
                  Next review · {review ? relativeDueLabel(review.dueAt, now) : 'not scheduled'}
                </span>
                {concept.reviewHref && (
                  <Link href={concept.reviewHref} className="cx-hover-pill" style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: C.greenDeep, background: C.mintPill, borderRadius: 99, padding: '4px 12px' }}>
                    Review this concept &rarr;
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* Where you stand — the running summary */}
          {notebook?.summary && (
            <p style={{ margin: '16px 0 0', fontSize: 14.5, lineHeight: '23px', color: C.ink }}>{notebook.summary}</p>
          )}

          {/* ── 2 · Must know ─────────────────────────────────────────────── */}
          {notebook && notebook.mustKnow.length > 0 && (
            <Block label="Must know">
              <MustKnowList items={notebook.mustKnow} />
            </Block>
          )}

          {/* ── 3 · How to solve it — the method, with mistake annotations ── */}
          {method.length > 0 && (
            <Block label="How to solve it" hint="steps · your mistakes flagged">
              <MethodFlow steps={method} miscByCategory={miscByCategory} />
              <LooseMistakes items={looseActive} />
            </Block>
          )}

          {/* When there's no method yet but the student has active slips, still
              show them so "what went wrong" is never lost. */}
          {method.length === 0 && looseActive.length > 0 && (
            <Block label="Your common mistakes" count={looseActive.length}>
              <LooseMistakes items={looseActive} />
            </Block>
          )}

          {/* ── 4 · Study kit — practice + flashcards behind one button ───── */}
          {kit && (kit.problems.length > 0 || kit.flashcards.length > 0 || kit.notes.length > 0) && (
            <Block label="Study kit" hint="practice + flashcards">
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '15px 17px', borderRadius: 14, background: C.mintTile, flexWrap: 'wrap' }}>
                <span style={{ flex: 'none', width: 38, height: 38, borderRadius: 11, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="19" height="19" viewBox="0 0 16 16" fill="none" stroke={C.greenInk} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
                    <path d="M5.5 6 H10.5 M5.5 8.4 H10.5 M5.5 10.8 H8.5" />
                  </svg>
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Practice this concept</p>
                  <p style={{ margin: '2px 0 0', fontSize: 12.5, color: C.muted }}>
                    {[
                      kit.problems.length > 0 ? `${kit.problems.length} practice problem${kit.problems.length === 1 ? '' : 's'}` : null,
                      kit.flashcards.length > 0 ? `${kit.flashcards.length} flashcard${kit.flashcards.length === 1 ? '' : 's'}` : null,
                      kit.notes.length > 0 ? `${kit.notes.length} note${kit.notes.length === 1 ? '' : 's'}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <Link
                  href={concept.studyKitHref ?? concept.reviewHref ?? '/library'}
                  className="cx-hover-pill"
                  style={{ flex: 'none', border: 'none', borderRadius: 99, background: C.mint, color: C.greenDeep, fontSize: 13, fontWeight: 600, padding: '10px 18px', textDecoration: 'none' }}
                >
                  Open study kit &rarr;
                </Link>
              </div>
            </Block>
          )}

          {/* ── 5 · Review timeline ───────────────────────────────────────── */}
          {timeline.length > 0 && (
            <Block label="Review timeline">
              <ReviewTimeline events={timeline} />
            </Block>
          )}
        </div>
      </div>
    </section>
  )
}
