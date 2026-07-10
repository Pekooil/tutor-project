'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { annotDeep, annotStroke } from '@/components/marketing/demo/DemoAnnotations'
import type { AnnotOrdinal } from '@/components/marketing/demo/scene'

// The hero's above-the-fold flagship chrome (Sprint 25 Task 5, ADR-040
// decision 3): marketing decoration in the product's Meadow vocabulary, NOT
// a product recreation.
//
// HeadlineAnnotations — an absolutely-positioned, aria-hidden SVG layer over
// the server-rendered H1 that recreates the extension's on-page annotation
// system so the page's flagship feature reads as flagship: an ordinal-1
// circle and an ordinal-2 underline, each carrying the full extension
// anatomy — a numbered ordinal badge, a tint label pill ("no naked marks"),
// and, on the underline, the leader-lined why-note that carries the
// point-at-the-page teaching payload. The marks draw on ONCE after first
// paint with the product's M1 timings. The layer mounts post-paint (double
// rAF) so the static H1 stays the LCP element; pointer-events-none so it
// never blocks selection; measured against [data-h1-mark] spans so it never
// reflows the text. The headline wins every conflict: a phrase that wraps
// across lines drops its mark (drop-don't-guess), and the why-note renders
// only when the viewport leaves real room beside the headline column.
//
// Colors read the product's --calyxa-annot-* tokens (reachable in /web via
// the @calyxa/ui theme import — the Task 3 finding); the tint/fill accessors
// mirror DemoAnnotations' non-exported helpers rather than adding exports to
// a file outside this task's scope.

const DRAW_EASE = [0.2, 0.8, 0.2, 1] as const

// Below this headline-column width the H1 wraps to 3+ lines and the target
// phrases stop fitting on single lines, so the marks would crowd rather than
// point. The layer is decorative flagship chrome for the wide desktop hero —
// under it, the sub-paragraph already carries the message — so it simply
// doesn't draw on narrow columns.
const MARK_MIN_COLUMN = 760

// Both marks now pull their label + why-note out into the side margins (mark
// 1 left, mark 2 right). The layer only draws when BOTH margins can hold at
// least the label pill — otherwise a mark would be a bare shape. This lands
// the full point + teach anatomy on wide desktops and hides it below.
const SIDE_MARGIN = 20
const SIDE_MIN = 14 + 152 + SIDE_MARGIN

function annotTint(ordinal: AnnotOrdinal): string {
  return `var(--calyxa-annot-${ordinal}-tint)`
}

function annotTintBorder(ordinal: AnnotOrdinal): string {
  return `var(--calyxa-annot-${ordinal}-tint-border)`
}

function annotFill(ordinal: AnnotOrdinal): string {
  return `var(--calyxa-annot-${ordinal}-fill)`
}

// The product's label metrics (AnnotationLayer.tsx via DemoAnnotations):
// pills and notes keep their shipped pixel size — they deliberately do NOT
// scale with the display type, so the chrome reads as the product pointing
// at the page, not as part of the typography.
const LABEL_HEIGHT = 26
const LABEL_PAD_X = 11
const NOTE_WIDTH = 216
const NOTE_GAP = 8

// The ordinal number rides inside the label pill as an 18px coin (the
// extension's numbered step badge, adapted for the headline's tight leading
// where a corner badge would climb into the line above). White fill so the
// number reads crisply on the tint pill; stroke + deep text per ordinal.
const BADGE_R = 9
const PILL_LEAD = 4
const PILL_BADGE_GAP = 6

function numberedPillWidth(text: string): number {
  return PILL_LEAD + BADGE_R * 2 + PILL_BADGE_GAP + Math.round(text.length * 6.2) + LABEL_PAD_X
}

function noteHeight(text: string): number {
  const lines = Math.max(1, Math.ceil(text.length / 28))
  return lines * 19 + 18
}

// The two H1 marks (ADR-040 decision 3's exact vocabulary): the circle's
// pill puts VOICE above the fold; the underline's why-note carries the
// point-at-the-page teaching payload. Targets are data-h1-mark spans in
// Hero.tsx's H1.
type H1Mark = {
  target: string
  ordinal: AnnotOrdinal
  shape: 'circle' | 'underline'
  step: number
  label: string
  note?: string
}

