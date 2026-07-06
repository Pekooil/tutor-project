'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useInView, useReducedMotion } from 'motion/react'
import { ListChecks, NotebookText, SquareStack, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Section } from '@/components/marketing/Section'
import { Reveal } from '@/components/marketing/Reveal'
import { reduceScene, type ArtifactKind } from '@/components/marketing/demo/scene'
import { studyLoopScene } from '@/components/marketing/demo/scripts'

// Sprint 20 Task 8: "One session in. A study kit out." The same factoring
// session (x² + 5x + 6 = 0, the sign-errors gap) that the hero, showcase, and
// profile sections already played fans out into three artifact cards, timed
// by studyLoopScene (scripts.ts, written in Task 4).
//
// Like ProfileSection (Task 7), this hand-rolls a local one-shot driver
// instead of useSceneTimeline: the acceptance gate wants the fan-out to play
// ONCE on first in-view, not loop (the hero) or scrub (the showcase).
// reduceScene — the shared pure reducer — still turns that local clock into
// state; only the "play once" wiring is duplicated from Task 7's, since
// adding a one-shot mode to the shared engine was out of both tasks' file
// scope. Worth a real dedup pass if a third section ever needs this same
// shape (flagged in the sprint plan's handoff).

const SESSION_SUMMARY = {
  title: 'Session complete — Factoring quadratics',
  detail: 'x² + 5x + 6 = 0 · Gap closed: sign errors',
}

const NOTES_STEPS = [
  'Factor by finding two numbers that multiply to 6 and add to 5 → 2 and 3.',
  'Rewrite: x² + 5x + 6 = (x + 2)(x + 3).',
  'Set each factor to zero, minding the sign: x = −2, x = −3.',
]

const PRACTICE_PROBLEMS = ['x² + 7x + 10 = 0', 'x² − 2x − 15 = 0']

const FLASHCARD = {
  front: 'What two numbers multiply to 6 and add to 5?',
  back: '2 and 3',
}

function useStudyLoopPlayback() {
  const reducedMotion = useReducedMotion() ?? false
  const ref = useRef<HTMLDivElement | null>(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (reducedMotion || !inView) return
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const delta = Math.min(now - start, studyLoopScene.durationMs)
      setElapsed(delta)
      if (delta < studyLoopScene.durationMs) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [inView, reducedMotion])

  const t = reducedMotion ? studyLoopScene.durationMs : elapsed
  const state = useMemo(() => reduceScene(studyLoopScene, t), [t])
  return { ref, state, reducedMotion }
}

export function StudyLoopSection() {
  const { ref, state, reducedMotion } = useStudyLoopPlayback()
  const has = (kind: ArtifactKind) => state.artifacts.includes(kind)

  return (
    <Section
      id="study-loop"
      kicker="One session in. A study kit out."
      heading="Notes, practice problems, and flashcards from every session."
      sub="Built from the exact steps you worked through — closing the loop back into your next session."
    >
      <div ref={ref} className="flex flex-col gap-6">
        <Reveal>
          <SessionCard />
        </Reveal>

        <div className="grid gap-6 sm:grid-cols-3">
          <ArtifactCard visible={has('notes')} reducedMotion={reducedMotion} icon={NotebookText} title="Study notes">
            <ol className="m-0 list-decimal space-y-1.5 pl-4 text-sm text-muted-foreground">
              {NOTES_STEPS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </ArtifactCard>

          <ArtifactCard
            visible={has('problems')}
            reducedMotion={reducedMotion}
            icon={ListChecks}
            title="Practice problems"
          >
            <ol className="m-0 list-decimal space-y-1.5 pl-4 text-sm text-muted-foreground">
              {PRACTICE_PROBLEMS.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ol>
          </ArtifactCard>

          <ArtifactCard visible={has('flashcards')} reducedMotion={reducedMotion} icon={SquareStack} title="Flashcards">
            <Flashcard front={FLASHCARD.front} back={FLASHCARD.back} reducedMotion={reducedMotion} />
          </ArtifactCard>
        </div>

        <Reveal delay={0.1}>
          <p className="m-0 text-center text-sm font-medium text-accent-emphasis">
            Session → profile update → study kit → your next session.
          </p>
        </Reveal>
      </div>
    </Section>
  )
}

function SessionCard() {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface px-5 py-4">
      <div>
        <p className="m-0 text-sm font-semibold text-foreground">{SESSION_SUMMARY.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{SESSION_SUMMARY.detail}</p>
      </div>
      <span aria-hidden="true" className="flex-none text-xl text-muted-foreground">
        ↓
      </span>
    </div>
  )
}

function ArtifactCard({
  visible,
  reducedMotion,
  icon: Icon,
  title,
  children,
}: {
  visible: boolean
  reducedMotion: boolean
  icon: LucideIcon
  title: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-border bg-surface p-5',
        !reducedMotion && 'transition-all duration-500 ease-out',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
      )}
    >
      <div className="flex items-center gap-2">
        <Icon aria-hidden="true" className="h-5 w-5 flex-none text-accent-emphasis" />
        <p className="m-0 text-sm font-semibold text-foreground">{title}</p>
      </div>
      {children}
    </div>
  )
}

// The one interactive element on the page outside the waitlist forms: a
// flip-on-hover-or-tap flashcard. group-hover drives the desktop hover flip;
// the click/keyboard toggle drives touch ("tap") and keyboard use, and
// persists after the pointer leaves.
function Flashcard({ front, back, reducedMotion }: { front: string; back: string; reducedMotion: boolean }) {
  const [flipped, setFlipped] = useState(false)

  const toggle = () => setFlipped((value) => !value)

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={flipped}
      aria-label={flipped ? `Flashcard answer: ${back}` : `Flashcard question: ${front}`}
      onClick={toggle}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          toggle()
        }
      }}
      className="group relative h-32 w-full cursor-pointer [perspective:1000px]"
    >
      <div
        className={cn(
          'relative h-full w-full [transform-style:preserve-3d] group-hover:[transform:rotateY(180deg)]',
          !reducedMotion && 'transition-transform duration-500',
          flipped && '[transform:rotateY(180deg)]'
        )}
      >
        <div className="absolute inset-0 flex items-center justify-center rounded-md border border-border bg-background p-4 text-center text-sm text-foreground [backface-visibility:hidden]">
          {front}
        </div>
        <div className="absolute inset-0 flex items-center justify-center rounded-md border border-border bg-background p-4 text-center text-sm font-medium text-accent-emphasis [backface-visibility:hidden] [transform:rotateY(180deg)]">
          {back}
        </div>
      </div>
    </div>
  )
}
