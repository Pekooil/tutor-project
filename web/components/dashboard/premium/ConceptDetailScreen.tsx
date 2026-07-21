import Link from 'next/link'
import type { ConceptDetail, ConceptNotebookView, RelatedConcept } from './detail-read'
import type { DashboardMisconception } from '@/lib/learning/dashboard-read'
import type { NbMisconception } from './notebook-read'
import { formatLastPracticed } from '@/components/dashboard/format'
import { C, glassCard, sheen, eyebrow, entrance, pillAction, STATE_STYLE, pct } from './theme'
import { relativeDueLabel } from './derive'
import { FlashcardsGrid, ProblemsList } from './study-cards'
import { SnapshotBoardList } from './study-snapshots-board'
import { MustKnowList, MethodFlow, LooseMistakes, attachedCategories } from './notebook/ConceptNotes'
import type { MasteryState } from '@/lib/ai/profile'

// The concept workspace lives under the Notebook section of the IA, so its
// back-link returns to the Notebook (the concepts home) — not a standalone list.
function BackLink() {
  return (
    <Link href="/notebook" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: C.greenDeep, textDecoration: 'none', marginBottom: 14 }}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3 L5 8 L10 13" /></svg>
      Notebook
    </Link>
  )
}

function RelatedRow({ r }: { r: RelatedConcept }) {
  const style = r.state ? STATE_STYLE[r.state as MasteryState] : null
  return (
    <Link href={`/concepts/${r.conceptKey}`} className="cx-hover-soft" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 8px', borderRadius: 12, textDecoration: 'none', color: C.ink }}>
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

/** The Personal Notebook (ADR-054, "live notebook"): a per-concept, cumulative
 *  study document — a running summary, the numbered "must know" key points, and
 *  the ordered solving method with the student's mistakes flagged on the steps
 *  they slipped on. Auto-revised after every session that practiced the concept.
 *  Renders the same note components as the full Notebook page, joining the live
 *  mistake count/date from this concept's misconceptions. */
function NotebookCard({
  notebook,
  misconceptions,
}: {
  notebook: ConceptNotebookView
  misconceptions: DashboardMisconception[]
}) {
  const sessionsLabel =
    notebook.sessionCount === 1 ? 'Updated after 1 session' : `Updated across ${notebook.sessionCount} sessions`
  const miscByCategory = new Map<string, NbMisconception>(misconceptions.map((m) => [m.category, m]))
  const attached = attachedCategories(notebook.method)
  const loose: NbMisconception[] = misconceptions.filter((m) => m.status === 'active' && !attached.has(m.category))

  return (
    <div style={{ ...glassCard, padding: '16px 19px', marginBottom: 16, ...entrance(0.08) }}>
      <span style={sheen} />
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <span style={eyebrow}>Personal notebook</span>
          <span style={{ fontSize: 11.5, color: C.faint }}>{sessionsLabel}</span>
        </div>

        {notebook.summary && (
          <p style={{ margin: '0 0 16px', fontSize: 14, lineHeight: '22px', color: C.ink }}>{notebook.summary}</p>
        )}

        {notebook.mustKnow.length > 0 && (
          <div style={{ marginBottom: notebook.method.length > 0 ? 20 : 0 }}>
            <span style={{ ...eyebrow, display: 'block', marginBottom: 12 }}>Must know</span>
            <MustKnowList items={notebook.mustKnow} />
          </div>
        )}

        {notebook.method.length > 0 && (
          <div>
            <span style={{ ...eyebrow, display: 'block', marginBottom: 12 }}>How to solve it</span>
            <MethodFlow steps={notebook.method} miscByCategory={miscByCategory} />
            <LooseMistakes items={loose} />
          </div>
        )}
      </div>
    </div>
  )
}

/** A labelled stat used in the review-schedule strip. */
function ScheduleStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={eyebrow}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 600 }}>{value}</span>
    </div>
  )
}

