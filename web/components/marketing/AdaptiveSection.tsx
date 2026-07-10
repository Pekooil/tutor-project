'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { CalyxaMark } from '@calyxa/ui'
import { Section } from '@/components/marketing/Section'
import { Reveal } from '@/components/marketing/Reveal'
import { DemoPanel } from '@/components/marketing/demo/DemoPanel'
import { DemoPing } from '@/components/marketing/demo/DemoPing'
import { DemoAnnotations, type TargetRect } from '@/components/marketing/demo/DemoAnnotations'
import { DEMO_TUTOR_MODES, type TutorModeKey } from '@/components/marketing/demo/scene'
import { useSceneTimeline } from '@/components/marketing/demo/useSceneTimeline'
import {
  adaptiveVignetteAlts,
  annotationVignette,
  modesVignette,
  pingCatalog,
  predictionVignette,
  type PingCatalogEntry,
} from '@/components/marketing/demo/scripts'

// Sprint 25 Task 7 (ADR-040 decision 4): "It adapts while you work" — the
// four adaptive systems (misconception prediction, tutor modes, annotation
// anatomy, the ping catalog) as parallel machinery in a 2×2 vignette grid,
// mounted between the scroll-scrubbed showcase (narrative) and the profile
// section (bookends). Vignettes 1–3 are passive loops on Task 4's vignette
// scripts, rendered with Task 3's DemoPanel/DemoAnnotations — aria-hidden
// visuals with sr-only alternatives, nothing focusable, same as DemoStage.
// The ping catalog is the exception: the page's second interactive element
// after the flashcard (design 8b's tap-to-fire) — real buttons, keyboard
// reachable, firing DemoPing toasts into a header recreation.

// The demo tree's two file-local color exceptions, mirrored from DemoStage
// (see its comment for why these two values are unreachable by token name
// inside /web). Scoped to this section's grid; never used outside the
// vignette visuals.
const DEMO_SCOPE_VARS = {
  '--cx-demo-hairline': '#e5e3de',
  '--cx-demo-hairline-soft': '#eceae5',
} as React.CSSProperties

// The real overlay's panel width — DemoPanel is a 1:1 recreation at this
// width (DemoStage's PANEL_W), scaled down here when a tile is narrower.
const PANEL_W = 420

export function AdaptiveSection() {
  return (
    <Section
      id="adaptive"
      kicker="It adapts while you work"
      heading="Four systems, tuning the session as you go."
      sub="Misconception prediction, tutor modes, annotations, and pings — parallel machinery, all live in the overlay."
    >
      <div className="grid gap-6 lg:grid-cols-2" style={DEMO_SCOPE_VARS}>
        <Reveal className="min-w-0">
          <PredictionVignette />
        </Reveal>
        <Reveal className="min-w-0" delay={0.08}>
          <ModesVignette />
        </Reveal>
        <Reveal className="min-w-0" delay={0.12}>
          <AnnotationVignette />
        </Reveal>
        <Reveal className="min-w-0" delay={0.2}>
          <PingCatalogVignette />
        </Reveal>
      </div>
      {/* The demo-scoped keyframes these vignettes' renderers depend on
          (DemoPanel's clock dot + scanning orb, DemoPing's toast cycle),
          mirrored 1:1 from DemoStage's scoped <style> — this section renders
          the demo components WITHOUT DemoStage, so it carries its own copy
          rather than leaning on another section's style tag being on the
          page. Same reduced-motion discipline: looping motion exists only
          under prefers-reduced-motion: no-preference. */}
      <style>{`
        @keyframes cx-demo-ping {
          0% { opacity: 0; transform: translate(-50%, -18px) scale(0.92); }
          9% { opacity: 1; transform: translate(-50%, 0) scale(1); }
          85% { opacity: 1; transform: translate(-50%, 0) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -14px) scale(0.95); }
        }
        @keyframes cx-demo-dot { 0%, 100% { transform: scale(0.65); opacity: 0.5; } 50% { transform: scale(1); opacity: 1; } }
        @keyframes cx-demo-ring { 0% { transform: scale(0.7); opacity: 0.55; } 100% { transform: scale(1.9); opacity: 0; } }
        @keyframes cx-demo-orb { 0%, 100% { transform: scale(0.86); opacity: 0.7; } 50% { transform: scale(1.1); opacity: 1; } }
        .cx-demo-ping { transform: translateX(-50%); }
        @media (prefers-reduced-motion: no-preference) {
          .cx-demo-ping { animation: cx-demo-ping 3s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
          .cx-demo-dot { animation: cx-demo-dot 2.2s ease-in-out infinite; }
          .cx-demo-ring { animation: cx-demo-ring 2.6s ease-out infinite; }
          .cx-demo-orb { animation: cx-demo-orb 2.8s ease-in-out infinite; }
        }
      `}</style>
    </Section>
  )
}

