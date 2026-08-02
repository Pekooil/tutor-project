'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { useReducedMotion } from 'motion/react'
import { CalyxaMark } from '@calyxa/ui'
import { AnnotLabel, EchoChip, PingChip, TermMark, WaveBars } from '@/components/marketing/pill/overlay'

// Landing v7 hero demo (design_handoff_calyxa_landing §2): the three-screen
// feature carousel that replaces HeroDemo's scripted Khan-Academy tutoring
// session.
//
// The one structural fix this makes to the shipped hero, and the reason the
// component exists at all: HeroDemo is authored at 1020px and TRANSFORM-SCALED
// into a ~660px column, so every element painted at ~62% — a full macOS menu
// bar, tab strip, URL bar and Khan sidebar rendered at 6-8px while Calyxa
// itself was a ~100px pill. The host page had 100% fidelity and the product
// had none. Here the host page is deliberately RECESSED (a four-row context
// strip at 72% opacity fading under a white gradient) and the Calyxa surfaces
// paint at their real size, fluid to the column. Nothing is scaled.
//
// Three fidelity corrections to the design file, each made against the shipped
// extension rather than the prototype:
//  - the combo reaction fires at 3 and every 3 after (reactions.ts), never at
//    4, and it speaks a sentence rather than the prototype's "✓ 4 in a row.";
//  - the completion trio's labels come from vocabulary.ts's GRADED set, since
//    the host page here is Khan Academy and does expose correctness;
//  - remaining time is a RING, not a "14 min left" countdown — spec §2 makes
//    that a deliberate product decision ("never a countdown that can be
//    missed", no amber or red state by construction). The demo keeps the
//    ring and glosses it with the words, which the product carries as the
//    ring's title/sr-only text.

// The clock is module-level so a remount picks the running session up where
// it is instead of restarting it, and every index is DERIVED from elapsed
// time — a throttled or dropped tick self-corrects instead of drifting.
const T0 = Date.now()

// A session already underway when you arrive, so the header clock reads like
// a real one rather than starting at 0:00 on every page load.
const CLOCK_BASE_S = 11 * 60 + 4

const SCREEN_MS = 5000
const SCREENS = 3

const LABELS = ['The bar, and the time', 'One tap per problem', 'It marks up your screen']

/**
 * One self-re-arming setTimeout driving the whole demo. NOT
 * requestAnimationFrame: rAF never fires in a document reported hidden (any
 * embed, preview pane or background tab), and this card is the hero — it has
 * to be moving when the tab comes forward, not frozen on screen one.
 */
