'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { CalyxaMark } from '@calyxa/ui'
import { cn } from '@/lib/utils'
import {
  AmbientPill,
  AnnotLabel,
  CaptionSurface,
  PillGlow,
  TermMark,
  TranscriptSurface,
  type PillState,
} from '@/components/marketing/pill/overlay'

// The hero's one interactive beat (Landing v3): a browser-frame card with a
// fake problem sheet and the ambient pill resting bottom-center. Click the
// pill and ONE exchange plays — listen (student line streams) → think
// (900ms) → speak (tutor caption streams while two annotations draw on the
// equation) → done (pill back to idle, caption + marks hold, replay chip).
// The job is "whoa", not a full session — the full session plays in the
// scrollytelling below (the replay chip says exactly that).
//
// Scripted animation, not the live voice stack (same spirit as the old
// DemoStage clock). prefers-reduced-motion renders the `done` frame
// statically. The card is decorative apart from the two play controls,
// which are real buttons with sr labels; the email capture lives in the
// hero's left column and is never covered.

type Phase = 'rest' | 'listen' | 'think' | 'speak' | 'done'

const STUDENT_LINE = 'wait — do I just guess the two numbers?'
const TUTOR_LINE =
  'no guessing — you need a pair that multiplies to six and adds to negative five. what does the plus six tell you about the signs?'

const DEMO_ALT =
  'Interactive demo: a math practice page with the Calyxa pill resting at the bottom. Activating it plays one exchange — you ask "do I just guess the two numbers?", the tutor answers aloud in coaching mode while it circles the −5x and 6 terms of x² − 5x + 6 = 0 with "Adds to −5" and "Multiplies to +6" labels.'

const PILL_BY_PHASE: Record<Phase, PillState> = {
  rest: 'idle',
  listen: 'listening',
  think: 'thinking',
  speak: 'speaking',
  done: 'idle',
}

const GLOW_BY_PHASE: Record<Phase, number> = {
  rest: 0.42,
  listen: 0.8,
  think: 0.62,
  speak: 0.8,
  done: 0.42,
}

/** Word-by-word streaming: 70ms + 0–50ms jitter per word, 450ms end hold. */
function useDemoMachine() {
  const [phase, setPhase] = useState<Phase>('rest')
  const [studentText, setStudentText] = useState('')
  const [tutorText, setTutorText] = useState('')
  const [studentDone, setStudentDone] = useState(false)
  const [tutorDone, setTutorDone] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const clear = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }, [])

  useEffect(() => clear, [clear])

  const after = useCallback((ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms))
  }, [])

  const stream = useCallback(
    (text: string, setText: (t: string) => void, setDone: (d: boolean) => void, onDone: () => void) => {
      const words = text.split(' ')
      setText('')
      setDone(false)
      let i = 0
      const step = () => {
        i += 1
        setText(words.slice(0, i).join(' '))
        if (i < words.length) after(70 + Math.random() * 50, step)
        else {
          setDone(true)
          after(450, onDone)
        }
      }
      after(70, step)
    },
    [after]
  )

  const play = useCallback(() => {
    clear()
    setStudentText('')
    setTutorText('')
    setStudentDone(false)
    setTutorDone(false)
    setPhase('listen')
    after(500, () => {
      stream(STUDENT_LINE, setStudentText, setStudentDone, () => {
        setPhase('think')
        after(900, () => {
          setPhase('speak')
          stream(TUTOR_LINE, setTutorText, setTutorDone, () => {
            after(900, () => setPhase('done'))
          })
        })
      })
    })
  }, [after, clear, stream])

  return { phase, studentText, tutorText, studentDone, tutorDone, play }
}

