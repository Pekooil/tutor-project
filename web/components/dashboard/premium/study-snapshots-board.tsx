import type { CSSProperties } from 'react'
import type { SnapshotAnnotation, WorkedSnapshot } from './snapshots-read'
import { C } from './theme'

// ADR-055 (redesign): the worked-problem snapshot rendered as a VISUAL board —
// the math spans the tutor pointed at, with the tutor's marks actually DRAWN on
// them (highlighter swash / hand-drawn circle / squiggle underline) in the
// annotation colours, and the "why" notes as margin annotations. Still a
// reconstruction from the persisted `annotations` data (never a pixel capture),
// but it now reads like a picture of the tutor's marks instead of a text list.
// Presentational (no hooks) so it renders inside the server concept/session
// screens and the client notebook alike.

const MATH_FONT = "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif"

// The four marker colours the model may emit (ENVELOPE_TOOL style.color) mapped
// to a drawn-ink / highlighter-tint / note-ink triple. Null/unknown → neutral so
// an unexpected value still renders legibly.
type MarkPalette = { ink: string; tint: string; note: string }
const MARK_COLORS: Record<string, MarkPalette> = {
  amber: { ink: '#d97706', tint: 'rgba(245,158,11,.38)', note: '#92400e' },
  blue: { ink: '#2563eb', tint: 'rgba(59,130,246,.30)', note: '#1e40af' },
  green: { ink: '#16a34a', tint: 'rgba(34,197,94,.34)', note: '#166534' },
  red: { ink: '#dc2626', tint: 'rgba(239,68,68,.30)', note: '#991b1b' },
}
const NEUTRAL_MARK: MarkPalette = { ink: '#6b6b65', tint: 'rgba(28,28,26,.12)', note: '#3f3f3a' }

function palette(color: string | null): MarkPalette {
  return (color && MARK_COLORS[color]) || NEUTRAL_MARK
}

type MarkKind = 'highlight' | 'underline' | 'circle'

// Map the emitted annotation type to one of the three drawable marks. `arrow`
// reads as an underline (a line the tutor drew along the span); everything else
// that targets a span reads as the tutor circling it.
function markKind(type: string): MarkKind {
  if (type === 'highlight') return 'highlight'
  if (type === 'underline' || type === 'arrow') return 'underline'
  return 'circle'
}

// The math span with the tutor's mark drawn over it. The overlays use an SVG
// with preserveAspectRatio="none" + vector-effect non-scaling-stroke, so the
// mark hugs the span's real width while the ink stays an even weight.
function MarkedSpan({ text, kind, ink, tint }: { text: string; kind: MarkKind; ink: string; tint: string }) {
  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-block',
        padding: '5px 12px',
        margin: '3px 0',
        fontFamily: MATH_FONT,
        fontSize: 18,
        fontWeight: 500,
        lineHeight: 1.15,
        color: C.ink,
        whiteSpace: 'pre-wrap',
      }}
    >
      {kind === 'highlight' && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 2,
            right: 2,
            top: '22%',
            bottom: '20%',
            background: tint,
            borderRadius: 3,
            transform: 'rotate(-.5deg)',
            zIndex: 0,
          }}
        />
      )}
      <span style={{ position: 'relative', zIndex: 1 }}>{text}</span>
      {kind === 'circle' && (
        <svg
          aria-hidden
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ position: 'absolute', left: -4, top: -5, width: 'calc(100% + 8px)', height: 'calc(100% + 10px)', overflow: 'visible', zIndex: 2, pointerEvents: 'none' }}
        >
          <path
            d="M8,52 C5,26 28,9 51,8 C77,7 96,22 95,49 C94,78 68,94 45,92 C22,90 9,73 9,50"
            fill="none"
            stroke={ink}
            strokeWidth="2.4"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
      {kind === 'underline' && (
        <svg
          aria-hidden
          viewBox="0 0 120 10"
          preserveAspectRatio="none"
          style={{ position: 'absolute', left: 4, right: 4, bottom: -1, width: 'calc(100% - 8px)', height: 7, overflow: 'visible', zIndex: 2, pointerEvents: 'none' }}
        >
          <path
            d="M1,5 Q 15,1.5 30,5 T 60,5 T 90,5 T 119,5"
            fill="none"
            stroke={ink}
            strokeWidth="2.2"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
    </span>
  )
}

// One annotation: the marked span (when it targets one) plus the tutor's margin
// note. When there's no target span, it's a free-standing marker note.
function MarkBlock({ a }: { a: SnapshotAnnotation }) {
  const p = palette(a.color)
  const kind = markKind(a.type)
  return (
    <div style={{ marginBottom: 12 }}>
      {a.targetText && <MarkedSpan text={a.targetText} kind={kind} ink={p.ink} tint={p.tint} />}
      {(a.label || a.note) && (
        <div style={{ display: 'flex', gap: 8, marginTop: a.targetText ? 5 : 0, paddingLeft: a.targetText ? 4 : 0 }}>
          <span style={{ flex: 'none', width: 3, borderRadius: 99, background: p.ink, opacity: 0.75 }} />
          <div style={{ minWidth: 0 }}>
            {a.label && <span style={{ fontSize: 13, fontWeight: 600, color: p.note }}>{a.label}</span>}
            {a.note && (
              <p style={{ margin: a.label ? '2px 0 0' : 0, fontSize: 12.5, lineHeight: '18px', color: C.muted }}>{a.note}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const cardStyle: CSSProperties = {
  border: '1px solid rgba(28,28,26,.09)',
  borderRadius: 15,
  padding: '14px 16px',
  background: 'rgba(255,255,255,.62)',
}

/** One tutored turn rendered as a marked-up board. `showConcept` labels the turn
 *  with its concept (session timeline, where turns span concepts). */
export function SnapshotBoardCard({ snapshot, showConcept = false }: { snapshot: WorkedSnapshot; showConcept?: boolean }) {
  const { annotations, tutorResponse, misconception, studentTranscript, conceptTitle } = snapshot
  const hasBoard = annotations.length > 0

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
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

      {/* The board — the tutor's marks drawn on the math they pointed at. */}
      {hasBoard && (
        <div
          style={{
            position: 'relative',
            borderRadius: 12,
            border: '1px solid rgba(28,28,26,.06)',
            background: 'rgba(252,251,247,.7)',
            padding: '12px 14px 6px',
            marginBottom: tutorResponse ? 10 : 0,
          }}
        >
          {annotations.map((a) => (
            <MarkBlock key={a.id} a={a} />
          ))}
        </div>
      )}

      {tutorResponse && <p style={{ margin: 0, fontSize: 13.5, lineHeight: '20px', color: C.ink }}>{tutorResponse}</p>}
    </div>
  )
}

/** A vertical list of snapshot boards, newest-first as given. */
export function SnapshotBoardList({ snapshots, showConcept = false }: { snapshots: WorkedSnapshot[]; showConcept?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {snapshots.map((s) => (
        <SnapshotBoardCard key={s.id} snapshot={s} showConcept={showConcept} />
      ))}
    </div>
  )
}
