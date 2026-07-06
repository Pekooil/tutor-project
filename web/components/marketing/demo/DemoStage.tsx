'use client'

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { DemoAnnotations, type TargetRect } from './DemoAnnotations'
import { DemoPanel } from './DemoPanel'
import { useSceneTimeline } from './useSceneTimeline'
import type { SceneScript } from './scene'

// The framed fake-browser stage (Sprint 20 Task 4, ADR-031): a generic math
// practice page (fictional site, no real brand) with the Calyxa panel
// recreation floating over it, exactly as the extension floats over a real
// page. Everything renders on a fixed 980×612 design canvas that scales to
// its container via CSS transform, so the composition — annotation
// geometry included — is identical at every viewport width.
//
// The whole visual is aria-hidden with a one-line sr-only alternative (the
// `alt` prop); nothing inside is focusable by construction (DemoPanel
// renders no interactive elements). The page text stays selectable — half
// the point of a DOM recreation is that a visitor can prove it's not video.

const DESIGN_W = 980
const DESIGN_H = 612

export function DemoStage({
  script,
  scrub,
  frameMs,
  alt,
  className,
}: {
  script: SceneScript
  /** 0..1 scroll progress for scrub mode (Task 6); omit for looping clock mode. */
  scrub?: number | null
  /** Fixed scene time in ms — one static frame, wins over scrub and reduced motion (Task 6's stacked beat cards). */
  frameMs?: number | null
  alt: string
  className?: string
}) {
  const { ref: timelineRef, state } = useSceneTimeline(script, { scrub, frameMs })
  const outerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1)
  const rects = useTargetRects(outerRef, canvasRef, state.annotations)

  const setOuterRef = useCallback(
    (el: HTMLDivElement | null) => {
      outerRef.current = el
      timelineRef.current = el
    },
    [timelineRef]
  )

  useLayoutEffect(() => {
    const outer = outerRef.current
    if (!outer) return
    const update = () => setScale(outer.clientWidth / DESIGN_W)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(outer)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={setOuterRef}
      className={className}
      style={
        {
          aspectRatio: `${DESIGN_W} / ${DESIGN_H}`,
          // The overlay's decorative hairline (--color-border in
          // @calyxa/ui/theme.css, #e5e3de). Unreachable by name inside /web:
          // globals.css deliberately re-targets --color-border to
          // border-strong for shadcn (see its collision comment), so the
          // recreation scopes the product's real value here — the same
          // file-local exception Overlay.css documents for its annotation
          // amber/blue. Never use this outside the demo tree.
          '--cx-demo-hairline': '#e5e3de',
        } as React.CSSProperties
      }
    >
      <p className="sr-only">{alt}</p>
      <div aria-hidden="true" className="relative h-full w-full overflow-hidden rounded-xl border border-(--cx-demo-hairline) shadow-panel">
        <div
          ref={canvasRef}
          className="relative bg-surface"
          style={{
            width: DESIGN_W,
            height: DESIGN_H,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          <BrowserChrome />
          <FakeMathPage />
          <DemoAnnotations annotations={state.annotations} rects={rects} width={DESIGN_W} height={DESIGN_H} />
          <div className="absolute bottom-5 right-5 top-[64px] z-20 w-[330px]">
            <DemoPanel state={state} />
          </div>
        </div>
      </div>
      {/* Demo-scoped keyframes, mirroring Overlay.css's discipline: looping
          motion exists only under prefers-reduced-motion: no-preference —
          reduced motion gets static bars and no caret blink, never a slower
          version of the same animation. */}
      <style>{`
        @keyframes cx-demo-bar { 0%, 100% { transform: scaleY(0.3); } 50% { transform: scaleY(1); } }
        @keyframes cx-demo-caret { 0%, 48% { opacity: 1; } 49%, 100% { opacity: 0; } }
        @media (prefers-reduced-motion: no-preference) {
          .cx-demo-bar { animation-name: cx-demo-bar; animation-timing-function: ease-in-out; animation-iteration-count: infinite; }
          .cx-demo-caret { animation: cx-demo-caret 1s step-end infinite; }
        }
      `}</style>
    </div>
  )
}

// Measures every [data-annot-target] on the fake page into design-space
// coordinates (scale-invariant: both rects come from the same scaled
// canvas, so dividing by the live scale factor recovers design units).
// Re-measured when fonts land, when the stage resizes, and whenever the
// active annotation set changes (so a layout shift after the initial
// measure can never draw against stale rects); an unmeasured target simply
// never draws — drop-don't-guess, like the real resolver.
function useTargetRects(
  outerRef: React.RefObject<HTMLDivElement | null>,
  canvasRef: React.RefObject<HTMLDivElement | null>,
  annotations: { id: string; target: string }[]
) {
  const [rects, setRects] = useState<Record<string, TargetRect>>({})
  // A stable key: the reducer returns a fresh array every frame, so the
  // effect must key on the set's CONTENT, not the array's identity.
  const annotationKey = annotations.map((annotation) => `${annotation.id}:${annotation.target}`).join('|')

  useLayoutEffect(() => {
    const outer = outerRef.current
    const canvas = canvasRef.current
    if (!outer || !canvas) return

    const measure = () => {
      const canvasRect = canvas.getBoundingClientRect()
      if (canvasRect.width === 0) return
      const liveScale = canvasRect.width / DESIGN_W
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
  }, [outerRef, canvasRef, annotationKey])

  return rects
}

function BrowserChrome() {
  return (
    <div className="flex h-10 items-center gap-3 border-b border-(--cx-demo-hairline) bg-background px-4">
      <span className="flex gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-(--color-border-strong)" />
        <span className="h-2.5 w-2.5 rounded-full bg-(--color-border-strong)" />
        <span className="h-2.5 w-2.5 rounded-full bg-(--color-border-strong)" />
      </span>
      <span className="flex h-6 flex-1 max-w-[420px] items-center gap-2 rounded-full bg-surface px-3">
        <svg width="9" height="10" viewBox="0 0 9 10" fill="none" className="flex-none text-muted-foreground">
          <rect x="1" y="4" width="7" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
          <path d="M2.5 4V3a2 2 0 0 1 4 0v1" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        <span className="truncate text-[11.5px] text-muted-foreground">oakbridgemath.example/unit-4/factoring</span>
      </span>
    </div>
  )
}

// A generic worksheet page — fictional site, real selectable text. The
// annotation targets ('problem', 'term-b', 'term-c') are the spans the
// scene scripts point at.
function FakeMathPage() {
  return (
    <div className="absolute inset-x-0 bottom-0 top-10 bg-background">
      <div className="flex h-11 items-center gap-2 border-b border-(--cx-demo-hairline) px-8">
        <span className="text-[13px] font-semibold text-foreground">OakBridge Math</span>
        <span className="text-[12px] text-muted-foreground">/ Unit 4 · Quadratics</span>
      </div>
      <div className="max-w-[560px] px-10 py-8">
        <h3 className="m-0 text-[18px] font-semibold text-foreground">Practice set — Factoring quadratics</h3>
        <p className="mt-1 text-[12.5px] text-muted-foreground">Solve each equation by factoring.</p>

        <div className="mt-6 flex items-baseline gap-3 text-[14px] text-muted-foreground">
          <span className="font-medium">2.</span>
          <span>
            x² − x − 12 = 0 → (x − 4)(x + 3) → x = 4, x = −3 <span className="text-accent-emphasis">✓</span>
          </span>
        </div>

        <div className="mt-6">
          <div className="flex items-baseline gap-3">
            <span className="text-[14px] font-medium text-muted-foreground">3.</span>
            <span className="text-[14px] text-muted-foreground">Solve by factoring:</span>
          </div>
          {/* mt-10 keeps the "b = 5" above-label pill (rect.y − 32) clear of
              the instruction line above the equation. */}
          <p className="mb-0 mt-10 pl-7 text-[24px] font-medium tracking-wide text-foreground">
            <span data-annot-target="problem">
              x² + <span data-annot-target="term-b">5x</span> + <span data-annot-target="term-c">6</span> = 0
            </span>
          </p>
          <div className="mt-7 flex flex-col gap-7 pl-7 pr-4">
            <div className="border-b border-(--cx-demo-hairline)" />
            <div className="border-b border-(--cx-demo-hairline)" />
            <div className="border-b border-(--cx-demo-hairline)" />
          </div>
        </div>
      </div>
    </div>
  )
}
