'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { useReducedMotion } from 'motion/react'
import { CalyxaMark } from '@calyxa/ui'
import { EchoChip, PILL_MODES, WaveBars, type PillMode } from '@/components/marketing/pill/overlay'

// Landing v7 §5 — reframed from the handoff's "It asks. You answer."
//
// Why the reframe (Darcy, 2026-07-29). In the learning lane, "never the worked
// solution" WAS the pitch. In the speed lane it reads as a limitation, and the
// handoff both demotes it to a sub-line and deletes the FAQ item that used to
// address it — which leaves the page's most obvious objection unanswered: if
// you're selling speed, why is the thing that won't just tell me the answer
// the fast option?
//
// So this section's job is to answer that, not to apologise for it. The
// argument: a worked solution makes you re-read seven steps you already had to
// find the one you didn't. Calyxa finds that step. That is WHY it's faster,
// and it puts the Socratic mechanic on the same side as the speed promise
// instead of in tension with it.
//
// Accurate to the shipped overlay, which has NO chat log (Transcript.tsx is
// retired): exactly one transient surface at a time above the morphing pill.
//
// Two behaviours that are easy to get wrong, both from the extension:
//  - the mode CARRIES FORWARD through the student's turns. deriveTutorMode
//    returns `current` for an unsignalled turn, so a session idles at its last
//    mode; it does not fall back to Explore.
//  - each mode wears its OWN tint from the --calyxa-mode-* triples, never
//    generic accent green.

const TURN_MS = 2900

type Turn = {
  who: 'voice' | 'text' | 'calyxa'
  /** Set only when the tutor signals a change; student turns inherit. */
  mode?: PillMode
  pre: string
  mark?: string
  post?: string
  stage: string
  clock: string
}

const TURNS: Turn[] = [
  { who: 'voice', pre: "I don't know where to start on this one", stage: 'Stage 1 of 3', clock: '0:46' },
  {
    who: 'calyxa',
    mode: 'coach',
    pre: 'Look at ',
    mark: 'these two',
    post: ' — what multiplies to −6 and adds to 5?',
    stage: 'Stage 1 of 3',
    clock: '1:02',
  },
  { who: 'text', pre: '6 and -1', stage: 'Stage 2 of 3', clock: '1:31' },
  {
    who: 'calyxa',
    mode: 'build',
    pre: "That's the pair. Split ",
    mark: '5x',
    post: ' with it — what do you get?',
    stage: 'Stage 2 of 3',
    clock: '1:38',
  },
  { who: 'voice', pre: '2x squared plus 6x minus x minus 3', stage: 'Stage 3 of 3', clock: '2:14' },
  {
    who: 'calyxa',
    mode: 'verify',
    pre: "Group it and it's yours. Back to the set.",
    stage: 'Stage 3 of 3',
    clock: '2:20',
  },
]

const modeVar = (mode: PillMode, part: 'text' | 'bg' | 'border') => `var(--calyxa-mode-${mode}-${part})`

