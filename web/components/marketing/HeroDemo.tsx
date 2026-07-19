'use client'

import { useEffect, useState, type MutableRefObject } from 'react'
import { CalyxaMark } from '@calyxa/ui'

// Landing v5 hero demo (the centerpiece): a mac desktop + Chrome window on a
// real Khan Academy trig problem, with the calyxa glass pill floating over
// it. Visitors type or tap a chip and a scripted, keyword-matched tutor
// exchange plays out — think (950ms of dots) → speak (word-by-word typing at
// an 80ms tick with a blinking caret + mode-tinted waveform in the pill).
// Ported from the v5 handoff's data-dc-script block; all replies are
// Socratic/never-the-answer by design.
//
// The parent hero triggers the same machine from its "See how it works" CTA
// via `askRef` (assigned on mount) — one machine, two entry points.

type HeroMode = 'explore' | 'coach'
type HeroPhase = '' | 'think' | 'speak'

const MODES: Record<HeroMode, { label: string; tx: string; bg: string; wave: string }> = {
  explore: { label: '✧ Exploring', tx: '#0369a1', bg: '#f0f9ff', wave: '#7dd3fc' },
  coach: { label: '✚ Coaching', tx: '#9a3412', bg: '#fff7ed', wave: '#fdba74' },
}

export const STUCK_QUESTION = "hey calyxa — I'm stuck on this one"
const MIC_QUESTION = 'which ratio do I use here?'

// Canned replies, keyword-matched exactly as in the design script.
function replyFor(question: string): { mode: HeroMode; text: string } {
  const q = question.toLowerCase()
  if (q.includes('stuck')) {
    return {
      mode: 'explore',
      text: 'okay — right triangle, you know the 50° angle and the side of length 2. before I say anything: which side is AB, relative to that angle?',
    }
  }
  if (q.includes('ratio') || q.includes('sin') || q.includes('cos') || q.includes('tan')) {
    return {
      mode: 'coach',
      text: 'the 2 sits next to the 50° angle, and AB is the hypotenuse. adjacent and hypotenuse — which of the three ratios pairs those two?',
    }
  }
  if (q.includes('tell me') || q.includes('answer')) {
    return {
      mode: 'coach',
      text: "not a chance — but you're close. set up cos 50° = 2 ÷ AB, then rearrange for AB. say the new equation out loud.",
    }
  }
  return {
    mode: 'explore',
    text: "good question. I never hand over the answer — just the step you're missing. tell me where this triangle stops making sense and we'll start there.",
  }
}

type DemoState = {
  q: string
  asked: string
  full: string
  typed: string
  mode: HeroMode
  phase: HeroPhase
  listening: boolean
}

const IDLE: DemoState = { q: '', asked: '', full: '', typed: '', mode: 'coach', phase: '', listening: false }

// Waveform bars — mobile 7/11/14/10/6, desktop 10/16/20/14/8 per the two
// artboards. Static class strings so the Tailwind scanner sees them.
const WAVE_BAR_CLASSES = [
  'h-[7px] sm:h-2.5',
  'h-[11px] sm:h-4',
  'h-3.5 sm:h-5',
  'h-2.5 sm:h-3.5',
  'h-1.5 sm:h-2',
]

