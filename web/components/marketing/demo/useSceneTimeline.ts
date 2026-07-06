'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { reduceScene, scrubTime, type SceneScript, type SceneState } from './scene'

type TimelineOptions = {
  /**
   * Scroll-driven playback: 0..1 scrubs the script instead of the clock.
   * Pass null/undefined for clock mode (the hero's looping playback).
   */
  scrub?: number | null
  /**
   * Fixed-frame mode (Task 6 addendum): render the scene at this time (ms)
   * and never move — the stacked beat cards. A fixed frame is already
   * motionless, so it takes priority over the reduced-motion override; with
   * the override, every beat card would collapse onto the same end frame.
   */
  frameMs?: number | null
}

// The one player for every scene (Sprint 20 Task 4, ADR-031). Four modes,
// one reducer: a frameMs renders one fixed frame; prefers-reduced-motion
// renders the final composed frame with zero movement; a scrub value maps
// scroll progress onto the timeline; and clock mode runs a rAF loop that
// only ticks while the stage is in view (IntersectionObserver), holds the
// final frame for restMs, then restarts.
export function useSceneTimeline(script: SceneScript, options: TimelineOptions = {}) {
  const reducedMotion = useReducedMotion()
  const scrub = options.scrub ?? null
  const frameMs = options.frameMs ?? null

  const ref = useRef<HTMLDivElement | null>(null)
  const [inView, setInView] = useState(false)
  const [clockT, setClockT] = useState(0)
  // Elapsed time persists across off-screen pauses: scrolling away freezes
  // the scene, scrolling back resumes it mid-story instead of restarting.
  const elapsedRef = useRef(0)

  useEffect(() => {
    if (frameMs !== null || reducedMotion || scrub !== null) return
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.25 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [frameMs, reducedMotion, scrub])

  useEffect(() => {
    if (frameMs !== null || reducedMotion || scrub !== null || !inView) return
    let frame = 0
    let last = performance.now()
    const cycleMs = script.durationMs + script.restMs
    const tick = (now: number) => {
      // Clamp the per-frame delta: rAF freezes in hidden tabs, and without
      // this the first frame after tab-switching back would add the whole
      // hidden stretch at once and skip the scene to a random point.
      elapsedRef.current += Math.min(now - last, 100)
      last = now
      setClockT(Math.min(elapsedRef.current % cycleMs, script.durationMs))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [frameMs, reducedMotion, scrub, inView, script])

  const t =
    frameMs !== null
      ? Math.max(0, Math.min(frameMs, script.durationMs))
      : reducedMotion
        ? script.durationMs
        : scrub !== null
          ? scrubTime(script, scrub)
          : clockT

  const state: SceneState = useMemo(() => reduceScene(script, t), [script, t])

  return {
    /** Attach to the stage's outermost element — gates clock playback to in-view. */
    ref,
    state,
    t,
    playing: frameMs === null && !reducedMotion && scrub === null && inView,
    reducedMotion: reducedMotion ?? false,
  }
}