export function SocraticSection() {
  const reduceMotion = useReducedMotion()
  const [index, setIndex] = useState(0)

  // One self-re-arming timer deriving the index from elapsed time, so a
  // throttled or dropped tick self-corrects instead of drifting.
  useEffect(() => {
    const t0 = Date.now()
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      if (!alive) return
      setIndex(Math.floor((Date.now() - t0) / TURN_MS) % TURNS.length)
      timer = setTimeout(tick, 200)
    }
    timer = setTimeout(tick, 200)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [])

  const turn = TURNS[index]

  // The mode carries forward: walk back to the last turn that signalled one.
  let mode: PillMode = 'explore'
  for (let i = 0; i <= index; i += 1) {
    const signalled = TURNS[i].mode
    if (signalled) mode = signalled
  }

  return (
    <section
      id="socratic"
      className="border-t border-(--mkt-hairline) bg-[#f7f7f5] px-[22px] py-14 sm:px-11 sm:pb-[110px] sm:pt-[100px]"
    >
      <div className="mx-auto flex max-w-[1240px] flex-col items-center">
        <h2
          className="mkt-display m-0 text-center font-bold text-foreground"
          style={{ fontSize: 'clamp(23px, 2.2vw, 34px)', lineHeight: 1.1, letterSpacing: '-0.025em' }}
        >
          It finds the one step you&apos;re missing.
        </h2>
        <p className="mb-0 mt-2.5 max-w-[54ch] text-pretty text-center text-[14.5px] text-muted-foreground sm:text-[16.5px]">
          A worked solution makes you read seven steps to find the one you didn&apos;t have. Calyxa goes straight to
          it — spoken or typed, one question at a time.
        </p>

        <div className="mt-8 w-full max-w-[560px] rounded-[18px] border border-(--mkt-border-faint) bg-(--mkt-desk) p-3 sm:mt-11 sm:rounded-[22px] sm:p-4">
          {/* The reference card: the equation being worked, off your page. */}
          <div className="flex items-center gap-2.5 rounded-[10px] border border-(--mkt-hairline) bg-background px-3 py-2 sm:px-3.5 sm:py-2.5">
            <span className="flex h-[21px] w-[21px] flex-none items-center justify-center rounded-md border border-accent-fill bg-accent-subtle text-[10px] font-semibold text-accent-emphasis">
              5
            </span>
            <span className="mkt-math text-[14px] text-foreground sm:text-[15.5px]">2x² + 5x − 3 = 0</span>
            <span aria-hidden="true" className="mx-1 hidden h-px flex-1 bg-(--mkt-hairline-soft) sm:block" />
            <span className="ml-auto text-[9.5px] text-(--mkt-faint) sm:ml-0 sm:text-[10.5px]">your page</span>
          </div>

          <div data-theme="dark" className="mt-3 flex flex-col items-center gap-3 sm:mt-4">
            {/* The session header: mode, stage, live clock. */}
            <div
              className="mkt-glass flex w-full items-center gap-2.5 rounded-full px-3 py-1.5"
              style={{ backdropFilter: 'blur(22px) saturate(1.5)', WebkitBackdropFilter: 'blur(22px) saturate(1.5)' }}
            >
              <span
                className="whitespace-nowrap text-[10px] font-semibold sm:text-[11px]"
                style={{ color: modeVar(mode, 'text') }}
              >
                {PILL_MODES[mode].glyph}&nbsp;{PILL_MODES[mode].name}
              </span>
              <span aria-hidden="true" className="h-2.5 w-px" style={{ background: 'var(--mkt-glass-border)' }} />
              <span className="text-[10px] text-(--color-muted-foreground) sm:text-[11px]">{turn.stage}</span>
              <span className="ml-auto flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="mkt-breathe h-[5px] w-[5px] rounded-full"
                  style={{ background: 'var(--color-accent-fill)' }}
                />
                <span className="text-[10px] tabular-nums text-(--color-muted-foreground) sm:text-[11px]">
                  {turn.clock}
                </span>
              </span>
            </div>

            {/* Exactly ONE transient surface, in a FIXED-height slot. The
                surfaces differ in height, and without a fixed box the section
                resizes on every turn and shunts the whole page below it. */}
            <div className="flex w-full items-end justify-center" style={{ height: 116 }}>
              {turn.who === 'calyxa' ? (
                <div
                  key={index}
                  className={`mkt-glass flex max-w-[400px] items-start gap-2.5 rounded-[17px] px-3.5 py-3 ${
                    reduceMotion ? '' : 'mkt-surface-pop'
                  }`}
                  style={{ backdropFilter: 'blur(22px) saturate(1.5)', WebkitBackdropFilter: 'blur(22px) saturate(1.5)' }}
                >
                  <CalyxaMark aria-hidden="true" className="mt-0.5 h-[15px] w-[15px] flex-none" />
                  <div className="flex flex-col gap-1.5 text-left">
                    <span
                      className="self-start rounded-full px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.09em]"
                      style={{ color: modeVar(mode, 'text'), background: modeVar(mode, 'bg') }}
                    >
                      {PILL_MODES[mode].glyph}&nbsp;{PILL_MODES[mode].name}
                    </span>
                    <span className="text-[12px] leading-[1.55] text-(--color-foreground) sm:text-[13px]">
                      {turn.pre}
                      {turn.mark && <EchoChip tone="blue">{turn.mark}</EchoChip>}
                      {turn.post}
                    </span>
                  </div>
                </div>
              ) : turn.who === 'voice' ? (
                <div
                  key={index}
                  className={`mkt-glass flex max-w-[380px] items-start gap-2.5 rounded-[17px] px-3.5 py-3 ${
                    reduceMotion ? '' : 'mkt-surface-pop'
                  }`}
                  style={{ backdropFilter: 'blur(22px) saturate(1.5)', WebkitBackdropFilter: 'blur(22px) saturate(1.5)' }}
                >
                  <div className="flex flex-col gap-1 text-left">
                    <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-(--color-muted-foreground)">
                      You
                    </span>
                    <span className="text-[12px] leading-[1.55] text-(--color-foreground) sm:text-[13px]">
                      {turn.pre}
                    </span>
                  </div>
                </div>
              ) : (
                // A typed turn has no surface at all — the answer goes into
                // the pill's own text row, below.
                null
              )}
            </div>

            {/* The pill slot, likewise fixed so the stack never reflows. */}
            <div className="flex items-center justify-center" style={{ height: 56 }}>
              {turn.who === 'text' ? (
                <TextRow value={turn.pre} />
              ) : turn.who === 'voice' ? (
                <ListeningPill />
              ) : (
                <SpeakingPill mode={mode} />
              )}
            </div>
          </div>
        </div>

        <p className="mb-0 mt-6 max-w-[52ch] text-pretty text-center text-[13.5px] text-muted-foreground sm:mt-8 sm:text-[15px]">
          No chat log to scroll — one card at a time, gone when you&apos;re done with it.
        </p>
      </div>
    </section>
  )
}

