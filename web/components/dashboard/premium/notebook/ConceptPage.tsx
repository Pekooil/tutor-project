import Link from 'next/link'
import type { ReactNode } from 'react'
import type { NbConcept } from '../notebook-read'
import { C, glassCard, sheen, eyebrow, pct, STATE_STYLE } from '../theme'
import { relativeDueLabel } from '../derive'
import { FlashcardsGrid, ProblemsList } from '../study-cards'
import { SnapshotBoardList } from '../study-snapshots-board'
import { ReviewTimeline } from './ReviewTimeline'

// One concept, rendered as a section of the continuous notebook document
// (redesign). Every tutoring session edits this page; here we render whatever it
// has accumulated, in the brief's order: mastery header → core explanation → key
// takeaways → common mistakes → homework snapshots → practice → flashcards →
// study guide → review timeline. A concept with nothing yet renders a light
// "not studied" placeholder so it still appears in the continuous notebook.

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
    <div style={{ marginTop: 22 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 11 }}>
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
  const { node, notebook, misconceptions, kit, snapshots, review, timeline } = concept
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
            Meet this in a tutoring session and its notes, mistakes, and practice will build here.
          </p>
        </div>
      </section>
    )
  }

  return (
    <section id={anchorId} data-concept={concept.conceptKey} className="nb-anchor" style={{ marginBottom: 26 }}>
      <div style={{ ...glassCard, padding: '22px 24px 24px' }}>
        <span style={sheen} />
        <div style={{ position: 'relative' }}>
          {/* ── Header: title · mastery · next review ─────────────────────── */}
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

          {/* ── Core explanation ──────────────────────────────────────────── */}
          {notebook && (notebook.summary || notebook.explanations.length > 0) && (
            <Block label="Core explanation" hint="rewritten as you learn">
              {notebook.summary && (
                <p style={{ margin: '0 0 13px', fontSize: 14.5, lineHeight: '23px', color: C.ink }}>{notebook.summary}</p>
              )}
              {notebook.explanations.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  {notebook.explanations.map((e, i) => (
                    <div key={i} style={{ padding: '13px 15px', borderRadius: 13, background: C.mintTile }}>
                      <p style={{ margin: '0 0 5px', fontSize: 13.5, fontWeight: 600, color: C.greenDeep }}>{e.title}</p>
                      <p style={{ margin: 0, fontSize: 13.5, lineHeight: '21px', color: C.ink }}>{e.body}</p>
                    </div>
                  ))}
                </div>
              )}
            </Block>
          )}

          {/* ── Key takeaways ─────────────────────────────────────────────── */}
          {notebook && notebook.reminders.length > 0 && (
            <Block label="Key takeaways">
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 9 }}>
                {notebook.reminders.map((r, i) => (
                  <li key={i} style={{ display: 'flex', gap: 10, fontSize: 13.5, lineHeight: '21px' }}>
                    <span style={{ flex: 'none', width: 6, height: 6, marginTop: 7, borderRadius: 99, background: C.amber }} />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </Block>
          )}

          {/* ── Your common mistakes ──────────────────────────────────────── */}
          {misconceptions.length > 0 && (
            <Block label="Your common mistakes" count={misconceptions.length}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {misconceptions.map((m) => {
                  const resolved = m.status === 'resolved'
                  return (
                    <Link
                      key={m.id}
                      href={`/misconceptions/${m.id}`}
                      className="cx-hover-soft"
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 11,
                        padding: '11px 13px',
                        borderRadius: 12,
                        textDecoration: 'none',
                        color: C.ink,
                        background: resolved ? 'rgba(134,239,172,.12)' : 'rgba(146,64,14,.05)',
                      }}
                    >
                      <span style={{ flex: 'none', marginTop: 1 }}>
                        {resolved ? (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#166534" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="8" cy="8" r="6.5" fill="rgba(134,239,172,.4)" stroke="none" />
                            <path d="M5 8.2 L7.2 10.2 L11 5.8" />
                          </svg>
                        ) : (
                          <span style={{ display: 'block', width: 8, height: 8, marginTop: 4, borderRadius: 99, background: C.amber }} />
                        )}
                      </span>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 500, textDecoration: resolved ? 'line-through' : 'none', textDecorationColor: 'rgba(22,101,52,.4)' }}>
                          {m.title}
                        </span>
                        {m.description && (
                          <span style={{ fontSize: 12, color: C.muted, lineHeight: '17px' }}>{m.description}</span>
                        )}
                      </span>
                      <span style={{ flex: 'none', fontSize: 11, color: resolved ? '#166534' : C.muted, fontWeight: 600 }}>
                        {resolved ? 'Resolved' : `Seen ${m.occurrenceCount}×`}
                      </span>
                    </Link>
                  )
                })}
              </div>
            </Block>
          )}

          {/* ── Homework snapshots ────────────────────────────────────────── */}
          {snapshots.length > 0 && (
            <Block label="Homework snapshots" count={snapshots.length}>
              <SnapshotBoardList snapshots={snapshots} />
            </Block>
          )}

          {/* ── Practice ──────────────────────────────────────────────────── */}
          {kit && kit.problems.length > 0 && (
            <Block label="Practice" hint="work then check">
              <ProblemsList problems={kit.problems} />
            </Block>
          )}

          {/* ── Flashcards ────────────────────────────────────────────────── */}
          {kit && kit.flashcards.length > 0 && (
            <Block label="Flashcards" hint="tap to flip">
              <FlashcardsGrid cards={kit.flashcards} />
            </Block>
          )}

          {/* ── Study guide ───────────────────────────────────────────────── */}
          {kit && kit.notes.length > 0 && (
            <Block label="Study guide">
              <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {kit.notes.map((n, i) => (
                  <li key={i} style={{ fontSize: 13.5, lineHeight: '21px', color: C.ink }}>
                    {n}
                  </li>
                ))}
              </ol>
            </Block>
          )}

          {/* ── Review timeline ───────────────────────────────────────────── */}
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