export function ConceptDetailScreen({ detail }: { detail: ConceptDetail }) {
  const { node, review, kit, notebook, snapshots } = detail
  const style = node ? STATE_STYLE[node.state] : null
  const now = new Date()
  // A "review this concept" action is offered whenever there's something to
  // review it with (a kit) or a schedule entry; it opens the guided flow.
  const canReview = !!kit && !kit.empty
  const reviewHref = `/review/${detail.conceptKey}`

  return (
    <section data-screen-label="Concept">
      <header style={{ marginBottom: 22, animation: 'cxPop .5s cubic-bezier(.3,1.4,.4,1) both' }}>
        <BackLink />
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20 }}>
          <div>
            <p style={{ margin: '0 0 7px', fontSize: 10, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: detail.strandColor }}>{detail.strandLabel}</p>
            <h1 style={{ margin: 0, fontSize: 28, lineHeight: '34px', fontWeight: 600, letterSpacing: '-.015em' }}>{detail.title}</h1>
          </div>
          {canReview && (
            <Link href={reviewHref} style={{ flex: 'none', border: 'none', borderRadius: 99, background: C.mint, color: C.greenDeep, fontSize: 14, fontWeight: 600, padding: '11px 22px', cursor: 'pointer', boxShadow: '0 2px 8px rgba(28,40,30,.14)', textDecoration: 'none' }}>
              Review this concept &rarr;
            </Link>
          )}
        </div>
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
      </div>

      {/* Personal notebook — the concept's cumulative, auto-generated study
          document (ADR-054). Right after the summary, per the product brief's
          §2 order. Absent until the first session revises it. */}
      {notebook && <NotebookCard notebook={notebook} misconceptions={detail.misconceptions} />}

      {/* Review schedule — the "when does this come back" panel (replaces the
          calendar's role at the concept level). Shown when the scheduler has an
          entry or the concept has been practiced. */}
      {(review || node) && (
        <div style={{ ...glassCard, padding: '16px 19px', marginBottom: 16, ...entrance(0.1) }}>
          <span style={sheen} />
          <span style={{ ...eyebrow, position: 'relative', display: 'block', marginBottom: 12 }}>Review schedule</span>
          <div style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', gap: '14px 40px', alignItems: 'flex-end' }}>
            <ScheduleStat
              label="Next review"
              value={review ? relativeDueLabel(review.dueAt, now) : 'Not scheduled'}
            />
            {review && <ScheduleStat label="Interval" value={`${review.intervalDays} day${review.intervalDays === 1 ? '' : 's'}`} />}
            {review && review.lapses > 0 && <ScheduleStat label="Lapses" value={String(review.lapses)} />}
            {node && <ScheduleStat label="Times practiced" value={String(node.observationCount)} />}
            {canReview && (
              <Link href={reviewHref} className="cx-hover-pill" style={{ ...pillAction, marginLeft: 'auto' }}>Start review &rarr;</Link>
            )}
          </div>
        </div>
      )}

      {/* Things you keep forgetting — recurring misconceptions on this concept */}
      {detail.misconceptions.length > 0 && (
        <div style={{ ...glassCard, padding: '16px 19px', marginBottom: 16, ...entrance(0.14) }}>
          <span style={sheen} />
          <span style={{ ...eyebrow, position: 'relative', display: 'block', marginBottom: 10 }}>Things you keep forgetting</span>
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

      {/* Flashcards — inline from this concept's study kit */}
      {kit && kit.flashcards.length > 0 && (
        <div style={{ ...glassCard, padding: '16px 19px', marginBottom: 16, ...entrance(0.18) }}>
          <span style={sheen} />
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={eyebrow}>Flashcards · tap to flip</span>
            <span style={{ fontSize: 12, color: C.muted }}>{kit.flashcards.length}</span>
          </div>
          <div style={{ position: 'relative' }}>
            <FlashcardsGrid cards={kit.flashcards} />
          </div>
        </div>
      )}

      {/* Practice — inline problems with reveal-solution */}
      {kit && kit.problems.length > 0 && (
        <div style={{ ...glassCard, padding: '16px 19px', marginBottom: 16, ...entrance(0.22) }}>
          <span style={sheen} />
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={eyebrow}>Practice · work then check</span>
            <span style={{ fontSize: 12, color: C.muted }}>{kit.problems.length}</span>
          </div>
          <div style={{ position: 'relative' }}>
            <ProblemsList problems={kit.problems} />
          </div>
        </div>
      )}

      {/* Worked-problem snapshots — the tutor's annotated turns on this concept,
          replayed (ADR-055). The brief's §2 "Session Screenshots", text-based. */}
      {snapshots.length > 0 && (
        <div style={{ ...glassCard, padding: '16px 19px', marginBottom: 16, ...entrance(0.24) }}>
          <span style={sheen} />
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={eyebrow}>Worked-problem snapshots</span>
            <span style={{ fontSize: 12, color: C.muted }}>{snapshots.length}</span>
          </div>
          <div style={{ position: 'relative' }}>
            <SnapshotBoardList snapshots={snapshots} />
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        {/* Prerequisites */}
        <div style={{ ...glassCard, padding: '16px 19px', ...entrance(0.26) }}>
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
        <div style={{ ...glassCard, padding: '16px 19px', ...entrance(0.3) }}>
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