function WaveBars({ color, duration }: { color: string; duration: string }) {
  return (
    <span aria-hidden="true" className="flex h-3.5 items-center gap-[2px] sm:h-5 sm:gap-[3px]">
      {WAVE_BAR_CLASSES.map((heightClass, index) => (
        <span
          key={index}
          className={`mkt-wavebar block w-[2.5px] rounded-[2px] sm:w-[3px] ${heightClass}`}
          style={
            {
              background: color,
              '--mkt-wave-duration': duration,
              '--mkt-wave-delay': `${(index * 0.12).toFixed(2)}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </span>
  )
}

function MicIcon({ className, stroke }: { className: string; stroke: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z" />
      <path d="M6 11a6 6 0 0 0 12 0" />
      <path d="M12 17v3" />
    </svg>
  )
}

const CHIPS: Array<{ full: string; short: string | null; question: string }> = [
  { full: '“hey calyxa — I’m stuck on this one”', short: '“I’m stuck on this one”', question: STUCK_QUESTION },
  { full: '“which ratio do I use?”', short: '“which ratio do I use?”', question: MIC_QUESTION },
  { full: '“just tell me AB”', short: null, question: 'just tell me what AB is' },
]

export function HeroDemo({
  askRef,
  showPlaceholders,
}: {
  askRef?: MutableRefObject<((question: string) => void) | null>
  showPlaceholders: boolean
}) {
  const [state, setState] = useState<DemoState>(IDLE)
  // Deadlines live outside React state so the 80ms tick reads them without
  // re-subscribing (mirrors the script's speakAt/micAt instance fields).
  const [deadlines] = useState(() => ({ speakAt: 0, micAt: 0 }))

  const beginAsk = (s: DemoState, question: string): DemoState => {
    const reply = replyFor(question)
    deadlines.speakAt = Date.now() + 950
    return {
      ...s,
      asked: question,
      full: reply.text,
      mode: reply.mode,
      typed: '',
      q: '',
      phase: 'think',
      listening: false,
    }
  }

  const ask = (question: string) => {
    if (!question.trim()) return
    setState((s) => beginAsk(s, question))
  }

  useEffect(() => {
    if (askRef) askRef.current = ask
    const tick = setInterval(() => {
      setState((s) => {
        if (s.listening) {
          return Date.now() >= deadlines.micAt ? beginAsk(s, MIC_QUESTION) : s
        }
        if (s.phase === 'think') {
          return Date.now() >= deadlines.speakAt ? { ...s, phase: 'speak' } : s
        }
        if (s.phase === 'speak' && s.typed.length < s.full.length) {
          const words = s.full.split(' ')
          const count = s.typed ? s.typed.split(' ').length : 0
          return { ...s, typed: words.slice(0, count + 1).join(' ') }
        }
        return s
      })
    }, 80)
    return () => {
      clearInterval(tick)
      if (askRef) askRef.current = null
    }
    // Mount-only on purpose: the tick reads everything through functional
    // setState + the deadlines object, so re-subscribing per render would
    // only churn the interval.
  }, [])

  const mode = MODES[state.mode]
  const typingActive = state.phase === 'speak' && state.typed.length < state.full.length
  const showInput = !state.listening && !typingActive
  const calm = state.phase !== 'think' && showInput

  return (
    <div id="hero-demo" className="relative mt-8 flex w-full max-w-[1200px] flex-col gap-2 sm:mt-12 sm:gap-3">
      {/* mac desktop backdrop */}
      <div
        className="relative overflow-hidden rounded-[14px] border border-[rgba(28,28,26,0.12)] sm:rounded-[18px]"
        style={{
          background: 'radial-gradient(120% 160% at 12% -10%, #2fb56d 0%, #14532d 48%, #0b2317 100%)',
          boxShadow: '0 60px 120px -36px rgba(28,40,30,0.5), 0 4px 16px rgba(28,40,30,0.1)',
        }}
      >
        {/* menu bar */}
        <div
          className="flex h-[18px] items-center gap-[9px] px-2.5 text-[7.5px] font-medium text-white/80 sm:h-7 sm:gap-[15px] sm:px-4 sm:text-[11px]"
          style={{ background: 'rgba(8,12,9,0.35)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)' }}
        >
          <span className="font-bold">Chrome</span>
          <span>File</span>
          <span>Edit</span>
          <span>View</span>
          <span>History</span>
          <span className="hidden sm:inline">Bookmarks</span>
          <span className="hidden sm:inline">Window</span>
          <span className="hidden sm:inline">Help</span>
          <span className="ml-auto flex gap-2 text-white/70 sm:gap-4">
            <span>Sat Jul 19</span>
            <span>11:25 AM</span>
          </span>
        </div>

        {/* Chrome window */}
        <div
          className="relative mx-auto mt-3.5 w-[92%] rounded-t-[8px] bg-white sm:mt-[26px] sm:w-[89%] sm:rounded-t-[12px]"
          style={{ boxShadow: '0 40px 90px rgba(0,0,0,0.5)' }}
        >
          {/* tab bar */}
          <div className="flex h-6 items-center gap-1.5 rounded-t-[8px] bg-[#dfe1e5] px-[9px] sm:h-[38px] sm:gap-2.5 sm:rounded-t-[12px] sm:px-3.5">
            <span className="mr-0.5 flex gap-1 sm:mr-1.5 sm:gap-[7px]">
              <span className="h-[7px] w-[7px] rounded-full bg-[#ff5f57] sm:h-[11px] sm:w-[11px]" />
              <span className="h-[7px] w-[7px] rounded-full bg-[#febc2e] sm:h-[11px] sm:w-[11px]" />
              <span className="h-[7px] w-[7px] rounded-full bg-[#28c840] sm:h-[11px] sm:w-[11px]" />
            </span>
            <span className="flex h-[18px] min-w-0 items-center gap-[5px] self-end overflow-hidden whitespace-nowrap rounded-t-[6px] bg-white px-[9px] text-[8px] text-[#3c4043] sm:h-[30px] sm:gap-2 sm:rounded-t-[9px] sm:px-4 sm:text-[11.5px]">
              <span className="h-2 w-2 flex-none rounded-full bg-[#14bf96] sm:h-[11px] sm:w-[11px]" />
              Solve for a side in right triangles | Khan Academy
              <span className="ml-2 hidden text-[#9aa0a6] sm:inline">✕</span>
            </span>
          </div>
          {/* url bar row */}
          <div className="flex h-[22px] items-center gap-[7px] border-b border-[#e8eaed] bg-white px-[9px] sm:h-9 sm:gap-3 sm:px-4">
            <span className="hidden gap-3.5 text-[13px] text-[#5f6368] sm:flex">
              <span>←</span>
              <span className="text-[#bdc1c6]">→</span>
              <span>⟳</span>
            </span>
            <span className="flex h-[15px] flex-1 items-center gap-2 overflow-hidden whitespace-nowrap rounded-full bg-[#f1f3f4] px-2 text-[7.5px] text-[#3c4043] sm:h-[26px] sm:px-[13px] sm:text-[11.5px]">
              <span className="hidden h-[9px] w-[9px] flex-none rounded-[2px] border-[1.5px] border-[#5f6368] sm:block" />
              khanacademy.org/math/trigonometry/right-triangles-trig
            </span>
            <span className="flex items-center gap-[3px] sm:gap-[5px]">
              <CalyxaMark className="h-[11px] w-[11px] sm:h-4 sm:w-4" />
              <span className="h-1 w-1 rounded-full bg-[#28c840] sm:h-1.5 sm:w-1.5" />
            </span>
          </div>

          {/* page content */}
          <div className="relative">
            <img
              src="/hero-khan.png"
              alt="Khan Academy — solve for a side in right triangles"
              className="block w-full"
            />
            <div
              className="pointer-events-none absolute inset-0"
              style={{ background: 'linear-gradient(180deg, transparent 50%, rgba(10,16,11,0.24) 100%)' }}
              aria-hidden="true"
            />

            {/* "sees this page" badge */}
            <span
              className="absolute right-2 top-[7px] flex items-center gap-1 rounded-full border border-[rgba(134,239,172,0.35)] px-[7px] py-[3px] text-[7.5px] font-semibold text-[#86EFAC] sm:right-4 sm:top-3.5 sm:gap-1.5 sm:px-[11px] sm:py-[5px] sm:text-[10.5px]"
              style={{
                background: 'rgba(24,26,23,0.72)',
                backdropFilter: 'blur(14px)',
                WebkitBackdropFilter: 'blur(14px)',
              }}
            >
              <CalyxaMark className="h-[9px] w-[9px] flex-none sm:h-3 sm:w-3" /> sees this page
            </span>

            {/* floating layer: transcript bubbles or suggestion chips */}
            <div className="absolute inset-x-0 bottom-14 flex flex-col items-center gap-[7px] px-3 sm:bottom-[94px] sm:gap-2.5 sm:px-6">
              {state.asked ? (
                <div className="flex w-full flex-col items-center gap-[7px] sm:gap-2.5">
                  <div
                    className="mkt-surface-pop hidden max-w-[440px] items-start gap-2.5 rounded-[17px] border border-[rgba(28,28,26,0.1)] px-4 py-3 sm:flex"
                    style={{
                      background: 'rgba(255,255,255,0.9)',
                      backdropFilter: 'blur(22px) saturate(1.5)',
                      WebkitBackdropFilter: 'blur(22px) saturate(1.5)',
                      boxShadow: '0 18px 44px rgba(28,40,30,0.24), 0 2px 8px rgba(28,40,30,0.1)',
                    }}
                  >
                    <MicIcon className="mt-[3px] w-[15px] flex-none" stroke="#6b6b65" />
                    <div className="flex flex-col gap-[3px] text-left">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6b6b65]">You</span>
                      <p className="m-0 text-sm leading-[1.55] text-[#1c1c1a]">{state.asked}</p>
                    </div>
                  </div>
                  {state.phase === 'speak' && (
                    <div
                      className="mkt-surface-pop flex max-w-[260px] items-start gap-[7px] rounded-[13px] border border-[rgba(28,28,26,0.1)] px-[11px] py-2 sm:max-w-[460px] sm:gap-2.5 sm:rounded-[17px] sm:px-4 sm:py-3"
                      style={{
                        background: 'rgba(255,255,255,0.92)',
                        backdropFilter: 'blur(22px) saturate(1.5)',
                        WebkitBackdropFilter: 'blur(22px) saturate(1.5)',
                        boxShadow: '0 18px 44px rgba(28,40,30,0.24), 0 2px 8px rgba(28,40,30,0.1)',
                      }}
                    >
                      <CalyxaMark className="mt-0.5 h-[13px] w-[13px] flex-none sm:h-[17px] sm:w-[17px]" />
                      <div className="flex flex-col gap-1 text-left sm:gap-1.5">
                        <span
                          className="flex items-center gap-1 self-start rounded-full px-[7px] py-0.5 text-[8px] font-semibold uppercase tracking-[0.09em] sm:px-[9px] sm:py-[3px] sm:text-[10px]"
                          style={{ color: mode.tx, background: mode.bg }}
                        >
                          {mode.label}
                        </span>
                        <p className="m-0 text-[11px] leading-[1.5] text-[#1c1c1a] sm:text-sm sm:leading-[1.55]">
                          {state.typed}
                          {typingActive && (
                            <span
                              className="mkt-caret ml-[3px] inline-block h-[10px] w-[2px] rounded-[2px] bg-[#1f9d5b] align-[-2px] sm:h-[13px] sm:w-[2.5px]"
                              aria-hidden="true"
                            />
                          )}
                        </p>
                        <span className="hidden text-[11.5px] text-(--mkt-faint) sm:block">
                          spoken aloud in the real extension — it can already see your page
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2">
                  {CHIPS.map((chip) => (
                    <button
                      key={chip.question}
                      type="button"
                      onClick={() => ask(chip.question)}
                      className={`${chip.short === null ? 'hidden sm:inline-flex' : 'inline-flex'} cursor-pointer rounded-full border border-[rgba(28,28,26,0.16)] px-2.5 py-[5px] text-[10px] text-[#3f3f3a] transition-colors hover:border-[#1f9d5b] hover:text-[#1c1c1a] sm:px-3.5 sm:py-[7px] sm:text-[13px]`}
                      style={{
                        background: 'rgba(255,255,255,0.78)',
                        backdropFilter: 'blur(12px)',
                        WebkitBackdropFilter: 'blur(12px)',
                      }}
                    >
                      <span className={chip.short === null ? undefined : 'hidden sm:inline'}>{chip.full}</span>
                      {chip.short !== null && <span className="sm:hidden">{chip.short}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* the glass pill */}
            <div className="absolute bottom-2 left-1/2 w-[calc(100%-18px)] -translate-x-1/2 sm:bottom-[18px] sm:w-[560px] sm:max-w-[calc(100%-40px)]">
              <div
                className="pointer-events-none absolute -inset-[7px] rounded-full opacity-55 sm:-inset-[9px]"
                style={{
                  background:
                    'radial-gradient(closest-side, rgba(187,247,208,0.75) 0%, rgba(74,222,128,0.65) 48%, transparent 74%)',
                  filter: 'blur(10px)',
                }}
                aria-hidden="true"
              >
                <span className="mkt-breathe block h-full w-full" />
              </div>
              <div
                className="relative flex h-[42px] items-center gap-[7px] rounded-[21px] border border-white/12 pl-3 pr-1.5 sm:h-14 sm:gap-2.5 sm:rounded-[28px] sm:pl-[18px] sm:pr-2.5"
                style={{
                  background: 'rgba(24,26,23,0.82)',
                  backdropFilter: 'blur(24px) saturate(1.5)',
                  WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
                  boxShadow: '0 18px 44px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.3)',
                }}
              >
                <CalyxaMark className="h-3.5 w-3.5 flex-none sm:h-[18px] sm:w-[18px]" />
                {state.listening && (
                  <span className="flex flex-1 items-center gap-2 sm:gap-[11px]">
                    <WaveBars color="#F1F1ED" duration="1s" />
                    <span className="text-[10.5px] font-medium text-[#98988F] sm:text-[13.5px]">Listening</span>
                  </span>
                )}
                {typingActive && (
                  <span className="flex flex-1 items-center gap-2 sm:gap-[11px]">
                    <WaveBars color={mode.wave} duration="0.85s" />
                    <span className="text-[10px] font-medium sm:text-[13px]" style={{ color: mode.wave }}>
                      {mode.label}
                    </span>
                  </span>
                )}
                {showInput && (
                  <input
                    value={state.q}
                    onChange={(event) => setState((s) => ({ ...s, q: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') ask(state.q)
                    }}
                    placeholder="Ask about this problem…"
                    aria-label="Ask calyxa"
                    className="min-w-0 flex-1 border-none bg-transparent text-[11.5px] text-[#F1F1ED] caret-[#86EFAC] outline-none placeholder:text-[#98988F] sm:text-[14.5px]"
                  />
                )}
                {state.phase === 'think' && !state.listening && (
                  <span
                    className="flex flex-none items-center gap-[3px] px-[5px] sm:gap-1 sm:px-1.5"
                    aria-label="calyxa is thinking"
                  >
                    {[0, 0.18, 0.36].map((delay) => (
                      <span
                        key={delay}
                        className="mkt-thinkdot h-1 w-1 rounded-full bg-[#86EFAC] sm:h-[5px] sm:w-[5px]"
                        style={{ '--mkt-think-delay': `${delay}s` } as React.CSSProperties}
                      />
                    ))}
                  </span>
                )}
                {calm && (
                  <button
                    type="button"
                    onClick={() => ask(state.q)}
                    title="Send"
                    aria-label="Send"
                    className="flex-none cursor-pointer rounded-[6px] border border-white/12 bg-white/7 px-1.5 py-0.5 text-[9px] font-semibold text-[#98988F] sm:rounded-[7px] sm:px-[7px] sm:py-[3px] sm:text-[10.5px]"
                  >
                    ↵
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (state.listening) return
                    deadlines.micAt = Date.now() + 1500
                    setState((s) => ({ ...s, listening: true }))
                  }}
                  title="Talk instead"
                  aria-label="Talk instead"
                  className="flex h-[30px] w-[30px] flex-none cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-[rgba(134,239,172,0.12)] sm:h-9 sm:w-9"
                >
                  <MicIcon className="w-[13px] flex-none sm:w-[17px]" stroke="#86EFAC" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      {showPlaceholders && (
        <p className="m-0 text-center text-[9.5px] text-[#6f6f68] sm:text-[11px]">
          scripted demo — the real calyxa floats over your actual homework tab
        </p>
      )}
    </div>
  )
}