function ListeningPill() {
  return (
    <div className="mkt-pill gap-[11px]" style={{ width: 204, height: 52, borderRadius: 26 }}>
      <WaveBars color="var(--color-foreground)" duration={1} />
      <span className="text-[12.5px] font-medium text-(--color-muted-foreground)">Listening</span>
    </div>
  )
}

function SpeakingPill({ mode }: { mode: PillMode }) {
  return (
    <div className="relative flex justify-center">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute rounded-full"
        style={{
          inset: -1,
          background: `radial-gradient(closest-side, ${modeVar(mode, 'border')} 0%, ${modeVar(mode, 'border')} 48%, transparent 74%)`,
          filter: 'blur(10px)',
          opacity: 0.75,
        }}
      >
        <span className="mkt-breathe block h-full w-full" />
      </span>
      <div className="mkt-pill gap-[11px]" style={{ width: 216, height: 52, borderRadius: 26 }}>
        <span
          aria-hidden="true"
          className="mkt-mode-frame"
          style={{ '--mkt-mode-frame-color': modeVar(mode, 'border') } as CSSProperties}
        />
        <WaveBars color={modeVar(mode, 'border')} />
        <span className="whitespace-nowrap text-[12.5px] font-medium" style={{ color: modeVar(mode, 'text') }}>
          {PILL_MODES[mode].glyph}&nbsp;&nbsp;{PILL_MODES[mode].name}
        </span>
      </div>
    </div>
  )
}

/** The pill's text row (Composer.tsx): the typed answer, caret, ↵ hint, ✕. */
function TextRow({ value }: { value: string }) {
  return (
    <div className="mkt-pill gap-2.5 px-4" style={{ width: 268, height: 52, borderRadius: 26 }}>
      <span className="mkt-math flex-1 text-left text-[16px] text-(--color-foreground)">
        {value}
        <span
          aria-hidden="true"
          className="mkt-caret ml-[3px] inline-block w-[2px] rounded-[1px] align-[-2px]"
          style={{ height: 15, background: 'var(--color-accent-fill)' }}
        />
      </span>
      <span
        aria-hidden="true"
        className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-md text-[10px] text-(--color-muted-foreground)"
        style={{ background: 'rgba(255,255,255,0.1)' }}
      >
        ↵
      </span>
      <span aria-hidden="true" className="text-[11px] text-(--color-muted-foreground)">
        ✕
      </span>
    </div>
  )
}
