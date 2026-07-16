'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useInView, useReducedMotion } from 'motion/react'
import { ListChecks, NotebookText, SquareStack, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Section } from '@/components/marketing/Section'
import { Reveal } from '@/components/marketing/Reveal'
import { reduceScene, type ArtifactKind } from '@/components/marketing/demo/scene'
import { studyLoopScene } from '@/components/marketing/demo/scripts'

// Landing v3: the study kit is LIVE (ADR-049 shipped — web/lib/study/,
// study_artifact, /kits, POST /api/study/generate), so this section drops
// ADR-040's "on the way" qualifier — the copy change ADR-049 flagged for
// this track. The dashed placeholder anchor becomes a FILLED recap anchor
// carrying the generate action ("make my study kit" — generation is
// on-demand per ADR-049 decision 4, never "automatically"), and the
// practice-problems card now shows the worked solutions behind a toggle
// (the one deliberate superset). The once-in-view fan-out playback and the
// three-card ArtifactKind grid (notes | problems | flashcards — the visual
// contract shared with the shipped feature) survive unchanged.

const NOTES_STEPS = [
  'factor by finding two numbers that multiply to 6 and add to 5 → 2 and 3.',
  'rewrite: x² + 5x + 6 = (x + 2)(x + 3).',
  'set each factor to zero, minding the sign: x = −2, x = −3.',
]

const PRACTICE_PROBLEMS = [
  { problem: 'x² + 7x + 10 = 0', solution: '(x + 2)(x + 5) → x = −2, −5' },
  { problem: 'x² − 2x − 15 = 0', solution: '(x − 5)(x + 3) → x = 5, −3' },
]

const FLASHCARD = {
  front: 'what two numbers multiply to 6 and add to 5?',
  back: '2 and 3',
}

const STUDY_ALT =
  'The recap anchor — “generated for you · on every session’s recap card”, with a “make my study kit” action — fanning out into three artifact cards: study notes, practice problems with revealable solutions, and a flip flashcard.'

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
      align="center"
      kicker="the study loop"
      heading="every session leaves a study kit behind."
      sub="finish a session, tap once, and calyxa turns the exact steps you worked through into notes, practice problems, and flashcards. they live in your dashboard, ready before the test."
    >
      <div ref={ref} className="mx-auto flex w-full max-w-[1020px] flex-col items-center">
        <p className="sr-only">{STUDY_ALT}</p>
        <Reveal className="w-full max-w-[640px]">
          <RecapAnchor />
        </Reveal>

        <div aria-hidden="true" className="mkt-connector" />

        <div className="grid w-full gap-5 text-left sm:grid-cols-3">
          <ArtifactCard visible={has('notes')} reducedMotion={reducedMotion} icon={NotebookText} title="study notes">
            <ol className="m-0 flex list-decimal flex-col gap-[7px] pl-[18px] text-[13.5px] leading-[1.55] text-(--calyxa-chip-text)">
              {NOTES_STEPS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <span className="mt-auto text-[11.5px] text-(--mkt-faint)">the method, in your session&apos;s own steps</span>
          </ArtifactCard>

          <ArtifactCard visible={has('problems')} reducedMotion={reducedMotion} icon={ListChecks} title="practice problems">
            <PracticeProblems />
          </ArtifactCard>

          <ArtifactCard visible={has('flashcards')} reducedMotion={reducedMotion} icon={SquareStack} title="flashcards">
            <Flashcard front={FLASHCARD.front} back={FLASHCARD.back} reducedMotion={reducedMotion} />
            <span className="mt-auto text-[11.5px] text-(--mkt-faint)">tap the card to flip it</span>
          </ArtifactCard>
        </div>

        <Reveal delay={0.1}>
          <p className="mb-0 mt-9 text-center text-[13.5px] font-medium text-accent-emphasis">
            session → recap card → study kit → your next session. that&apos;s the loop.
          </p>
        </Reveal>
      </div>
    </Section>
  )
}

