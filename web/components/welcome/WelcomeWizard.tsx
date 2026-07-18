'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useReducedMotion } from 'motion/react'
import { CalyxaMark } from '@calyxa/ui'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  AmbientPill,
  AnnotLabel,
  CaptionSurface,
  ConceptSurface,
  PillGlow,
  TermMark,
  ThinkDots,
  TranscriptSurface,
  type PillState,
} from '@/components/marketing/pill/overlay'

// The /welcome setup wizard (2026-07-17 redesign): ONE step on screen at a
// time, each advancing only when the student completes it — replacing the
// original all-four-steps-in-a-list page. There is no "create your account"
// step here at all: the server page redirects signed-out visitors to
// /signup, so everyone who sees this is already signed in.
//
//   Step 1 — Add Calyxa to Chrome (the store link, or the graceful
//            not-listed-yet state).
//   Step 2 — Find it in the toolbar: a bouncing arrow pinned to the TOP
//            RIGHT of the viewport points at Chrome's own extension area
//            while the card walks through pin + sign-in.
//   Step 3 — A guided LIVE demo, not instructions: the marketing pill
//            primitives replay the extension's real first-session loop and
//            the student drives every beat themselves (click the pill →
//            tap the viewfinder → ask by mic) with a "try it" coach line
//            telling them exactly what to click next. Mirrors the
//            extension's own in-overlay Tutorial, so the first real session
//            feels familiar.
//
// The demo is scripted presentation (the HeroDemo streaming pattern), not
// the live voice stack. prefers-reduced-motion completes each beat
// instantly on click instead of streaming.

const STUDENT_LINE = 'wait — do I just guess the two numbers?'
const TUTOR_LINE =
  'no guessing — you need a pair that multiplies to six and adds to negative five. what does the plus six tell you about the signs?'

const TOTAL_STEPS = 3

type DemoStage = 'pill' | 'row' | 'scanning' | 'concept' | 'listen' | 'think' | 'speak' | 'done'

const PILL_BY_STAGE: Record<DemoStage, PillState> = {
  pill: 'idle',
  row: 'idle', // the row replaces the pill while it shows
  scanning: 'thinking',
  concept: 'idle',
  listen: 'listening',
  think: 'thinking',
  speak: 'speaking',
  done: 'idle',
}

const GLOW_BY_STAGE: Record<DemoStage, number> = {
  pill: 0.5,
  row: 0.6,
  scanning: 0.62,
  concept: 0.5,
  listen: 0.8,
  think: 0.62,
  speak: 0.8,
  done: 0.42,
}

const COACH_BY_STAGE: Record<DemoStage, string> = {
  pill: 'See the little pill at the bottom of the page? That’s your tutor. Click it to wake it up.',
  row: 'It opened its toolbar. Tap the viewfinder — that’s how Calyxa reads the problem on your page.',
  scanning: 'Calyxa is reading the page…',
  concept: 'It found the problem and checks in before starting — nothing is scanned until you ask. Now click the mic and ask your question out loud.',
  listen: 'It’s listening — this is you, thinking out loud.',
  think: 'It heard you. Thinking…',
  speak: 'It answers out loud and draws on the problem itself — a nudge toward the next step, never the answer.',
  done: 'That’s the whole loop: scan, talk it through, learn. The real pill works exactly like this on any page you open.',
}

// ── Small inline icons (the extension hover row's vocabulary) ─────────────

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-4 w-4" aria-hidden="true">
      <path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z" />
      <path d="M6 11a6 6 0 0 0 12 0" />
      <path d="M12 17v3" />
    </svg>
  )
}

function ViewfinderIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-4 w-4" aria-hidden="true">
      <path d="M4 9V6a2 2 0 0 1 2-2h3" />
      <path d="M15 4h3a2 2 0 0 1 2 2v3" />
      <path d="M20 15v3a2 2 0 0 1-2 2h-3" />
      <path d="M9 20H6a2 2 0 0 1-2-2v-3" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-4 w-4" aria-hidden="true">
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.6V12l2.8 1.7" />
    </svg>
  )
}

/** One button on the demo's simulated hover row. Only the step the coach is
 * pointing at is enabled; everything else renders muted, exactly so the
 * student's eye lands on the one live control. */
function RowButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active: boolean
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={!active}
      onClick={onClick}
      className={cn(
        'flex h-9 w-9 items-center justify-center rounded-full border transition-colors',
        active
          ? 'wlc-pulse cursor-pointer border-(--calyxa-sage-border) bg-accent-subtle text-accent-emphasis hover:bg-accent-subtle/80'
          : 'cursor-default border-transparent bg-transparent text-muted-foreground opacity-45'
      )}
    >
      {children}
    </button>
  )
}

