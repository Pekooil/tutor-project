'use client'

import { motion } from 'motion/react'
import type { AnnotColor, SceneAnnotation } from './scene'

export type TargetRect = { x: number; y: number; w: number; h: number }

// The annotation palette mirrors the real overlay's exactly
// (extension/src/overlay/Overlay.css, .cx-annot-*): these are the product's
// shipped annotation colors, reproduced for fidelity — not new marketing
// colors (green/red are the @calyxa/ui tokens; amber/blue are the same
// extension-local values Overlay.css documents as its own scoped exception).
const ANNOT_STROKE: Record<AnnotColor, string> = {
  amber: '#d97706',
  blue: '#2563eb',
  green: '#166534', // --color-accent-emphasis
  red: '#b91c1c', // --color-danger
}

const ANNOT_FILL: Record<AnnotColor, string> = {
  amber: 'rgb(217 119 6 / 0.22)',
  blue: 'rgb(37 99 235 / 0.18)',
  green: 'rgb(22 101 52 / 0.18)',
  red: 'rgb(185 28 28 / 0.16)',
}

export function annotColor(color: AnnotColor): string {
  return ANNOT_STROKE[color]
}

// The overlay recreation of AnnotationLayer.tsx's `highlight` + label-pill
// vocabulary (ADR-022/029: the outlined box is the primary annotation).
// Coordinates arrive in DemoStage's design space; annotations whose target
// was never measured are silently skipped — the same drop-don't-guess
// discipline as the real resolver.
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
  const drawable = annotations.filter((annotation) => rects[annotation.target])
  if (drawable.length === 0) return null

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="pointer-events-none absolute inset-0 z-10"
    >
      {drawable.map((annotation) => (
        <AnnotationShape key={annotation.id} annotation={annotation} rect={rects[annotation.target]} />
      ))}
    </svg>
  )
}

function AnnotationShape({ annotation, rect }: { annotation: SceneAnnotation; rect: TargetRect }) {
  const stroke = ANNOT_STROKE[annotation.color]
  const fill = ANNOT_FILL[annotation.color]

  return (
    // Mirrors .cx-annot-in: scale up from 92% while fading, one-shot per
    // mount — a stable id across annotate steps never re-draws.
    <motion.g
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18, ease: [0, 0, 0.2, 1] }}
      style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
    >
      <rect
        x={rect.x - 4}
        y={rect.y - 4}
        width={rect.w + 8}
        height={rect.h + 8}
        rx={6}
        fill={fill}
        stroke={stroke}
        strokeWidth={1.5}
      />
      {annotation.label && <LabelPill annotation={annotation} rect={rect} stroke={stroke} />}
    </motion.g>
  )
}

// The real LabelPill: a solid pill adjacent to the rect, width estimated
// from character count (11px semibold white text), above by default.
function LabelPill({
  annotation,
  rect,
  stroke,
}: {
  annotation: SceneAnnotation
  rect: TargetRect
  stroke: string
}) {
  const text = annotation.label ?? ''
  const pillHeight = 22
  const paddingX = 8
  const pillWidth = Math.max(28, Math.round(text.length * 6.5) + paddingX * 2)
  const below = annotation.labelSide === 'below'
  const y = below ? rect.y + rect.h + 10 : rect.y - pillHeight - 10
  const x = rect.x - 4

  return (
    <g>
      <rect x={x} y={y} width={pillWidth} height={pillHeight} rx={pillHeight / 2} fill={stroke} />
      <text
        x={x + pillWidth / 2}
        y={y + pillHeight / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill="#ffffff"
        style={{ fontSize: 11, fontWeight: 600, userSelect: 'none' }}
      >
        {text}
      </text>
    </g>
  )
}