function useElapsed(active: boolean): number {
  const [ms, setMs] = useState(0)

  useEffect(() => {
    if (!active) return
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      if (!alive) return
      setMs(Date.now() - T0)
      timer = setTimeout(tick, 250)
    }
    timer = setTimeout(tick, 250)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [active])

  return ms
}

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function HomeworkDemo() {
  const reduceMotion = useReducedMotion()
  const ms = useElapsed(true)
  const screen = Math.floor(ms / SCREEN_MS) % SCREENS
  const clock = formatElapsed(CLOCK_BASE_S + Math.floor(ms / 1000))

  return (
    <div className="w-full">
      <div
        className="overflow-hidden rounded-[14px] border border-(--mkt-hairline) bg-background sm:rounded-[18px]"
        style={{ boxShadow: 'var(--mkt-shadow-3)' }}
      >
        {/* Browser chrome, kept to the minimum that says "a page in Chrome" —
            the shipped demo's full menu bar / tab strip / sidebar was pure
            noise at this size. */}
        <div className="flex items-center gap-2 border-b border-(--mkt-hairline) bg-[#f7f7f5] px-3 py-2 sm:px-3.5 sm:py-2.5">
          <span aria-hidden="true" className="flex gap-1.5">
            {['#e5e3de', '#e5e3de', '#e5e3de'].map((color, index) => (
              <span key={index} className="h-2 w-2 rounded-full" style={{ background: color }} />
            ))}
          </span>
          <span className="mx-auto rounded-md bg-background px-2.5 py-0.5 text-[10.5px] text-(--mkt-faint) sm:text-[11.5px]">
            khanacademy.org
          </span>
        </div>

        <div className="relative overflow-hidden" style={{ height: 'clamp(268px, 27vw, 320px)' }}>
          <div
            className="absolute inset-x-0 top-0 flex flex-col"
            style={{
              height: `${SCREENS * 100}%`,
              transform: `translateY(${-(screen * 100) / SCREENS}%)`,
              transition: reduceMotion ? undefined : 'transform 0.72s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            <Screen>
              <SessionHeader mode="explore" stage="Stage 2 of 3" clock={clock} />
              <HostRows active={screen === 0} />
              <SetPill />
            </Screen>

            <Screen>
              <SessionHeader mode="explore" stage="Stage 2 of 3" clock={clock} />
              <HostRows active={screen === 1} />
              <CompletionTrio live={screen === 1} />
            </Screen>

            <Screen>
              <SessionHeader mode="coach" stage="Stage 2 of 3" clock={clock} />
              <AnnotatedProblem live={screen === 2} />
            </Screen>
          </div>
        </div>
      </div>

      {/* The labels track the active screen — an accent rule above each. */}
      <div className="mt-3 grid grid-cols-3 gap-2 sm:mt-4 sm:gap-3">
        {LABELS.map((label, index) => {
          const active = index === screen
          return (
            <div key={label} className="flex flex-col gap-1.5 sm:gap-2">
              <span
                aria-hidden="true"
                className="h-[2px] w-full rounded-full transition-colors duration-500"
                style={{ background: active ? 'var(--color-accent-fill)' : 'var(--mkt-hairline)' }}
              />
              <span
                className="text-[10.5px] leading-snug transition-colors duration-500 sm:text-[12.5px]"
                style={{
                  color: active ? 'var(--color-foreground)' : 'var(--mkt-faint)',
                  fontWeight: active ? 600 : 500,
                }}
              >
                {label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** One carousel screen: the host page behind, Calyxa's surfaces in front. */
function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-theme="dark"
      className="relative flex flex-none flex-col px-3 pb-3.5 pt-2.5 sm:px-4 sm:pb-4 sm:pt-3"
      style={{ height: `${100 / SCREENS}%` }}
    >
      {children}
    </div>
  )
}

// ── The session header (8a) ───────────────────────────────────────────────
// The tutor mode sits where the logo would, then the stage label, then the
// live m:ss clock with its breathing dot — the shipped header, per
// extension/src/overlay/tutor-modes.ts.

const MODE_META = {
  explore: { glyph: '✧', name: 'Exploring' },
  coach: { glyph: '✚', name: 'Coaching' },
} as const

function SessionHeader({
  mode,
  stage,
  clock,
}: {
  mode: keyof typeof MODE_META
  stage: string
  clock: string
}) {
  const meta = MODE_META[mode]
  return (
    <div
      className="mkt-glass relative z-20 flex items-center gap-2 self-start rounded-full px-2.5 py-1 sm:gap-2.5 sm:px-3 sm:py-1.5"
      style={{ backdropFilter: 'blur(22px) saturate(1.5)', WebkitBackdropFilter: 'blur(22px) saturate(1.5)' }}
    >
      <span
        className="flex items-center gap-1 whitespace-nowrap text-[9.5px] font-semibold sm:text-[11px]"
        style={{ color: `var(--calyxa-mode-${mode}-text)` }}
      >
        {meta.glyph}&nbsp;{meta.name}
      </span>
      <span aria-hidden="true" className="h-2.5 w-px" style={{ background: 'var(--mkt-glass-border)' }} />
      <span className="whitespace-nowrap text-[9.5px] text-(--color-muted-foreground) sm:text-[11px]">{stage}</span>
      <span className="ml-auto flex items-center gap-1.5 pl-1">
        <span
          aria-hidden="true"
          className="mkt-breathe h-[5px] w-[5px] rounded-full"
          style={{ background: 'var(--color-accent-fill)' }}
        />
        <span className="text-[9.5px] tabular-nums text-(--color-muted-foreground) sm:text-[11px]">{clock}</span>
      </span>
    </div>
  )
}

// ── The host page, recessed ───────────────────────────────────────────────

const ROWS = [
  { num: '3', eq: 'x² − 9 = 0', done: true },
  { num: '4', eq: 'x² − x − 12 = 0', done: true },
  { num: '5', eq: '2x² + 5x − 3 = 0', done: true },
  { num: '6', eq: 'x² + 4x + 4 = 0', done: false },
]

/**
 * The worksheet Calyxa is counting — deliberately recessed to 72% and fading
 * out under a white gradient. The subject of this card is the extension, not
 * the homework, and the shipped hero got that backwards.
 */
function HostRows({ active }: { active: boolean }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 overflow-hidden pt-11 sm:pt-12">
      <div className="relative flex flex-col gap-[3px] px-4 opacity-[0.72] sm:gap-1 sm:px-5">
        {ROWS.map((row) => (
          <div
            key={row.num}
            className="flex items-center gap-2.5 rounded-md px-2 py-[3px] sm:gap-3 sm:py-1"
            style={row.done ? undefined : { background: 'rgba(134, 239, 172, 0.14)' }}
          >
            <span className="w-3 text-[9.5px] text-(--mkt-faint) sm:text-[10.5px]">{row.num}</span>
            <span className="mkt-math text-[11px] text-(--mkt-strip-text) sm:text-[13px]">{row.eq}</span>
            {row.done && (
              <span className="ml-auto text-[10px] sm:text-[11.5px]" style={{ color: 'var(--calyxa-annot-1)' }}>
                ✓
              </span>
            )}
          </div>
        ))}

        {/* The read-only scan line, on the screen that is about counting. */}
        {active && (
          <span
            className="mkt-scan absolute inset-x-0 h-px"
            style={{ background: 'linear-gradient(90deg, transparent, var(--color-accent-fill), transparent)' }}
          />
        )}
      </div>

      {/* The white fade the strip disappears under. */}
      <div
        className="absolute inset-x-0 bottom-0 h-14 sm:h-16"
        style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0), #ffffff 78%)' }}
      />
    </div>
  )
}

// ── Screen 1: the bar, and the time ───────────────────────────────────────

/**
 * The set pill: how many problems are done, and roughly how long is left.
 * The ring is the product's own remaining-time indicator (HomeworkPill.tsx's
 * RemainingRing) — one stroke color, no amber or red state, so it can never
 * read as a deadline being missed.
 */
function SetPill() {
  const done = 5
  const total = 8
  const minutes = 14
  const fraction = done / total
  const radius = 13.5
  const circumference = 2 * Math.PI * radius

  return (
    <div className="relative z-10 mt-auto flex justify-center">
      <div
        className="mkt-pill flex items-center gap-3 px-3.5 py-2 sm:gap-4 sm:px-4 sm:py-2.5"
        style={{ width: 'auto', height: 'auto', borderRadius: 999 }}
      >
        <CalyxaMark aria-hidden="true" className="h-[15px] w-[15px] flex-none sm:h-4 sm:w-4" />

        <span className="flex items-center gap-2 sm:gap-2.5">
          <span
            aria-hidden="true"
            className="relative flex h-1.5 overflow-hidden rounded-full sm:h-[7px]"
            style={{ width: 'clamp(78px, 9vw, 108px)', background: 'rgba(255,255,255,0.16)' }}
          >
            <span
              className="mkt-fill block h-full rounded-full"
              style={{ width: `${fraction * 100}%`, background: 'var(--color-accent-fill)' }}
            />
          </span>
          <span className="whitespace-nowrap text-[11.5px] font-semibold tabular-nums text-(--color-foreground) sm:text-[13px]">
            {done} / {total}
          </span>
        </span>

        <span aria-hidden="true" className="h-4 w-px" style={{ background: 'var(--mkt-glass-border)' }} />

        <span className="flex items-center gap-1.5 sm:gap-2">
          <span aria-hidden="true" className="relative flex-none" style={{ width: 26, height: 26 }}>
            <svg viewBox="0 0 32 32" style={{ width: 26, height: 26, transform: 'rotate(-90deg)' }}>
              <circle cx="16" cy="16" r={radius} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth={3.5} />
              <circle
                cx="16"
                cy="16"
                r={radius}
                fill="none"
                stroke="var(--color-accent-glow-strong)"
                strokeWidth={3.5}
                strokeLinecap="round"
                strokeDasharray={circumference.toFixed(1)}
                strokeDashoffset={(circumference * (1 - fraction)).toFixed(1)}
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-semibold tabular-nums text-(--color-muted-foreground)">
              {minutes}
            </span>
          </span>
          <span className="whitespace-nowrap text-[10.5px] text-(--color-muted-foreground) sm:text-[12px]">
            min left
          </span>
        </span>
      </div>
    </div>
  )
}

// ── Screen 2: one tap per problem ─────────────────────────────────────────

// vocabulary.ts's GRADED trio — Khan Academy exposes per-problem correctness,
// so Calyxa can honestly distinguish "Got it" from "Wrong". On a page with no
// answer key the shipped labels drop the correctness claim entirely.
const TRIO = [
  { label: 'Got it', tone: 'ok' as const },
  { label: 'Got it, but not sure why', tone: 'shaky' as const },
  { label: 'Wrong or stuck', tone: 'stuck' as const },
]

function CompletionTrio({ live }: { live: boolean }) {
  return (
    <div className="relative z-10 mt-auto flex flex-col items-center gap-2 sm:gap-2.5">
      {/* The reaction fires at 3 in a row and every 3 after (reactions.ts) —
          it speaks a sentence, it does not print a counter. */}
      {live && (
        <div className="flex justify-center">
          <PingChip tone="positive" glyph="✓" label="3 in a row — you're on it." />
        </div>
      )}

      <div className="mkt-glass mkt-surface-pop flex flex-col gap-2.5 rounded-[17px] px-3.5 py-3 sm:gap-3 sm:px-4 sm:py-3.5">
        <span className="text-center text-[11.5px] text-(--color-foreground) sm:text-[13px]">
          Number 6 — how did that go?
        </span>
        <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
          {TRIO.map((button) => {
            const pressed = button.tone === 'ok' && live
            return (
              <span
                key={button.label}
                className="whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-semibold transition-transform duration-200 sm:px-3 sm:py-1.5 sm:text-[11.5px]"
                style={{
                  background:
                    button.tone === 'ok'
                      ? 'var(--color-accent-fill)'
                      : button.tone === 'stuck'
                        ? 'var(--calyxa-annot-2-tint)'
                        : 'rgba(255,255,255,0.1)',
                  color:
                    button.tone === 'ok'
                      ? 'var(--color-accent-fill-foreground)'
                      : button.tone === 'stuck'
                        ? 'var(--calyxa-annot-2-deep)'
                        : 'var(--color-foreground)',
                  // "Got it" mid-press — the tap the screen is demonstrating.
                  transform: pressed ? 'scale(0.94)' : 'scale(1)',
                }}
              >
                {button.label}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Screen 3: it marks up your screen ─────────────────────────────────────

/**
 * The annotation layer over the problem the student is stuck on. Two marks
 * on the two terms whose product is −6 (2 and −3), the label pill naming
 * why, and the caption echoing the marked phrase in the mark's own colour —
 * highlightAnnotatedPhrases' real behaviour.
 */
function AnnotatedProblem({ live }: { live: boolean }) {
  return (
    <>
      <div className="relative z-10 mt-8 flex justify-center sm:mt-9">
        <div className="relative">
          <span className="mkt-math flex items-center gap-1 text-[17px] text-(--mkt-strip-text) sm:text-[21px]">
            <TermMark tone="blue" animate={live} pad={7}>
              <span className="text-foreground">2</span>
            </TermMark>
            <span>x² + 5x</span>
            <TermMark tone="blue" animate={live} pad={7} drawDelay={0.34} fillDelay={0.64}>
              <span className="text-foreground">− 3</span>
            </TermMark>
            <span>= 0</span>
          </span>
          {live && (
            <AnnotLabel tone="blue" side="below" offset={34} animate delay={0.84}>
              these two make −6
            </AnnotLabel>
          )}
        </div>
      </div>

      <div className="relative z-10 mt-auto flex flex-col items-center gap-2.5 sm:gap-3">
        <div
          className="mkt-glass mkt-surface-pop flex max-w-[330px] items-start gap-2 rounded-[17px] px-3 py-2.5 sm:gap-2.5 sm:px-3.5 sm:py-3"
          style={{ backdropFilter: 'blur(22px) saturate(1.5)', WebkitBackdropFilter: 'blur(22px) saturate(1.5)' }}
        >
          <CalyxaMark aria-hidden="true" className="mt-0.5 h-3 w-3 flex-none sm:h-[15px] sm:w-[15px]" />
          <div className="flex flex-col gap-1 text-left sm:gap-1.5">
            <span
              className="flex items-center gap-1 self-start rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.09em] sm:text-[10px]"
              style={{ color: 'var(--calyxa-mode-coach-text)', background: 'var(--calyxa-mode-coach-bg)' }}
            >
              ✚&nbsp;Coaching
            </span>
            <span className="text-[11px] leading-[1.55] text-(--color-foreground) sm:text-[12.5px]">
              Look at <EchoChip tone="blue">these two</EchoChip> — what multiplies to −6 and adds to 5?
            </span>
          </div>
        </div>

        <SpeakingPill />
      </div>
    </>
  )
}

/** The pill in its speaking shape — mode-tinted waveform plus the mode name. */
function SpeakingPill() {
  return (
    <div className="relative flex justify-center">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute rounded-full"
        style={{
          inset: -1,
          background:
            'radial-gradient(closest-side, var(--calyxa-mode-coach-border) 0%, var(--calyxa-mode-coach-border) 48%, transparent 74%)',
          filter: 'blur(10px)',
          opacity: 0.8,
        }}
      >
        <span className="mkt-breathe block h-full w-full" />
      </span>
      <div
        className="mkt-pill gap-[9px] sm:gap-[11px]"
        style={{ width: 178, height: 44, borderRadius: 22 }}
      >
        <span
          aria-hidden="true"
          className="mkt-mode-frame"
          style={{ '--mkt-mode-frame-color': 'var(--calyxa-mode-coach-border)' } as CSSProperties}
        />
        <WaveBars color="var(--calyxa-mode-coach-border)" />
        <span
          className="whitespace-nowrap text-[11px] font-medium sm:text-[12.5px]"
          style={{ color: 'var(--calyxa-mode-coach-text)' }}
        >
          ✚&nbsp;&nbsp;Coaching
        </span>
      </div>
    </div>
  )
}