// ── The guided demo (step 3) ──────────────────────────────────────────────

function useDemoMachine(reduceMotion: boolean) {
  const [stage, setStage] = useState<DemoStage>('pill')
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
      if (reduceMotion) {
        setText(text)
        setDone(true)
        onDone()
        return
      }
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
          after(500, onDone)
        }
      }
      after(70, step)
    },
    [after, reduceMotion]
  )

  /** The student clicked the idle pill. */
  const wake = useCallback(() => {
    if (stage !== 'pill') return
    setStage('row')
  }, [stage])

  /** The student tapped the viewfinder. */
  const scan = useCallback(() => {
    if (stage !== 'row') return
    setStage('scanning')
    after(reduceMotion ? 0 : 1500, () => setStage('concept'))
  }, [after, reduceMotion, stage])

  /** The student clicked the mic — play the full exchange. */
  const ask = useCallback(() => {
    if (stage !== 'concept') return
    setStage('listen')
    after(reduceMotion ? 0 : 400, () => {
      stream(STUDENT_LINE, setStudentText, setStudentDone, () => {
        setStage('think')
        after(reduceMotion ? 0 : 900, () => {
          setStage('speak')
          stream(TUTOR_LINE, setTutorText, setTutorDone, () => {
            after(reduceMotion ? 0 : 900, () => setStage('done'))
          })
        })
      })
    })
  }, [after, reduceMotion, stage, stream])

  return { stage, studentText, tutorText, studentDone, tutorDone, wake, scan, ask }
}