const H1_MARKS: H1Mark[] = [
  {
    target: 'tutor',
    ordinal: 1,
    shape: 'circle',
    step: 1,
    label: 'Adaptive tutoring',
    note: 'Switches how it teaches — coaching, practice, challenge — to match where you are.',
  },
  {
    target: 'screen',
    ordinal: 2,
    shape: 'underline',
    step: 2,
    label: 'Draws on the page',
    note: "It reads the page you're on and marks the exact step you're missing.",
  },
]

type MarkRect = { x: number; y: number; w: number; h: number }

export function HeadlineAnnotations() {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const reduceMotion = useReducedMotion() ?? false
  const [ready, setReady] = useState(false)
  const [rects, setRects] = useState<Record<string, MarkRect>>({})
  const [frame, setFrame] = useState({ w: 0, h: 0, leftSpace: 0, rightSpace: 0 })

  // Mount after paint (double rAF): the H1 has already painted as plain
  // static HTML before this layer exists, so it can never become the LCP.
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    if (!ready) return
    const wrapper = rootRef.current?.parentElement
    if (!wrapper) return

    const measure = () => {
      const wrap = wrapper.getBoundingClientRect()
      if (wrap.width === 0) return
      const next: Record<string, MarkRect> = {}
      wrapper.querySelectorAll<HTMLElement>('[data-h1-mark]').forEach((el) => {
        const lines = el.getClientRects()
        // A phrase that wrapped across lines gets no mark — the mark dies,
        // the headline wins (ADR-040 decision 3's conflict rule).
        if (lines.length !== 1) return
        const r = lines[0]
        next[el.dataset.h1Mark as string] = { x: r.left - wrap.left, y: r.top - wrap.top, w: r.width, h: r.height }
      })
      setRects(next)
      setFrame({
        w: wrap.width,
        h: wrap.height,
        // Each mark's label (and, when it fits, its why-note) sits in the
        // whitespace beside the headline column — mark 1 left, mark 2 right.
        // Pass the raw room on each side so a mark can choose pill-only vs
        // pill+note rather than ever crowding the text or the sections below.
        leftSpace: wrap.left,
        rightSpace: window.innerWidth - wrap.right,
      })
    }

    measure()
    document.fonts?.ready.then(measure).catch(() => {})
    const observer = new ResizeObserver(measure)
    observer.observe(wrapper)
    // Also watch the H1 itself: a re-wrap can change its height without
    // touching the wrapper's width, and stale rects must never keep a mark
    // on a phrase that has since wrapped.
    const h1 = wrapper.querySelector('h1')
    if (h1) observer.observe(h1)
    return () => observer.disconnect()
  }, [ready])

  const drawable = H1_MARKS.filter((mark) => rects[mark.target])

  return (
    <div ref={rootRef} aria-hidden="true" className="pointer-events-none absolute inset-0">
      {ready &&
        frame.w >= MARK_MIN_COLUMN &&
        Math.min(frame.leftSpace, frame.rightSpace) >= SIDE_MIN &&
        drawable.length > 0 && (
        <svg
          focusable="false"
          width={frame.w}
          height={frame.h}
          viewBox={`0 0 ${frame.w} ${frame.h}`}
          className="absolute inset-0 overflow-visible"
        >
          {drawable.map((mark, index) => (
            <HeadlineMark
              key={mark.target}
              mark={mark}
              rect={rects[mark.target]}
              frameW={frame.w}
              leftSpace={frame.leftSpace}
              rightSpace={frame.rightSpace}
              // Draw once on load, sequenced like co-arriving product marks:
              // a beat after paint, then the 600ms co-arrival stagger.
              delay={reduceMotion ? 0 : 0.4 + index * 0.6}
              reduceMotion={reduceMotion}
            />
          ))}
        </svg>
      )}
    </div>
  )
}