// ── The tile shell ────────────────────────────────────────────────────────

function VignetteCard({
  title,
  body,
  children,
  fillContent,
}: {
  title: string
  body: string
  children: ReactNode
  // When set, the content area grows to fill the card's height (a flex
  // column) instead of pinning to the bottom — lets a vignette space its own
  // pieces top-to-bottom (the modes tile: title card up top, panel below).
  fillContent?: boolean
}) {
  return (
    <div className="mkt-card flex h-full flex-col gap-5 p-5 sm:p-6">
      <div>
        <h3 className="m-0 text-lg font-semibold tracking-[-0.01em] text-foreground">{title}</h3>
        <p className="mb-0 mt-1.5 text-sm text-pretty text-muted-foreground">{body}</p>
      </div>
      <div className={fillContent ? 'flex flex-1 flex-col' : 'mt-auto'}>{children}</div>
    </div>
  )
}

// ── Panel viewport (vignettes 1–2) ───────────────────────────────────────
// DemoPanel at its real 420px width, scaled to fit the tile and anchored
// bottom-center like the overlay's resting position — the panel's height is
// intrinsic and grows UPWARD (scan orb → prediction card), so the viewport
// reserves the tallest state's height and lets the panel breathe into it.

function PanelViewport({ designHeight, children }: { designHeight: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setScale(Math.min(1, el.clientWidth / PANEL_W))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className="relative w-full overflow-hidden rounded-lg bg-surface"
      style={{ height: Math.round(designHeight * scale) }}
    >
      <div
        className="absolute bottom-0 left-1/2 pb-3.5"
        style={{ width: PANEL_W, transform: `translateX(-50%) scale(${scale})`, transformOrigin: 'bottom center' }}
      >
        {children}
      </div>
    </div>
  )
}

// ── Vignette 1 — misconception prediction ────────────────────────────────

function PredictionVignette() {
  const { ref, state } = useSceneTimeline(predictionVignette)
  return (
    <VignetteCard
      title="It calls your sticking point first."
      body="The pre-session check-in scans the page, checks your history, and makes one prediction about where you'll get stuck — before the first question."
    >
      <p className="sr-only">{adaptiveVignetteAlts.prediction}</p>
      <div ref={ref} aria-hidden="true">
        {/* Tallest state: the composed AI-prediction card (~350px). */}
        <PanelViewport designHeight={372}>
          <DemoPanel state={state} />
        </PanelViewport>
      </div>
    </VignetteCard>
  )
}

// ── Vignette 2 — tutor modes ─────────────────────────────────────────────
// The mode title card (design 8c): as modesVignette walks the eight modes,
// the card cross-fades to the live mode's identity — glyph chip (with the 8c
// gradient glow), name, LIVE marker, its one-line brief, and the "Enters"
// trigger. The catalog copy is design 8c's modeList, kept local to this
// marketing vignette rather than widened into the shared scene vocabulary.

const MODE_CARDS: Record<TutorModeKey, { blurb: string; enters: string }> = {
  explore: {
    blurb: 'Open ground — Calyxa maps what you already know and lets you poke at the problem before steering.',
    enters: 'session start, or a brand-new topic',
  },
  coach: {
    blurb: 'Tight guidance — smaller steps, more hints, one question at a time until the block clears.',
    enters: 'a misconception fires or hints ramp up',
  },
  build: {
    blurb: 'Assembling the method together — Calyxa scaffolds, but every step on the board is yours.',
    enters: 'a key concept lands and it’s time to use it',
  },
  practice: {
    blurb: 'Reps with the guardrails off — Calyxa goes quiet and only steps in on a slip.',
    enters: 'the method works without help',
  },
  challenge: {
    blurb: 'A stretch problem above the current level — no hints unless asked; earn the level-up.',
    enters: 'practice is clean and confidence runs high',
  },
  verify: {
    blurb: 'Quick checks — a few fast questions to prove the concept stuck before moving on.',
    enters: 'before a level-up, or a claim of “got it”',
  },
  review: {
    blurb: 'Looking back — recap the wins, name the pattern, connect it to last session.',
    enters: 'a section closes or the clock runs low',
  },
  recover: {
    blurb: 'A soft reset — easier ground and a quick win first; no new material until footing returns.',
    enters: 'two misses in a row or frustration shows',
  },
}

