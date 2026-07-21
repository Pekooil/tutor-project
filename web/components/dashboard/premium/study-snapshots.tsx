import type { CSSProperties } from 'react'
import type { SnapshotAnnotation, WorkedSnapshot } from './snapshots-read'
import { C } from './theme'

// ADR-055: the worked-problem snapshot card — a text replay of a tutored turn.
// Display-only (no hooks), so it renders inside the server-rendered concept and
// session screens. A snapshot shows the tutor's annotated problem spans (the
// "drawing"), the AI explanation, and any misconception — the brief's "AI
// explanation, misconception, corrected reasoning", reconstructed from data,
// never a pixel capture.

// The four annotation colours the model may emit (ENVELOPE_TOOL's style.color
// enum) mapped to an accessible ink/tint/dot triple; anything else (or null)
// falls back to neutral so an unexpected value never renders invisibly.
const MARK_COLORS: Record<string, { ink: string; bg: string; dot: string }> = {
  amber: { ink: '#92400e', bg: 'rgba(245,158,11,.13)', dot: '#f59e0b' },
  blue: { ink: '#1e40af', bg: 'rgba(59,130,246,.13)', dot: '#3b82f6' },
  green: { ink: '#166534', bg: 'rgba(34,197,94,.13)', dot: '#22c55e' },
  red: { ink: '#991b1b', bg: 'rgba(239,68,68,.13)', dot: '#ef4444' },
}
const NEUTRAL_MARK = { ink: C.ink, bg: 'rgba(28,28,26,.05)', dot: '#9a988f' }

function markColor(color: string | null): { ink: string; bg: string; dot: string } {
  return (color && MARK_COLORS[color]) || NEUTRAL_MARK
}

function AnnotationMark({ a }: { a: SnapshotAnnotation }) {
  const c = markColor(a.color)
  return (
    <div style={{ display: 'flex', gap: 9, padding: '8px 10px', borderRadius: 11, background: c.bg }}>
      <span style={{ flex: 'none', width: 6, height: 6, marginTop: 6, borderRadius: 99, background: c.dot }} />
      <div style={{ minWidth: 0 }}>
        {a.label && <span style={{ fontSize: 12.5, fontWeight: 600, color: c.ink }}>{a.label}</span>}
        {a.targetText && (
          <span style={{ fontSize: 12.5, fontWeight: 600, color: c.ink }}>
            {a.label ? ' · ' : ''}
            <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 500 }}>{a.targetText}</span>
          </span>
        )}
        {a.note && <p style={{ margin: '3px 0 0', fontSize: 12, lineHeight: '17px', color: C.muted }}>{a.note}</p>}
      </div>
    </div>
  )
}

const cardStyle: CSSProperties = {
  border: '1px solid rgba(28,28,26,.08)',
  borderRadius: 15,
  padding: '13px 15px',
  background: 'rgba(255,255,255,.5)',
}

/** One tutored turn, replayed. `showConcept` labels the turn with its concept
 *  (used on the session timeline, where turns span concepts). */
export function SnapshotCard({ snapshot, showConcept = false }: { snapshot: WorkedSnapshot; showConcept?: boolean }) {
  const { annotations, tutorResponse, misconception, studentTranscript, conceptTitle } = snapshot
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: annotations.length > 0 || tutorResponse ? 10 : 0 }}>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.09em', textTransform: 'uppercase', color: C.faint }}>
          {showConcept && conceptTitle ? conceptTitle : `Turn ${snapshot.turnIndex}`}
        </span>
        {misconception && (
          <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 600, borderRadius: 99, padding: '3px 9px', background: 'rgba(146,64,14,.1)', color: C.amber }}>
            {misconception}
          </span>
        )}
      </div>

      {studentTranscript && (
        <p style={{ margin: '0 0 10px', fontSize: 12.5, lineHeight: '19px', color: C.muted }}>
          <span style={{ fontWeight: 600, color: C.ink }}>You:</span> {studentTranscript}
        </p>
      )}

      {annotations.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: tutorResponse ? 10 : 0 }}>
          {annotations.map((a) => (
            <AnnotationMark key={a.id} a={a} />
          ))}
        </div>
      )}

      {tutorResponse && <p style={{ margin: 0, fontSize: 13.5, lineHeight: '20px', color: C.ink }}>{tutorResponse}</p>}
    </div>
  )
}

/** A vertical list of snapshot cards, newest-first as given. */
export function SnapshotList({ snapshots, showConcept = false }: { snapshots: WorkedSnapshot[]; showConcept?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {snapshots.map((s) => (
        <SnapshotCard key={s.id} snapshot={s} showConcept={showConcept} />
      ))}
    </div>
  )
}