// One mark, the M1 draw-on (DemoAnnotations' timings, mirrored): stroke
// draws 480ms, fill fades in 260ms from ~55% of the draw, pill/note rise
// 320ms after the draw completes. Reduced motion renders the composed
// final frame instantly.
function HeadlineMark({
  mark,
  rect,
  frameW,
  leftSpace,
  rightSpace,
  delay,
  reduceMotion,
}: {
  mark: H1Mark
  rect: MarkRect
  frameW: number
  leftSpace: number
  rightSpace: number
  delay: number
  reduceMotion: boolean
}) {
  const { ordinal } = mark
  const stroke = annotStroke(ordinal)

  const drawProps = reduceMotion
    ? { initial: { opacity: 1 }, animate: { opacity: 1 } }
    : { initial: { pathLength: 0, opacity: 1 }, animate: { pathLength: 1, opacity: 1 } }
  const fillProps = reduceMotion
    ? { initial: { opacity: 1 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0 }, animate: { opacity: 1 } }
  const drawTransition = reduceMotion ? { duration: 0 } : { duration: 0.48, ease: DRAW_EASE, delay }
  const fillTransition = reduceMotion ? { duration: 0 } : { duration: 0.26, ease: 'easeOut' as const, delay: delay + 0.265 }
  const metaTransition = reduceMotion ? { duration: 0 } : { duration: 0.32, ease: DRAW_EASE, delay: delay + 0.48 }
  const metaProps = reduceMotion
    ? { initial: { opacity: 1 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 5 }, animate: { opacity: 1, y: 0 } }

  if (mark.shape === 'circle') {
    const cx = rect.x + rect.w / 2
    const cy = rect.y + rect.h / 2
    const rx = rect.w / 2 + 10
    const ry = rect.h / 2 + 6
    // The circle's label + why-note are pulled out to the LEFT on a leader:
    // the stack right-aligns against the column's left edge (so it stays in
    // the clean left margin) and the leader reaches in to the circle.
    const pillW = numberedPillWidth(mark.label)
    const noteH = mark.note ? noteHeight(mark.note) : 0
    const showPill = leftSpace >= 14 + pillW + SIDE_MARGIN
    const showNote = Boolean(mark.note) && leftSpace >= 14 + NOTE_WIDTH + SIDE_MARGIN
    const stackH = LABEL_HEIGHT + (showNote ? NOTE_GAP + noteH : 0)
    const stackTop = cy - stackH / 2
    const stackRight = -14
    const pillX = stackRight - pillW
    const noteX = stackRight - NOTE_WIDTH
    const leaderFrom = { x: cx - rx - 2, y: cy }
    const leaderTo = { x: stackRight + 6, y: stackTop + LABEL_HEIGHT / 2 }
    const leaderMid = { x: (leaderFrom.x + leaderTo.x) / 2, y: Math.min(leaderFrom.y, leaderTo.y) - 8 }

    return (
      <g>
        <motion.ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={annotFill(ordinal)} stroke="none" {...fillProps} transition={fillTransition} />
        <motion.ellipse
          cx={cx}
          cy={cy}
          rx={rx}
          ry={ry}
          fill="none"
          stroke={stroke}
          strokeWidth={2}
          {...drawProps}
          transition={drawTransition}
        />
        {showPill && (
          <motion.g {...metaProps} transition={metaTransition}>
            <path
              d={`M ${leaderFrom.x} ${leaderFrom.y} Q ${leaderMid.x} ${leaderMid.y} ${leaderTo.x} ${leaderTo.y}`}
              fill="none"
              stroke={stroke}
              strokeWidth={1.5}
              strokeLinecap="round"
              opacity={0.45}
            />
            <circle cx={leaderFrom.x} cy={leaderFrom.y} r={3} fill={stroke} />
            <NumberedPill x={pillX} y={stackTop} ordinal={ordinal} step={mark.step} label={mark.label} />
            {showNote && mark.note && <WhyNote x={noteX} y={stackTop + LABEL_HEIGHT + NOTE_GAP} note={mark.note} stroke={stroke} />}
          </motion.g>
        )}
      </g>
    )
  }

  // Underline: the 3px rounded bar under the baseline + the soft tint block
  // over the phrase. Its numbered label pill (and, when the margin is wide
  // enough, its why-note) sits just right of the headline column on a leader
  // — the extension's leader earns its place here because the display type
  // leaves no adjacent room. The stack anchors to the wrapper's right edge
  // (not the phrase's, which runs nearly full-width), so it always lands in
  // the clean margin beside line 2, never over the sub below. If even the
  // pill won't fit the margin, the mark stays label-less rather than crowd.
  const barY = rect.y + rect.h + 4
  const noteH = mark.note ? noteHeight(mark.note) : 0
  const pillW = numberedPillWidth(mark.label)
  const sideX = frameW + 14
  const showPill = rightSpace >= 14 + pillW + SIDE_MARGIN
  const showNote = Boolean(mark.note) && rightSpace >= 14 + NOTE_WIDTH + SIDE_MARGIN
  const stackH = LABEL_HEIGHT + (showNote ? NOTE_GAP + noteH : 0)
  const sideTop = rect.y + rect.h / 2 - stackH / 2
  const leaderFrom = { x: rect.x + rect.w + 6, y: rect.y + rect.h / 2 }
  const leaderTo = { x: sideX - 6, y: sideTop + LABEL_HEIGHT / 2 }
  const leaderMid = { x: (leaderFrom.x + leaderTo.x) / 2, y: Math.min(leaderFrom.y, leaderTo.y) - 8 }

  return (
    <g>
      <motion.rect
        x={rect.x - 3}
        y={rect.y - 2}
        width={rect.w + 6}
        height={rect.h + 4}
        rx={5}
        fill={annotFill(ordinal)}
        stroke="none"
        {...fillProps}
        transition={fillTransition}
      />
      <motion.line
        x1={rect.x}
        y1={barY}
        x2={rect.x + rect.w}
        y2={barY}
        stroke={stroke}
        strokeWidth={3}
        strokeLinecap="round"
        {...drawProps}
        transition={drawTransition}
      />
      {showPill && (
        <motion.g {...metaProps} transition={metaTransition}>
          <path
            d={`M ${leaderFrom.x} ${leaderFrom.y} Q ${leaderMid.x} ${leaderMid.y} ${leaderTo.x} ${leaderTo.y}`}
            fill="none"
            stroke={stroke}
            strokeWidth={1.5}
            strokeLinecap="round"
            opacity={0.45}
          />
          <circle cx={leaderFrom.x} cy={leaderFrom.y} r={3} fill={stroke} />
          <NumberedPill x={sideX} y={sideTop} ordinal={ordinal} step={mark.step} label={mark.label} />
          {showNote && mark.note && <WhyNote x={sideX} y={sideTop + LABEL_HEIGHT + NOTE_GAP} note={mark.note} stroke={stroke} />}
        </motion.g>
      )}
    </g>
  )
}

