'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { AnnotOrdinal, SceneAnnotation } from './scene'

export type TargetRect = { x: number; y: number; w: number; h: number }

// The overlay recreation of the redesigned AnnotationLayer.tsx (Sprint 25
// Task 3, ADR-040): the Meadow ordinal system — four stroke/tint/deep color
// triples, a label pill on every mark ("no naked shapes"), the optional
// why-note card and step badge, and the M1 draw-on entry (stroke draws in
// over 480ms, fill fades from ~55%, label/badge/note rise in after). Every
// color reads the product's own `--calyxa-annot-*` tokens — @calyxa/ui's
// theme.css is imported by web/app/globals.css, so the raw variables are
// reachable here by name; nothing re-declares a hex.
//
// Coordinates arrive in DemoStage's design space; annotations whose target
// was never measured are silently skipped — the same drop-don't-guess
// discipline as the real resolver. Stable ids never re-draw (a re-annotate
// step that keeps an id keeps its mark on screen, no entry replay); exits
// are always a 240ms opacity fade, never a shrink.

const DRAW_EASE = [0.2, 0.8, 0.2, 1] as const

export function annotStroke(ordinal: AnnotOrdinal): string {
  return `var(--calyxa-annot-${ordinal})`
}

export function annotDeep(ordinal: AnnotOrdinal): string {
  return `var(--calyxa-annot-${ordinal}-deep)`
}

function annotTint(ordinal: AnnotOrdinal): string {
  return `var(--calyxa-annot-${ordinal}-tint)`
}

function annotTintBorder(ordinal: AnnotOrdinal): string {
  return `var(--calyxa-annot-${ordinal}-tint-border)`
}

function annotFill(ordinal: AnnotOrdinal): string {
  return `var(--calyxa-annot-${ordinal}-fill)`
}

// The real layer's label metrics (AnnotationLayer.tsx): 26px pill, 12px/600
// text at ~6.2px/char, 11px side padding; note card ≤216px wide at
// 12.5px/1.55 ≈ 28 chars/line.
const LABEL_HEIGHT = 26
const LABEL_PAD_X = 11
const LABEL_GAP = 10
const NOTE_WIDTH = 216
const NOTE_GAP = 8
const BADGE_SIZE = 22

function labelWidth(text: string): number {
  return Math.max(32, Math.round(text.length * 6.2) + LABEL_PAD_X * 2)
}

function noteHeight(text: string): number {
  const lines = Math.max(1, Math.ceil(text.length / 28))
  return lines * 19 + 18
}

export function DemoAnnotations({
  annotations,
  rects,
  width,
  height,
}: {
  annotations: SceneAnnotation[]
  rects: Record<string, TargetRect>
  width: number
  height: number
}) {
  const reduceMotion = useReducedMotion() ?? false
  const drawable = annotations.filter((annotation) => rects[annotation.target])

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="pointer-events-none absolute inset-0 z-10"
    >
      <AnimatePresence>
        {drawable.map((annotation, index) => (
          <Mark
            key={annotation.id}
            annotation={annotation}
            rect={rects[annotation.target]}
            toRect={annotation.to ? rects[annotation.to] : undefined}
            // Co-arriving marks stagger 600ms apart (the real layer's
            // --cx-annot-delay), sequenced with the tutor's speech.
            delay={reduceMotion ? 0 : index * 0.6}
            reduceMotion={reduceMotion}
          />
        ))}
      </AnimatePresence>
    </svg>
  )
}