function ModeTitleCard({ modeKey }: { modeKey: TutorModeKey }) {
  const reduceMotion = useReducedMotion() ?? false
  const mode = DEMO_TUTOR_MODES[modeKey]
  const card = MODE_CARDS[modeKey]
  const text = `var(--calyxa-mode-${mode.key}-text)`
  const bg = `var(--calyxa-mode-${mode.key}-bg)`
  const border = `var(--calyxa-mode-${mode.key}-border)`

  return (
    // Fixed height so the cross-fade never shifts the tile (blurbs differ in
    // length across modes).
    <div className="relative min-h-[192px]">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={mode.key}
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
          transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
          className="flex flex-col gap-2.5 rounded-xl border bg-background p-4 sm:p-5"
          style={{ borderColor: `color-mix(in srgb, ${border} 55%, var(--mkt-border-faint))` }}
        >
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border text-[15px] font-bold"
              style={{
                color: text,
                background: bg,
                borderColor: border,
                // The mode glyphs are geometric symbols that only render
                // correctly in the overlay's system stack — Geist (web's
                // display font) malforms several (● shrinks, ↺/✓ distort). Pin
                // the extension font so they match the extension exactly.
                fontFamily: 'var(--font-sans)',
                boxShadow: `0 0 0 1px color-mix(in srgb, ${border} 35%, transparent), 0 3px 10px -2px color-mix(in srgb, ${border} 60%, transparent), 0 0 16px 3px color-mix(in srgb, ${border} 30%, transparent)`,
              }}
            >
              {mode.glyph}
            </span>
            <span className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">{mode.name}</span>
            <span
              className="ml-auto flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em]"
              style={{ color: text }}
            >
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: border }} />
              Live
            </span>
          </div>
          <p className="m-0 text-[13px] leading-[1.55] text-pretty text-muted-foreground">{card.blurb}</p>
          <p className="m-0 mt-auto text-[11.5px] leading-[1.5] text-(--calyxa-hint-text)">
            <span className="font-semibold text-secondary-foreground">Enters:</span> {card.enters}
          </p>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function ModesVignette() {
  const { ref, state } = useSceneTimeline(modesVignette)
  return (
    <VignetteCard
      title="Eight ways to teach, switched live."
      body="Each mode gets its own title card — Exploring, Coaching, Verifying — and the session header switches to match, mid-session, as you do."
      fillContent
    >
      <p className="sr-only">{adaptiveVignetteAlts.modes}</p>
      <div ref={ref} aria-hidden="true" className="flex flex-1 flex-col gap-5">
        {/* The mode title card fills the space up top; the original session
            panel keeps its place at the bottom. Both read the same live mode,
            so they cross-fade / recolor together as the session walks the
            eight modes. */}
        <ModeTitleCard modeKey={state.mode} />
        <div className="mt-auto">
          <PanelViewport designHeight={172}>
            <DemoPanel state={state} />
          </PanelViewport>
        </div>
      </div>
    </VignetteCard>
  )
}

// ── Vignette 3 — annotation anatomy ──────────────────────────────────────
// The fixture equation on a bare surface with the Meadow mark assembling
// over it, piece by piece (annotationVignette's script). Same fixed design
// canvas + CSS-scale approach as DemoStage, so the annotation geometry is
// identical at every tile width; same drop-don't-guess measurement (an
// unmeasured target never draws).

const ANNOT_DESIGN = { w: 480, h: 300 }

