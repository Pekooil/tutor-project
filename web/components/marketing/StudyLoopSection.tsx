'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useInView, useReducedMotion } from 'motion/react'
import { ListChecks, NotebookText, SquareStack, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Section } from '@/components/marketing/Section'
import { Reveal } from '@/components/marketing/Reveal'
import { reduceScene, type ArtifactKind } from '@/components/marketing/demo/scene'
import { studyLoopAlt, studyLoopScene } from '@/components/marketing/demo/scripts'

// Sprint 25 Task 9 (originally Sprint 20 Task 8): the study loop, REFRAMED
// as roadmap (ADR-040 decision 5, reversing ADR-031 §4's marketed-as-live
// call). Generation is deferred post-beta, so the copy says it's on the way
// — and never promises the beta. The section now chains visually off the
// recap card's "Generated for you" placeholder slot (RecapCard.tsx's
// reserved tiles, recreated above the fan-out): the page and the product
// tell the same story about the same empty seat. The same factoring session
// (x² + 5x + 6 = 0) still fans out into the three artifact cards, timed by
// studyLoopScene (scripts.ts — the artifact vocabulary survived the Sprint
// 25 cut).
//
// Like ProfileSection, this hand-rolls a local one-shot driver instead of
// useSceneTimeline: the gate wants the fan-out to play ONCE on first
// in-view, not loop (the hero) or scrub (the showcase). reduceScene — the
// shared pure reducer — still turns that local clock into state.

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
      kicker="The study loop · on the way"
      heading="Every session will leave a study kit behind."
      sub="Notes, practice problems, and flashcards, generated from the exact steps you worked through — on the way, with its seat already saved in the recap card."
    >
      <div ref={ref} className="flex flex-col">
        <Reveal>
          <RecapSlotCard />
        </Reveal>

        <div aria-hidden="true" className="mkt-connector my-2" />

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
          <p className="mt-10 mb-0 text-center text-sm font-medium text-accent-emphasis">
            Session → recap card → study kit → your next session. That&apos;s the loop this slot is waiting for.
          </p>
        </Reveal>
      </div>
    </Section>
  )
}

// The recap card's "Generated for you" slot (RecapCard.tsx's reserved
// placeholder tiles, mirrored from DemoPanel's RecapBody) — the visual
// anchor the fan-out chains off: these dashed tiles are what the cards
// below will one day fill. Decorative recreation, aria-hidden with the
// drafted alt; the .cx-demo-placeholder styling is the same DemoStage
// mirror ProfileSection carries (the --calyxa-placeholder-* tokens are
// reachable by name via the @calyxa/ui theme import).
function RecapSlotCard() {
  return (
    <div className="mkt-card mx-auto w-full max-w-2xl px-6 py-5">
      <p className="sr-only">{studyLoopAlt}</p>
      <div aria-hidden="true">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
            Generated for you
          </span>
          <span className="text-xs text-muted-foreground">the reserved slot on every session&apos;s recap card</span>
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <span className="cx-demo-placeholder flex h-[52px] items-center justify-center rounded-[10px] px-1.5 text-center font-mono text-[10px]">
            study material
          </span>
          <span className="cx-demo-placeholder flex h-[52px] items-center justify-center rounded-[10px] px-1.5 text-center font-mono text-[10px]">
            study material
          </span>
        </div>
      </div>
      <style>{`
        .cx-demo-placeholder {
          border: 1px dashed var(--calyxa-placeholder-border);
          background: repeating-linear-gradient(
            135deg,
            var(--calyxa-placeholder-stripe-a),
            var(--calyxa-placeholder-stripe-a) 6px,
            var(--calyxa-placeholder-stripe-b) 6px,
            var(--calyxa-placeholder-stripe-b) 12px
          );
          color: var(--calyxa-placeholder-text);
        }
      `}</style>
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
        'mkt-card flex flex-col gap-3 p-5',
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
        <div className="absolute inset-0 flex items-center justify-center rounded-md border border-(--mkt-border-faint) bg-surface p-4 text-center text-sm text-foreground [backface-visibility:hidden]">
          {front}
        </div>
        <div className="absolute inset-0 flex items-center justify-center rounded-md border border-(--mkt-border-faint) bg-surface p-4 text-center text-sm font-medium text-accent-emphasis [backface-visibility:hidden] [transform:rotateY(180deg)]">
          {back}
        </div>
      </div>
    </div>
  )
}