function Mark({
  annotation,
  rect,
  toRect,
  delay,
  reduceMotion,
}: {
  annotation: SceneAnnotation
  rect: TargetRect
  toRect: TargetRect | undefined
  delay: number
  reduceMotion: boolean
}) {
  const { ordinal } = annotation

  // M1 draw-on timings (AnnotationLayer.tsx / the handoff): stroke 480ms,
  // fill fades 260ms starting at ~55% of the draw, meta rises 320ms after
  // the draw completes. Reduced motion: instant, opacity-only.
  const drawTransition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.48, ease: DRAW_EASE, delay }
  const fillTransition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.26, ease: 'easeOut' as const, delay: delay + 0.265 }
  const metaTransition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.32, ease: DRAW_EASE, delay: delay + 0.48 }

  return (
    <motion.g exit={{ opacity: 0, transition: { duration: 0.24 } }}>
      <Shape
        annotation={annotation}
        rect={rect}
        toRect={toRect}
        drawTransition={drawTransition}
        fillTransition={fillTransition}
        reduceMotion={reduceMotion}
      />
      <motion.g
        initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={metaTransition}
      >
        <LabelMeta annotation={annotation} rect={rect} />
        {annotation.step !== undefined && <StepBadge ordinal={ordinal} step={annotation.step} rect={rect} />}
      </motion.g>
    </motion.g>
  )
}

// The shape vocabulary (all 2px stroke, rounded): box `rx 10` drawn ~7px
// outside the target; circle with ~10px/6px padding; underline = 3px
// rounded-cap bar 4px under the baseline + a soft tint block over the
// phrase; arrow = curved quadratic path with an open two-segment head and a
// 3px origin dot.
function Shape({
  annotation,
  rect,
  toRect,
  drawTransition,
  fillTransition,
  reduceMotion,
}: {
  annotation: SceneAnnotation
  rect: TargetRect
  toRect: TargetRect | undefined
  drawTransition: object
  fillTransition: object
  reduceMotion: boolean
}) {
  const { ordinal, shape } = annotation
  const stroke = annotStroke(ordinal)
  const drawProps = reduceMotion
    ? { initial: { opacity: 1 }, animate: { opacity: 1 } }
    : { initial: { pathLength: 0, opacity: 1 }, animate: { pathLength: 1, opacity: 1 } }
  const fillProps = reduceMotion
    ? { initial: { opacity: 1 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0 }, animate: { opacity: 1 } }

  if (shape === 'box') {
    return (
      <>
        <motion.rect
          x={rect.x - 7}
          y={rect.y - 7}
          width={rect.w + 14}
          height={rect.h + 14}
          rx={10}
          fill={annotFill(ordinal)}
          stroke="none"
          {...fillProps}
          transition={fillTransition}
        />
        <motion.rect
          x={rect.x - 7}
          y={rect.y - 7}
          width={rect.w + 14}
          height={rect.h + 14}
          rx={10}
          fill="none"
          stroke={stroke}
          strokeWidth={2}
          {...drawProps}
          transition={drawTransition}
        />
      </>
    )
  }

  if (shape === 'circle') {
    const cx = rect.x + rect.w / 2
    const cy = rect.y + rect.h / 2
    const rx = rect.w / 2 + 10
    const ry = rect.h / 2 + 6
    return (
      <>
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
      </>
    )
  }

  if (shape === 'underline') {
    const barY = rect.y + rect.h + 4
    return (
      <>
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
      </>
    )
  }

  // Arrow: from `target`'s right-center toward `to`'s left-center (or a
  // short self-anchored curve when `to` was never measured — drop the head
  // rather than guess a second anchor: the mark still points, never lies).
  const from = { x: rect.x + rect.w + 4, y: rect.y + rect.h / 2 }
  const to = toRect ? { x: toRect.x - 6, y: toRect.y + toRect.h / 2 } : { x: from.x + 46, y: from.y - 18 }
  const mid = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 16 }
  const angle = Math.atan2(to.y - mid.y, to.x - mid.x)
  const head = (spread: number) => ({
    x: to.x - 9 * Math.cos(angle + spread),
    y: to.y - 9 * Math.sin(angle + spread),
  })
  const headA = head(0.5)
  const headB = head(-0.5)

  return (
    <>
      <motion.circle cx={from.x} cy={from.y} r={3} fill={annotStroke(ordinal)} {...fillProps} transition={fillTransition} />
      <motion.path
        d={`M ${from.x} ${from.y} Q ${mid.x} ${mid.y} ${to.x} ${to.y}`}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        {...drawProps}
        transition={drawTransition}
      />
      {toRect && (
        <motion.path
          d={`M ${headA.x} ${headA.y} L ${to.x} ${to.y} L ${headB.x} ${headB.y}`}
          fill="none"
          stroke={stroke}
          strokeWidth={2}
          strokeLinecap="round"
          {...drawProps}
          transition={drawTransition}
        />
      )}
    </>
  )
}

