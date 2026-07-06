'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useInView, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'
import { Section } from '@/components/marketing/Section'
import { Reveal } from '@/components/marketing/Reveal'
import { reduceScene, type MasteryDelta } from '@/components/marketing/demo/scene'
import { profileScene } from '@/components/marketing/demo/scripts'

// Sprint 20 Task 7: "It learns how you learn" — the same session the hero
// and SessionShowcase just played (factoring quadratics, the sign-errors
// gap), seen from a third angle: what the profile looked like walking in,
// and what it looks like walking out. profileScene (scripts.ts) is the
// single source of truth for every number and recap line here.
//
// This section does NOT play profileScene through useSceneTimeline. That
// hook's clock mode is built for the hero/showcase's looping demos; this
// section's gate is the opposite — animate once on first in-view, then hold,
// never replay on a later scroll-past. reduceScene (the shared pure reducer)
// is still what turns time into state; only the "play once" driver below is
// local to this component, the same way SessionShowcase hand-rolls its own
// scroll-scrub source instead of extending the shared engine.

// Not sourced from profileScene: the pre-session weak-spot/due-review lines
// aren't part of that script (only heroSession's overview strip carries
// them). Copy here mirrors heroSession's overview verbatim so the two
// sections agree on the same profile snapshot.
const BEFORE_WORKING_THROUGH = 'Sign errors — flagged last session'
const BEFORE_DUE = 'Distributive property — due today'

const CALLBACK_QUOTE =
  'This connects to the factoring work from a few sessions ago — same move, same equation shape.'

function formatComingBack(raw: string): string {
  const [title, when] = raw.split(' — ')
  return when ? `${title} comes back ${when}` : raw
}

function deltaDirection(from: number, to: number): 'up' | 'down' | null {
  if (to > from) return 'up'
  if (to < from) return 'down'
  return null
}

/** Plays profileScene once when it first enters view, then holds the end frame. */
function useProfilePlayback() {
  const reducedMotion = useReducedMotion() ?? false
  const ref = useRef<HTMLDivElement | null>(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (reducedMotion || !inView) return
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const delta = Math.min(now - start, profileScene.durationMs)
      setElapsed(delta)
      if (delta < profileScene.durationMs) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [inView, reducedMotion])

  const t = reducedMotion ? profileScene.durationMs : elapsed
  const state = useMemo(() => reduceScene(profileScene, t), [t])
  return { ref, state, reducedMotion }
}

export function ProfileSection() {
  const { ref, state, reducedMotion } = useProfilePlayback()
  const afterActive = state.masteryDeltas.length > 0
  const recap = state.strip?.variant === 'recap' ? state.strip : null

  return (
    <Section
      id="profile"
      kicker="It learns how you learn"
      heading="Every session updates what Calyxa knows about you."
      sub="Mastery levels, weak spots, and what's due for review — visible before and after every session."
    >
      <div ref={ref} className="grid gap-8 lg:grid-cols-2">
        <Reveal>
          <ProfilePanel label="Before this session">
            <MasteryBars
              rows={
                state.masteryDeltas.length > 0
                  ? state.masteryDeltas.map((d) => ({ title: d.title, value: d.from }))
                  : FALLBACK_BEFORE
              }
            />
            <div className="mt-5 flex flex-col gap-1.5 text-sm text-muted-foreground">
              <p className="m-0">Working through: {BEFORE_WORKING_THROUGH}</p>
              <p className="m-0">Due for review: {BEFORE_DUE}</p>
            </div>
          </ProfilePanel>
        </Reveal>

        <Reveal delay={0.1}>
          <ProfilePanel label="After this session">
            <MasteryDeltaBars deltas={state.masteryDeltas} active={afterActive} reducedMotion={reducedMotion} />
            <div
              className={cn(
                'mt-5 flex flex-col gap-1.5 rounded-lg border border-border bg-background p-4 text-sm',
                !reducedMotion && 'transition-all duration-500 ease-out',
                recap ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
              )}
            >
              {recap?.resolved && (
                <p className="m-0 font-medium text-accent-emphasis">✓ Gap closed: {recap.resolved}</p>
              )}
              {recap?.trend && <p className="m-0 font-medium text-accent-emphasis">{recap.trend}</p>}
              {recap?.comingBack && (
                <p className="m-0 text-muted-foreground">{formatComingBack(recap.comingBack)}</p>
              )}
            </div>
          </ProfilePanel>
        </Reveal>
      </div>

      <Reveal delay={0.2}>
        <figure className="mt-14 border-l-2 border-accent pl-4">
          <blockquote className="m-0 text-lg text-foreground">&ldquo;{CALLBACK_QUOTE}&rdquo;</blockquote>
          <figcaption className="mt-1 text-sm text-muted-foreground">
            Calyxa, picking up the thread a few sessions later
          </figcaption>
        </figure>
      </Reveal>
    </Section>
  )
}

// Only used before profileScene's masteryDelta step has ever fired (the very
// first frame, pre-animation) — reduceScene's own from-values take over the
// instant the step activates, so this never drifts from the script.
const FALLBACK_BEFORE = [
  { title: 'Factoring quadratics', value: 0.45 },
  { title: 'Distributive property', value: 0.72 },
  { title: 'Linear equations', value: 0.88 },
]

function ProfilePanel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-6 sm:p-8">
      <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-5">{children}</div>
    </div>
  )
}

function MasteryBars({ rows }: { rows: { title: string; value: number }[] }) {
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <div key={row.title} className="flex items-center gap-3">
          <span className="w-40 flex-none truncate text-sm text-foreground">{row.title}</span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-background">
            <span
              className="block h-full rounded-full bg-accent-glow-strong"
              style={{ width: `${Math.round(row.value * 100)}%` }}
            />
          </span>
          <span className="w-10 flex-none text-right text-sm text-muted-foreground">
            {Math.round(row.value * 100)}%
          </span>
        </div>
      ))}
    </div>
  )
}

function MasteryDeltaBars({
  deltas,
  active,
  reducedMotion,
}: {
  deltas: MasteryDelta[]
  active: boolean
  reducedMotion: boolean
}) {
  const rows = active ? deltas : FALLBACK_BEFORE.map((row) => ({ title: row.title, from: row.value, to: row.value }))

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => {
        const direction = deltaDirection(row.from, row.to)
        const shownValue = active ? row.to : row.from
        return (
          <div key={row.title} className="flex items-center gap-3">
            <span className="w-40 flex-none truncate text-sm text-foreground">{row.title}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-background">
              <span
                className={cn(
                  'block h-full rounded-full bg-accent-glow-strong',
                  !reducedMotion && 'transition-[width] duration-700 ease-out'
                )}
                style={{ width: `${Math.round(shownValue * 100)}%` }}
              />
            </span>
            <span className="flex w-14 flex-none items-center justify-end gap-1 text-right text-sm text-muted-foreground">
              {Math.round(shownValue * 100)}%
              {direction && (
                <span className={direction === 'up' ? 'text-accent-emphasis' : 'text-muted-foreground'}>
                  {direction === 'up' ? '▲' : '▼'}
                </span>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}