// The why-note card (the extension's teaching payload) — a white card with a
// stroke-colored dot and the note text, rendered as real HTML inside a
// foreignObject so it wraps. Left-margin (mark 1) and right-margin (mark 2)
// stacks share it.
function WhyNote({ x, y, note, stroke }: { x: number; y: number; note: string; stroke: string }) {
  return (
    <foreignObject x={x} y={y} width={NOTE_WIDTH} height={noteHeight(note) + 4}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 6,
          background: 'rgba(255,255,255,0.94)',
          border: '1px solid var(--mkt-border-faint)',
          borderRadius: 12,
          padding: '9px 12px',
          boxShadow: '0 4px 14px rgba(15,23,42,0.08)',
          maxWidth: NOTE_WIDTH,
        }}
      >
        <span style={{ marginTop: 6, width: 6, height: 6, flex: 'none', borderRadius: 99, background: stroke }} />
        <span style={{ fontSize: 12.5, lineHeight: 1.55, color: '#46463f', textAlign: 'left' }}>{note}</span>
      </div>
    </foreignObject>
  )
}

// The label pill (required on every mark — "no naked marks") with the ordinal
// number carried as a leading coin. Tint bg + tint-border + deep text per the
// brand's dark-on-light rule; the coin is white-filled with the ordinal
// stroke + deep number so it reads as the extension's numbered step badge.
function NumberedPill({
  x,
  y,
  ordinal,
  step,
  label,
}: {
  x: number
  y: number
  ordinal: AnnotOrdinal
  step: number
  label: string
}) {
  const w = numberedPillWidth(label)
  const badgeCx = x + PILL_LEAD + BADGE_R
  const midY = y + LABEL_HEIGHT / 2
  const textX = x + PILL_LEAD + BADGE_R * 2 + PILL_BADGE_GAP
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={LABEL_HEIGHT}
        rx={LABEL_HEIGHT / 2}
        fill={annotTint(ordinal)}
        stroke={annotTintBorder(ordinal)}
        strokeWidth={1}
        style={{ filter: 'drop-shadow(0 1px 2px rgba(15,23,42,0.06))' }}
      />
      <circle cx={badgeCx} cy={midY} r={BADGE_R} fill="#ffffff" stroke={annotStroke(ordinal)} strokeWidth={1.5} />
      <text
        x={badgeCx}
        y={midY}
        textAnchor="middle"
        dominantBaseline="central"
        fill={annotDeep(ordinal)}
        style={{ fontSize: 11, fontWeight: 700, userSelect: 'none' }}
      >
        {step}
      </text>
      <text
        x={textX}
        y={midY}
        dominantBaseline="central"
        fill={annotDeep(ordinal)}
        style={{ fontSize: 12, fontWeight: 600, userSelect: 'none' }}
      >
        {label}
      </text>
    </g>
  )
}