// The label pill (required on every mark) + the attached why-note. Pills are
// tint-bg + tint-border + DEEP text — dark-on-light per the brand rule,
// replacing the old white-on-color. The note wraps as real HTML inside a
// foreignObject, the same technique as the shipped layer.
function LabelMeta({ annotation, rect }: { annotation: SceneAnnotation; rect: TargetRect }) {
  const { ordinal } = annotation
  // Placement default: underlines read below (the pill under the bar), and
  // any note-bearing mark goes below too — the pill + note stack is tall,
  // and above-placement would climb over whatever the page shows above the
  // mark (the real layer's collision pass handles this; the demo's rule of
  // thumb replaces it). An explicit labelSide always wins, so scripts keep
  // final say over composition. The stack keeps LABEL_GAP clear of the
  // mark's stroke (which sits ~7px outside the rect) on whichever side.
  const below =
    annotation.labelSide === 'below' ||
    (annotation.labelSide === undefined && (annotation.shape === 'underline' || annotation.note !== undefined))
  const pillW = labelWidth(annotation.label)
  const pillX = rect.x - 4
  const noteH = annotation.note ? noteHeight(annotation.note) : 0
  const metaHeight = LABEL_HEIGHT + (annotation.note ? NOTE_GAP + noteH : 0)
  const pillY = below ? rect.y + rect.h + LABEL_GAP + 4 : rect.y - 7 - LABEL_GAP - metaHeight

  return (
    <g>
      <rect
        x={pillX}
        y={pillY}
        width={pillW}
        height={LABEL_HEIGHT}
        rx={LABEL_HEIGHT / 2}
        fill={annotTint(ordinal)}
        stroke={annotTintBorder(ordinal)}
        strokeWidth={1}
        style={{ filter: 'drop-shadow(0 1px 2px rgba(15,23,42,0.06))' }}
      />
      <text
        x={pillX + pillW / 2}
        y={pillY + LABEL_HEIGHT / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill={annotDeep(ordinal)}
        style={{ fontSize: 12, fontWeight: 600, userSelect: 'none' }}
      >
        {annotation.label}
      </text>
      {annotation.note && (
        <foreignObject
          x={pillX}
          y={pillY + LABEL_HEIGHT + NOTE_GAP}
          width={NOTE_WIDTH}
          height={noteH + 4}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 6,
              background: 'rgba(255,255,255,0.94)',
              border: '1px solid var(--cx-demo-hairline)',
              borderRadius: 12,
              padding: '9px 12px',
              boxShadow: '0 4px 14px rgba(15,23,42,0.08)',
              maxWidth: NOTE_WIDTH,
            }}
          >
            <span
              style={{
                marginTop: 6,
                width: 6,
                height: 6,
                flex: 'none',
                borderRadius: 99,
                background: annotStroke(ordinal),
              }}
            />
            <span style={{ fontSize: 12.5, lineHeight: 1.55, color: '#46463f' }}>{annotation.note}</span>
          </div>
        </foreignObject>
      )}
    </g>
  )
}

// The numbered step badge at the mark's top-left corner — the twin of the
// pre-session plan's timeline circles (22px, tint bg, 1.5px stroke border,
// deep-text number).
function StepBadge({ ordinal, step, rect }: { ordinal: AnnotOrdinal; step: number; rect: TargetRect }) {
  const cx = rect.x - 9
  const cy = rect.y - 27 + BADGE_SIZE / 2
  return (
    <g>
      <circle cx={cx} cy={cy} r={BADGE_SIZE / 2} fill={annotTint(ordinal)} stroke={annotStroke(ordinal)} strokeWidth={1.5} />
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        fill={annotDeep(ordinal)}
        style={{ fontSize: 11.5, fontWeight: 600, userSelect: 'none' }}
      >
        {step}
      </text>
    </g>
  )
}