function DemoCard({ machine }: { machine: ReturnType<typeof useDemoMachine> }) {
  const { stage } = machine
  const marksOn = stage === 'speak' || stage === 'done'
  const rowOn = stage === 'row' || stage === 'concept'

  return (
    <div className="relative h-[460px] overflow-hidden rounded-2xl border border-(--mkt-hairline) bg-background shadow-[0_24px_60px_-18px_rgba(20,40,30,0.22)]">
      <p className="sr-only">
        A simulated homework page used as a hands-on demo. Follow the “try it” instruction under the
        card: click the pill, tap the viewfinder to scan, then click the mic to hear the tutor answer
        while it draws on the equation.
      </p>

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
      <div aria-hidden="true" className="px-9 py-[26px]">
        <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-(--mkt-faint)">
          Problem 2 · solve by factoring
        </p>
        <div className="ml-5 mt-[62px]">
          <span className="relative inline-block whitespace-nowrap text-[28px] font-medium tracking-[0.02em] text-foreground">
            x²{' '}
            {marksOn ? (
              <TermMark tone="amber" animate drawDelay={0.2} fillDelay={0.5}>
                − 5x
                <AnnotLabel tone="amber" side="above" offset={44} animate delay={0.7}>
                  Adds to −5
                </AnnotLabel>
              </TermMark>
            ) : (
              <span>− 5x</span>
            )}{' '}
            +{' '}
            {marksOn ? (
              <TermMark tone="green" pad={11} animate drawDelay={1} fillDelay={1.3}>
                6
                <AnnotLabel tone="green" side="below" offset={42} animate delay={1.5}>
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

      {/* The ambient overlay: one transient surface above the pill/row. */}
      <div className="absolute inset-x-0 bottom-[22px] flex flex-col items-center gap-[13px]">
        {stage === 'scanning' && (
          <div aria-hidden="true" className="mkt-glass mkt-surface-pop flex items-center gap-2.5 rounded-full px-4 py-2.5">
            <ThinkDots />
            <span className="text-[12.5px] font-medium text-muted-foreground">Reading your page…</span>
          </div>
        )}
        {stage === 'concept' && (
          <div aria-hidden="true">
            <ConceptSurface title="Factoring quadratic trinomials">
              Found on this page — problem 2. Your tutor checks in on where you are before it starts.
            </ConceptSurface>
          </div>
        )}
        {stage === 'listen' && (
          <div aria-hidden="true">
            <TranscriptSurface text={machine.studentText} live={!machine.studentDone} />
          </div>
        )}
        {(stage === 'speak' || stage === 'done') && (
          <div aria-hidden="true">
            <CaptionSurface mode="coach" live={stage === 'speak' && !machine.tutorDone}>
              {machine.tutorText}
            </CaptionSurface>
          </div>
        )}

        {rowOn ? (
          // The simulated hover row: the pill, expanded. One control live at
          // a time (viewfinder first, then mic), the rest muted.
          <div className="mkt-glass mkt-surface-pop flex items-center gap-1.5 rounded-full px-3 py-1.5">
            <CalyxaMark aria-hidden="true" className="h-[19px] w-[19px] flex-none" />
            <span aria-hidden="true" className="mx-1 h-5 w-px flex-none bg-(--mkt-hairline)" />
            <RowButton label="Ask by voice" active={stage === 'concept'} onClick={machine.ask}>
              <MicIcon />
            </RowButton>
            <RowButton label="Type instead" active={false}>
              <span className="text-[13px] font-semibold tracking-[-0.02em]">Aa</span>
            </RowButton>
            <RowButton label="Scan the page" active={stage === 'row'} onClick={machine.scan}>
              <ViewfinderIcon />
            </RowButton>
            <RowButton label="Last exchange" active={false}>
              <ClockIcon />
            </RowButton>
          </div>
        ) : (
          <button
            type="button"
            onClick={machine.wake}
            disabled={stage !== 'pill'}
            aria-label="The Calyxa pill — click to wake your tutor"
            className={cn(
              'relative -m-2 border-0 bg-transparent p-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--color-focus-ring)',
              stage === 'pill' ? 'wlc-pulse cursor-pointer rounded-full' : 'cursor-default'
            )}
          >
            <PillGlow opacity={GLOW_BY_STAGE[stage]} />
            <AmbientPill state={PILL_BY_STAGE[stage]} mode="coach" />
          </button>
        )}
      </div>
    </div>
  )
}

// ── The wizard shell ──────────────────────────────────────────────────────

export function WelcomeWizard({
  email,
  storeUrl,
  initialStep,
}: {
  email: string | null
  storeUrl: string | null
  initialStep: 1 | 2 | 3
}) {
  const [step, setStep] = useState<number>(initialStep)
  const reduceMotion = useReducedMotion() ?? false
  const machine = useDemoMachine(reduceMotion)

  const titles: Record<number, string> = {
    1: 'Add Calyxa to Chrome',
    2: 'Find it in your toolbar',
    3: 'Try it — a live demo',
  }

  return (
    <main className="mkt min-h-svh bg-background px-4 py-10">
      {/* Component-local keyframes: the toolbar arrow's diagonal bob and the
          soft pulse ring on the demo's one live control. */}
      <style>{`
        @keyframes wlc-bob { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(9px, -9px); } }
        .wlc-bob { animation: wlc-bob 1.1s ease-in-out infinite; }
        @keyframes wlc-pulse {
          0% { box-shadow: 0 0 0 0 rgba(134, 239, 172, 0.55); }
          70% { box-shadow: 0 0 0 11px rgba(134, 239, 172, 0); }
          100% { box-shadow: 0 0 0 0 rgba(134, 239, 172, 0); }
        }
        .wlc-pulse { animation: wlc-pulse 1.7s ease-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .wlc-bob, .wlc-pulse { animation: none; }
        }
      `}</style>

      {/* Step 2's pointer at the browser's own top-right extension area.
          Fixed to the viewport, not the card — it points at Chrome, not at
          anything on this page. */}
      {step === 2 && (
        <div aria-hidden="true" className="pointer-events-none fixed right-8 top-3 z-50 flex flex-col items-end gap-2.5">
          <svg className="wlc-bob" width="58" height="58" viewBox="0 0 58 58" fill="none">
            <path
              d="M10 48 C 22 40, 34 28, 44 16"
              stroke="var(--color-accent-emphasis)"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <path
              d="M44 16 L 32.5 17.5 M44 16 L 42.5 27.5"
              stroke="var(--color-accent-emphasis)"
              strokeWidth="4"
              strokeLinecap="round"
            />
          </svg>
          <span className="rounded-full border border-(--calyxa-sage-border) bg-background px-3.5 py-1.5 text-[12.5px] font-semibold text-accent-emphasis shadow-[0_4px_14px_rgba(28,40,30,0.12)]">
            your extensions live up here
          </span>
        </div>
      )}

      <div className="mx-auto flex w-full max-w-[620px] flex-col gap-7">
        {/* Header: logo + step progress */}
        <div className="flex flex-col items-center gap-4 text-center">
          <Link href="/">
            <img src="/logo.svg" alt="Calyxa" className="h-7 w-auto" />
          </Link>
          <div className="flex w-full max-w-[300px] flex-col gap-2">
            <span className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Step {step} of {TOTAL_STEPS}
            </span>
            <div aria-hidden="true" className="flex gap-1.5">
              {Array.from({ length: TOTAL_STEPS }, (_, i) => (
                <span
                  key={i}
                  className={cn(
                    'h-1 flex-1 rounded-full',
                    i + 1 < step
                      ? 'bg-(--color-accent-fill)'
                      : i + 1 === step
                        ? 'bg-(--color-accent-fill) opacity-50'
                        : 'bg-(--mkt-hairline)'
                  )}
                />
              ))}
            </div>
          </div>
          <h1 className="m-0 text-[26px] font-semibold tracking-[-0.01em] text-foreground">{titles[step]}</h1>
        </div>

        {/* ── Step 1 — install ── */}
        {step === 1 && (
          <section className="flex flex-col items-center gap-6 rounded-2xl border border-(--mkt-hairline) bg-card p-8 text-center">
            <p className="m-0 max-w-[44ch] text-[15px] leading-relaxed text-muted-foreground">
              The extension is where your tutor lives — right on your homework page. Add it from the
              Chrome Web Store, then come back to this tab.
            </p>
            {storeUrl ? (
              <Button asChild size="lg">
                <a href={storeUrl} target="_blank" rel="noreferrer">
                  Add Calyxa to Chrome ↗
                </a>
              </Button>
            ) : (
              <p className="m-0 max-w-[42ch] rounded-xl border border-(--calyxa-sage-border) bg-accent-subtle px-4 py-3 text-[13.5px] leading-relaxed text-accent-emphasis">
                Calyxa is landing on the Chrome Web Store right now — check back shortly for the
                install link. Already have it installed? Carry on.
              </p>
            )}
            <Button variant="outline" onClick={() => setStep(2)}>
              I’ve added it — next →
            </Button>
          </section>
        )}

        {/* ── Step 2 — find it up there ── */}
        {step === 2 && (
          <section className="flex flex-col gap-6 rounded-2xl border border-(--mkt-hairline) bg-card p-8">
            <p className="m-0 text-[15px] leading-relaxed text-muted-foreground">
              Chrome tucks new extensions into the <span className="font-medium text-foreground">top-right corner</span> of
              your window — follow the arrow.
            </p>
            <ol className="m-0 flex list-none flex-col gap-4 p-0">
              {[
                <>Click the puzzle-piece icon <span aria-hidden="true">🧩</span> up there.</>,
                <>Hit the pin next to <span className="font-medium text-foreground">Calyxa</span> so it stays visible.</>,
                <>
                  Click the Calyxa leaf and sign in with{' '}
                  <span className="font-medium text-foreground">{email ?? 'the email you signed up with'}</span>.
                </>,
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-[14.5px] leading-relaxed text-muted-foreground">
                  <span className="mt-px flex h-6 w-6 flex-none items-center justify-center rounded-full border border-(--calyxa-sage-border) bg-accent-subtle text-[12px] font-semibold text-accent-emphasis">
                    {i + 1}
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ol>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="cursor-pointer border-0 bg-transparent p-0 text-[13px] font-medium text-muted-foreground hover:underline"
              >
                ← Back
              </button>
              <Button onClick={() => setStep(3)}>I’m signed in — next →</Button>
            </div>
          </section>
        )}

        {/* ── Step 3 — the guided live demo ── */}
        {step === 3 && (
          <section className="flex flex-col gap-4">
            <DemoCard machine={machine} />

            {/* The coach line: tells the student exactly what to do next. */}
            <div
              aria-live="polite"
              className="mx-auto flex w-full max-w-[540px] items-start gap-2.5 rounded-2xl border border-(--calyxa-sage-border) bg-accent-subtle px-4 py-3"
            >
              <span className="mt-px text-[13px]" aria-hidden="true">
                {machine.stage === 'done' ? '✓' : '✧'}
              </span>
              <p className="m-0 text-left text-[13.5px] font-medium leading-relaxed text-accent-emphasis">
                <span className="mr-1.5 text-[10px] font-bold uppercase tracking-[0.1em]">
                  {machine.stage === 'done' ? 'Done' : 'Try it'}
                </span>
                {COACH_BY_STAGE[machine.stage]}
              </p>
            </div>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="cursor-pointer border-0 bg-transparent p-0 text-[13px] font-medium text-muted-foreground hover:underline"
              >
                ← Back
              </button>
              {machine.stage === 'done' ? (
                <Button asChild size="lg">
                  <Link href="/dashboard">Head to your dashboard →</Link>
                </Button>
              ) : (
                <Link
                  href="/dashboard"
                  className="text-[13px] font-medium text-muted-foreground underline-offset-4 hover:underline"
                >
                  Skip the demo
                </Link>
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