export function HeroDemo() {
  const reduceMotion = useReducedMotion() ?? false
  const machine = useDemoMachine()

  // Reduced motion: the fixed `done` frame — caption + marks composed, no
  // playback, no play controls (there is nothing they could animate).
  const phase = reduceMotion ? 'done' : machine.phase
  const tutorText = reduceMotion ? TUTOR_LINE : machine.tutorText
  const marksOn = phase === 'speak' || phase === 'done'

  return (
    <div className="relative h-[560px] overflow-hidden border border-(--mkt-hairline) bg-background shadow-[0_24px_60px_-18px_rgba(20,40,30,0.22)] max-lg:rounded-2xl lg:h-[640px] lg:rounded-none lg:rounded-tl-2xl lg:border-b-0 lg:border-r-0">
      <p className="sr-only">{DEMO_ALT}</p>

      {/* Browser chrome */}
      <div aria-hidden="true" className="flex items-center gap-3 border-b border-(--mkt-hairline) bg-surface px-[22px] py-3">
        <span className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-2.5 w-2.5 rounded-full" style={{ background: '#e3e1dc' }} />
          ))}
        </span>
        <span className="flex max-w-[300px] flex-1 items-center rounded-full border border-(--mkt-hairline-soft) bg-background px-[13px] py-1 text-[11.5px] text-(--mkt-faint)">
          mathpath.example/unit-4
        </span>
        <span className="ml-auto flex items-center gap-1.5 rounded-full border border-(--calyxa-sage-border) bg-accent-subtle px-2.5 py-1 text-[11px] font-semibold text-accent-emphasis">
          <CalyxaMark className="h-[13px] w-[13px]" />
          On
        </span>
      </div>

      {/* The fake problem sheet */}
      <div aria-hidden="true" className="px-9 py-[30px]">
        <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-(--mkt-faint)">
          Problem 2 · solve by factoring
        </p>
        <div className="ml-5 mt-[70px]">
          <span className="relative inline-block whitespace-nowrap text-[30px] font-medium tracking-[0.02em] text-foreground">
            x²{' '}
            {marksOn ? (
              <TermMark tone="amber" animate={!reduceMotion} drawDelay={0.2} fillDelay={0.5}>
                − 5x
                <AnnotLabel tone="amber" side="above" offset={46} animate={!reduceMotion} delay={0.7}>
                  Adds to −5
                </AnnotLabel>
              </TermMark>
            ) : (
              <span>− 5x</span>
            )}{' '}
            +{' '}
            {marksOn ? (
              <TermMark tone="green" pad={11} animate={!reduceMotion} drawDelay={1} fillDelay={1.3}>
                6
                <AnnotLabel tone="green" side="below" offset={44} animate={!reduceMotion} delay={1.5}>
                  Multiplies to +6
                </AnnotLabel>
              </TermMark>
            ) : (
              <span>6</span>
            )}{' '}
            = 0
          </span>
        </div>
      </div>

      {/* The ambient overlay: surfaces stack above the pill, one at a time. */}
      <div className="absolute inset-x-0 bottom-[26px] flex flex-col items-center gap-[13px]">
        {phase === 'listen' && (
          <div aria-hidden="true">
            <TranscriptSurface text={machine.studentText} live={!machine.studentDone} />
          </div>
        )}
        {(phase === 'speak' || phase === 'done') && (
          <div aria-hidden="true">
            <CaptionSurface mode="coach" live={phase === 'speak' && !machine.tutorDone}>
              {tutorText}
            </CaptionSurface>
          </div>
        )}

        <button
          type="button"
          onClick={reduceMotion ? undefined : machine.play}
          disabled={reduceMotion || phase === 'listen' || phase === 'think' || phase === 'speak'}
          aria-label="Play the demo — hear one tutor reply"
          className={cn(
            'relative -m-2 cursor-pointer border-0 bg-transparent p-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--color-focus-ring)',
            (reduceMotion || (phase !== 'rest' && phase !== 'done')) && 'cursor-default'
          )}
        >
          <PillGlow opacity={GLOW_BY_PHASE[phase]} />
          <AmbientPill state={PILL_BY_PHASE[phase]} mode="coach" />
        </button>

        {!reduceMotion && (phase === 'rest' || phase === 'done') && (
          <button
            type="button"
            onClick={machine.play}
            className="mkt-fade-up flex cursor-pointer items-center gap-[7px] rounded-full border border-(--mkt-hairline) bg-background/85 px-3.5 py-[7px] text-[12.5px] font-medium text-(--calyxa-chip-text) shadow-[0_4px_14px_rgba(28,40,30,0.08)] transition-colors hover:bg-accent-subtle hover:text-accent-fill-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-focus-ring)"
          >
            {phase === 'rest' ? (
              <>
                <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-accent-glow-strong" />
                click the pill — hear one reply
              </>
            ) : (
              <>↺ replay — the full session plays below</>
            )}
          </button>
        )}
      </div>
    </div>
  )
}