function AnnotationVignette() {
  const { ref: timelineRef, state } = useSceneTimeline(annotationVignette)
  const outerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1)
  const [rects, setRects] = useState<Record<string, TargetRect>>({})

  useLayoutEffect(() => {
    const outer = outerRef.current
    const canvas = canvasRef.current
    if (!outer || !canvas) return

    const measure = () => {
      setScale(outer.clientWidth / ANNOT_DESIGN.w)
      const canvasRect = canvas.getBoundingClientRect()
      if (canvasRect.width === 0) return
      const liveScale = canvasRect.width / ANNOT_DESIGN.w
      const next: Record<string, TargetRect> = {}
      canvas.querySelectorAll<HTMLElement>('[data-annot-target]').forEach((el) => {
        const r = el.getBoundingClientRect()
        next[el.dataset.annotTarget as string] = {
          x: (r.left - canvasRect.left) / liveScale,
          y: (r.top - canvasRect.top) / liveScale,
          w: r.width / liveScale,
          h: r.height / liveScale,
        }
      })
      setRects((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    }

    measure()
    document.fonts?.ready.then(measure).catch(() => {})
    const observer = new ResizeObserver(measure)
    observer.observe(outer)
    return () => observer.disconnect()
  }, [])

  return (
    <VignetteCard
      title="Every mark explains itself."
      body="A label on every mark, a why-note when the step needs explaining, numbered badges for the order to think in."
    >
      <p className="sr-only">{adaptiveVignetteAlts.annotations}</p>
      <div
        ref={(el) => {
          outerRef.current = el
          timelineRef.current = el
        }}
        aria-hidden="true"
        className="relative w-full overflow-hidden rounded-lg bg-surface"
        style={{ aspectRatio: `${ANNOT_DESIGN.w} / ${ANNOT_DESIGN.h}` }}
      >
        <div
          ref={canvasRef}
          className="relative"
          style={{ width: ANNOT_DESIGN.w, height: ANNOT_DESIGN.h, transform: `scale(${scale})`, transformOrigin: 'top left' }}
        >
          {/* Vertically offset so the "Add to 5" pill + why-note stack
              (labelSide 'above', ~107px tall) clears the canvas top and the
              below-side "Multiply to 6" pill clears the bottom. */}
          <div className="flex h-full items-center justify-center">
            <p className="m-0 mt-7 text-[24px] font-medium tracking-wide text-foreground">
              <span data-annot-target="problem">
                x² + <span data-annot-target="term-b">5x</span> + <span data-annot-target="term-c">6</span> = 0
              </span>
            </p>
          </div>
          <DemoAnnotations annotations={state.annotations} rects={rects} width={ANNOT_DESIGN.w} height={ANNOT_DESIGN.h} />
        </div>
      </div>
    </VignetteCard>
  )
}

// ── Vignette 4 — the ping catalog (tap-to-fire, design 8b) ───────────────
// All nineteen ping kinds as real tone-tinted buttons; tapping one fires
// its toast into a header recreation, one at a time, on the product's 3s
// cycle. The page's second interactive element after the flashcard —
// buttons are keyboard reachable and the fired ping is announced via a
// polite status region; only the visual toast stage is aria-hidden.

const PING_CYCLE_MS = 3000

function PingCatalogVignette() {
  const [fired, setFired] = useState<{ entry: PingCatalogEntry; seq: number } | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  const fire = (entry: PingCatalogEntry) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    // seq keys the DemoPing element, so re-firing the SAME kind remounts the
    // toast and re-runs its cycle (DemoPing's own label key can't see that).
    setFired((prev) => ({ entry, seq: (prev?.seq ?? 0) + 1 }))
    timeoutRef.current = setTimeout(() => setFired(null), PING_CYCLE_MS)
  }

  return (
    <VignetteCard
      title="Three tones of ping."
      body="Sage for wins, neutral for teaching moves, amber for watch-outs — one at a time, never a feed. Tap one to fire it."
    >
      <p className="sr-only">{adaptiveVignetteAlts.pings}</p>
      <p aria-live="polite" className="sr-only">
        {fired ? `Ping fired: ${fired.entry.label}` : ''}
      </p>
      <div className="flex flex-col gap-4">
        {/* The toast stage: the panel header recreation the toast drops
            into, with headroom above for the −18px entry. */}
        <div aria-hidden="true" className="rounded-lg bg-surface px-3 pb-3 pt-12">
          <div className="relative rounded-lg border border-(--cx-demo-hairline) bg-background/85 shadow-panel backdrop-blur-[18px] backdrop-saturate-[1.5]">
            {fired && <DemoPing key={fired.seq} ping={fired.entry} />}
            <div className="flex items-center gap-[9px] px-3.5 pb-[9px] pt-[10px]">
              <CalyxaMark className="h-[19px] w-[19px] flex-none" />
              <span className="text-[13.5px] font-semibold text-foreground">Calyxa</span>
              <span className="ml-auto flex items-center gap-1.5 text-[11.5px] tabular-nums text-muted-foreground">
                <span className="cx-demo-dot h-[7px] w-[7px] rounded-full bg-accent-glow-strong" />
                4:32
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {pingCatalog.map((entry) => (
            <button
              key={entry.kind}
              type="button"
              onClick={() => fire(entry)}
              aria-label={`Fire ping: ${entry.label}`}
              className="cursor-pointer rounded-full border px-[11px] py-[5px] text-[12px] font-semibold leading-normal transition-transform duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100"
              style={{
                background: `var(--calyxa-ping-${entry.tone}-bg)`,
                borderColor: `var(--calyxa-ping-${entry.tone}-border)`,
                color: `var(--calyxa-ping-${entry.tone}-text)`,
              }}
            >
              <span aria-hidden="true" className="mr-1.5 font-bold" style={{ fontFamily: 'var(--font-sans)' }}>
                {entry.glyph}
              </span>
              {entry.label.split(' · ')[0]}
            </button>
          ))}
        </div>
      </div>
    </VignetteCard>
  )
}
