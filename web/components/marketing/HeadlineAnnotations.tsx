'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { annotDeep, annotStroke } from '@/components/marketing/demo/DemoAnnotations'
import { DEMO_TUTOR_MODES, type AnnotOrdinal, type ScenePing, type TutorModeKey } from '@/components/marketing/demo/scene'
import { pingCatalog } from '@/components/marketing/demo/scripts'

// The hero's above-the-fold chrome (Sprint 25 Task 5, ADR-040 decision 3):
// marketing decoration in the product's Meadow vocabulary, NOT a product
// recreation. Two exports, one file (the Task-5 file list is Hero.tsx +
// this file, so the ambient elements live here with the mark layer):
//
// 1. HeadlineAnnotations — an absolutely-positioned, aria-hidden SVG layer
//    over the server-rendered H1: an ordinal-1 circle + label pill and an
//    ordinal-2 underline + why-note (leader line to a side card), drawing
//    on ONCE after first paint with the product's M1 timings. The layer
//    mounts post-paint (double rAF) so the static H1 stays the LCP element;
//    pointer-events-none so it never blocks selection; measured against
//    [data-h1-mark] spans so it never reflows the text. The headline wins
//    every conflict: a phrase that wraps across lines drops its mark
//    (drop-don't-guess), and the why-note renders only when the viewport
//    leaves real room beside the headline column.
//
// 2. AmbientSignals — the cycling ping toast + tutor-mode capsule row, so
//    pings and modes are above the fold before the hero demo ever reaches
//    those beats. One element animates at a time, on a slow beat; both
//    slots are fixed-size so nothing around them ever shifts. Reduced
//    motion renders one composed static frame (no timers, no cycling).
//
// Colors read the product's --calyxa-annot/mode/ping-* tokens (reachable in
// /web via the @calyxa/ui theme import — the Task 3 finding); the tint/fill
// accessors mirror DemoAnnotations' non-exported helpers rather than adding
// exports to a file outside this task's scope.

const DRAW_EASE = [0.2, 0.8, 0.2, 1] as const

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
const LABEL_GAP = 10
const NOTE_WIDTH = 216
const NOTE_MARGIN = 24
const LEADER_LEN = 46

function labelWidth(text: string): number {
  return Math.max(32, Math.round(text.length * 6.2) + LABEL_PAD_X * 2)
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
  label?: string
  note?: string
}

const H1_MARKS: H1Mark[] = [
  { target: 'tutor', ordinal: 1, shape: 'circle', label: 'Talks out loud' },
  { target: 'screen', ordinal: 2, shape: 'underline', note: "It reads the page you're on and draws right on the problem." },
]

type MarkRect = { x: number; y: number; w: number; h: number }

export function HeadlineAnnotations() {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const reduceMotion = useReducedMotion() ?? false
  const [ready, setReady] = useState(false)
  const [rects, setRects] = useState<Record<string, MarkRect>>({})
  const [frame, setFrame] = useState({ w: 0, h: 0, noteRoom: false })

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
        // The why-note floats in the whitespace right of the headline
        // column; without room out there it hides rather than crowd the
        // text or the sections below.
        noteRoom: window.innerWidth - wrap.right >= LEADER_LEN + 10 + NOTE_WIDTH + NOTE_MARGIN,
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
      {ready && frame.w > 0 && drawable.length > 0 && (
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
              noteRoom={frame.noteRoom}
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
  noteRoom,
  delay,
  reduceMotion,
}: {
  mark: H1Mark
  rect: MarkRect
  noteRoom: boolean
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
    const pillW = mark.label ? labelWidth(mark.label) : 0
    const pillX = cx - pillW / 2
    const pillY = rect.y - 6 - LABEL_GAP - LABEL_HEIGHT

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
        {mark.label && (
          <motion.g {...metaProps} transition={metaTransition}>
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
              {mark.label}
            </text>
          </motion.g>
        )}
      </g>
    )
  }

  // Underline: the 3px rounded bar under the baseline + the soft tint block
  // over the phrase, with the why-note as a side card on a leader line —
  // the Meadow leader earns its place here because the display type leaves
  // no adjacent room (the demo's marks never needed one).
  const barY = rect.y + rect.h + 4
  const noteH = mark.note ? noteHeight(mark.note) : 0
  const noteX = rect.x + rect.w + LEADER_LEN + 10
  const noteY = rect.y + rect.h / 2 - noteH / 2
  const showNote = Boolean(mark.note) && noteRoom
  const leaderFrom = { x: rect.x + rect.w + 8, y: barY }
  const leaderTo = { x: noteX - 6, y: noteY + noteH / 2 }
  const leaderMid = { x: (leaderFrom.x + leaderTo.x) / 2, y: Math.min(leaderFrom.y, leaderTo.y) - 10 }

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
      {showNote && (
        <motion.g {...metaProps} transition={metaTransition}>
          <path
            d={`M ${leaderFrom.x} ${leaderFrom.y} Q ${leaderMid.x} ${leaderMid.y} ${leaderTo.x} ${leaderTo.y}`}
            fill="none"
            stroke={stroke}
            strokeWidth={1.5}
            strokeLinecap="round"
            opacity={0.8}
          />
          <foreignObject x={noteX} y={noteY} width={NOTE_WIDTH} height={noteH + 4}>
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
              <span
                style={{ marginTop: 6, width: 6, height: 6, flex: 'none', borderRadius: 99, background: stroke }}
              />
              <span style={{ fontSize: 12.5, lineHeight: 1.55, color: '#46463f', textAlign: 'left' }}>{mark.note}</span>
            </div>
          </foreignObject>
        </motion.g>
      )}
    </g>
  )
}