// The FILLED recap anchor (was the dashed placeholder): the study kit's seat
// on every session's recap card, carrying the on-demand generate action.
// The chip is decorative (a recreation of the extension's button, not a
// control on this page) — styled span, nothing focusable.
function RecapAnchor() {
  return (
    <div
      aria-hidden="true"
      className="flex items-center gap-4 rounded-[14px] border border-(--mkt-hairline) bg-background px-[22px] py-[18px] max-sm:flex-col max-sm:items-start"
      style={{ boxShadow: '0 8px 26px -10px rgba(28, 40, 30, 0.14)' }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-[3px] text-left">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          generated for you · on every session&apos;s recap card
        </span>
        <span className="text-[14.5px] font-semibold tracking-[-0.005em] text-foreground">
          factoring quadratics · 18 min · 5 problems
        </span>
      </div>
      <span className="inline-flex items-center gap-[7px] whitespace-nowrap rounded-[9px] bg-accent-fill px-4 py-2.5 text-[13px] font-semibold text-accent-fill-foreground">
        ✦ make my study kit
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
        'flex flex-col gap-3.5 rounded-[14px] border border-(--mkt-hairline-soft) bg-(--calyxa-board-bg) px-6 py-[22px]',
        !reducedMotion && 'transition-all duration-500 ease-out',
        visible ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
      )}
    >
      <div className="flex items-center gap-[9px]">
        <Icon aria-hidden="true" className="h-[18px] w-[18px] flex-none text-accent-emphasis" strokeWidth={1.8} />
        <p className="m-0 text-sm font-semibold text-foreground">{title}</p>
      </div>
      {children}
    </div>
  )
}

// The worked solutions (ADR-049's deliberate superset), behind a toggle —
// the page's own "show solutions" moment, mirroring the shipped kit viewer.
function PracticeProblems() {
  const [show, setShow] = useState(false)

  return (
    <>
      <ol className="m-0 flex list-decimal flex-col gap-2.5 pl-[18px] text-[13.5px] leading-[1.55] text-(--calyxa-chip-text)">
        {PRACTICE_PROBLEMS.map(({ problem, solution }, index) => (
          <li key={problem}>
            {problem}
            {show && (
              <span
                className="mkt-rise mt-[3px] block text-[12.5px] font-medium text-accent-emphasis"
                style={{ '--mkt-rise-delay': `${index * 0.08}s` } as React.CSSProperties}
              >
                {solution}
              </span>
            )}
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={() => setShow((value) => !value)}
        aria-expanded={show}
        className="mt-auto self-start rounded-full border border-(--calyxa-sage-border) bg-accent-subtle px-3 py-[5px] text-[11.5px] font-semibold text-accent-emphasis transition-colors hover:bg-(--color-accent-glow) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-focus-ring)"
      >
        {show ? 'hide solutions' : 'show solutions'}
      </button>
    </>
  )
}

// The flip-on-tap flashcard — kept from the previous section (hover flips on
// desktop; click/keyboard toggles and persists; sage back face per v3).
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
      className="group relative h-[122px] w-full cursor-pointer [perspective:1000px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-focus-ring)"
    >
      <div
        className={cn(
          'relative h-full w-full [transform-style:preserve-3d] group-hover:[transform:rotateY(180deg)]',
          !reducedMotion && 'transition-transform duration-500',
          flipped && '[transform:rotateY(180deg)]'
        )}
      >
        <div className="absolute inset-0 flex items-center justify-center rounded-[10px] border border-(--mkt-hairline-soft) bg-background p-4 text-center text-[13.5px] leading-[1.5] text-foreground [backface-visibility:hidden]">
          {front}
        </div>
        <div className="absolute inset-0 flex items-center justify-center rounded-[10px] border border-(--calyxa-sage-border) bg-accent-subtle p-4 text-center text-[15px] font-semibold text-accent-emphasis [backface-visibility:hidden] [transform:rotateY(180deg)]">
          {back}
        </div>
      </div>
    </div>
  )
}