// ── The ambient signals row ──────────────────────────────────────────────

// A calm subset of the ping catalog (scripts.ts): tones that read as wins
// and teaching moves next to the CTA — the full three-tone catalog lives in
// Task 7's interactive vignette.
const AMBIENT_PING_KINDS = ['pattern-broken', 'callback', 'confidence-up', 'teaching-decompose'] as const
const AMBIENT_PINGS: ScenePing[] = pingCatalog.filter((entry) =>
  (AMBIENT_PING_KINDS as readonly string[]).includes(entry.kind)
)

const AMBIENT_MODES: TutorModeKey[] = ['explore', 'coach', 'challenge', 'review']

// The beat: every 4s one element takes a turn — even ticks switch the mode
// capsule (450ms color crossfade, the title bar's timing), odd ticks drop a
// ping toast in for 3s. Reduced motion: one composed static frame.
const TICK_MS = 4000
const PING_HOLD_MS = 3000

export function AmbientSignals() {
  const reduceMotion = useReducedMotion() ?? false
  const [tick, setTick] = useState(0)
  const [modeIndex, setModeIndex] = useState(0)
  const [pingIndex, setPingIndex] = useState(0)
  const [pingVisible, setPingVisible] = useState(false)

  useEffect(() => {
    if (reduceMotion) return
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS)
    return () => clearInterval(id)
  }, [reduceMotion])

  useEffect(() => {
    if (reduceMotion || tick === 0) return
    if (tick % 2 === 1) {
      setPingVisible(true)
      const id = setTimeout(() => {
        setPingVisible(false)
        setPingIndex((p) => (p + 1) % AMBIENT_PINGS.length)
      }, PING_HOLD_MS)
      return () => clearTimeout(id)
    }
    setModeIndex((m) => (m + 1) % AMBIENT_MODES.length)
  }, [tick, reduceMotion])

  const mode = DEMO_TUTOR_MODES[AMBIENT_MODES[reduceMotion ? 1 : modeIndex]]
  const ping = AMBIENT_PINGS[pingIndex] ?? AMBIENT_PINGS[0]
  const showPing = reduceMotion || pingVisible

  return (
    // Both slots are fixed-size and the row reserves its height, so the
    // cycle never moves anything around it. Decorative (the hero demo's
    // sr-only alt covers pings and modes for readers) — aria-hidden,
    // nothing focusable.
    <div aria-hidden="true" className="mt-7 flex min-h-10 flex-wrap items-center justify-center gap-x-3 gap-y-2">
      <span className="flex h-10 w-40 items-center justify-center gap-2 rounded-full border border-(--mkt-border-faint) bg-white/65 px-3 shadow-(--mkt-shadow-1) backdrop-blur-[8px]">
        <span
          className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[7px] border text-[11.5px] font-bold transition-[color,background-color,border-color] duration-[450ms]"
          style={{
            color: `var(--calyxa-mode-${mode.key}-text)`,
            background: `var(--calyxa-mode-${mode.key}-bg)`,
            borderColor: `var(--calyxa-mode-${mode.key}-border)`,
          }}
        >
          {mode.glyph}
        </span>
        <span className="flex min-w-0 flex-col items-start gap-0 leading-none">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={mode.key}
              initial={reduceMotion ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
              transition={{ duration: 0.3, ease: DRAW_EASE }}
              className="text-[13px] font-semibold transition-colors duration-[450ms]"
              style={{ color: `var(--calyxa-mode-${mode.key}-text)` }}
            >
              {mode.name}
            </motion.span>
          </AnimatePresence>
          <span className="text-[9.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Tutor mode</span>
        </span>
      </span>
      <span className="relative flex h-10 w-60 items-center justify-center">
        <AnimatePresence initial={false}>
          {showPing && (
            <motion.span
              key={ping.label}
              initial={reduceMotion ? false : { opacity: 0, y: -12, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -9, scale: 0.96, transition: { duration: 0.3 } }}
              transition={{ duration: 0.45, ease: DRAW_EASE }}
              className="absolute flex items-center gap-[7px] whitespace-nowrap rounded-full border py-[7px] pl-[11px] pr-3.5 text-[12.5px] font-semibold shadow-[0_8px_22px_rgba(15,23,42,0.12)]"
              style={{
                background: `var(--calyxa-ping-${ping.tone}-bg)`,
                borderColor: `var(--calyxa-ping-${ping.tone}-border)`,
                color: `var(--calyxa-ping-${ping.tone}-text)`,
              }}
            >
              <span className="text-[13.5px] font-bold leading-none">{ping.glyph}</span>
              <span>{ping.label}</span>
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </div>
  )
}
