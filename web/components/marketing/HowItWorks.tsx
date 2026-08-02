'use client'

import { useEffect, useState } from 'react'

// Landing v7 §4, "Three moves. That's it." — replaces the before/after card
// pair, and with it the eight-step "screenshot → paste → copy it down" list.
//
// That list was the page's most eye-catching motion and it was a tutorial for
// the competing workflow: eight legible steps, highlighted one at a time,
// teaching the visitor exactly how to use a chatbot instead. Its closing line
// ("cheating and learning nothing") also carried the moral framing the v7 copy
// rules retire. Both are gone.
//
// One correction to the design file, made against the shipped extension. The
// handoff's first card reads "And tells you how long it'll take, from your own
// pace" — but opener.ts's MIN_SESSIONS_FOR_ESTIMATE is 3, and estimateRange()
// returns null until then, deliberately: a first-timer gets no estimate rather
// than a fabricated one. The design's claim is therefore false for every
// person reading the page for the first time, on precisely the session that
// has to land. The copy here says "after a few sets" and stays true on day one.

const STEPS = [
  {
    n: 1,
    label: 'It counts the problems.',
    clause: 'And after a few sets, how long they take — measured from your own pace, never a guess.',
  },
  {
    n: 2,
    label: 'You tap one per problem.',
    clause: '“Got it, but not sure why” comes back later, so nothing slips past you.',
  },
  {
    n: 3,
    label: 'The bar hits the end.',
    clause: 'Your time against your last time — and the set is over.',
  },
]

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="flex flex-col items-center bg-background px-[22px] py-14 sm:px-11 sm:pb-[110px] sm:pt-[100px]"
    >
      <h2
        className="mkt-display m-0 text-center font-bold text-foreground"
        style={{ fontSize: 'clamp(23px, 2.2vw, 34px)', lineHeight: 1.1, letterSpacing: '-0.025em' }}
      >
        Three moves. That&apos;s it.
      </h2>
      <p className="mb-0 mt-2.5 max-w-[52ch] text-pretty text-center text-[14.5px] text-muted-foreground sm:text-[16.5px]">
        Open the page you were going to do anyway.
      </p>

      <div className="mt-8 grid w-full max-w-[1240px] gap-3 sm:mt-11 sm:grid-cols-3 sm:gap-[18px]">
        {STEPS.map((step) => (
          <div
            key={step.n}
            className="flex flex-col gap-3.5 rounded-[18px] border border-(--mkt-hairline) bg-background p-4 sm:gap-4 sm:rounded-[20px] sm:p-5"
          >
            <div className="flex h-[86px] items-center justify-center rounded-[13px] bg-[#f7f7f5] px-3 sm:h-[100px]">
              {step.n === 1 && <ScanVisual />}
              {step.n === 2 && <TrioVisual />}
              {step.n === 3 && <DoneVisual />}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center gap-2 text-[14.5px] font-bold tracking-[-0.015em] text-foreground sm:text-[16px]">
                <span className="flex h-[19px] w-[19px] flex-none items-center justify-center rounded-full bg-accent-subtle text-[10.5px] font-semibold text-accent-emphasis">
                  {step.n}
                </span>
                {step.label}
              </span>
              <p className="m-0 text-[13px] leading-[1.55] text-muted-foreground sm:text-[13.5px]">{step.clause}</p>
            </div>
          </div>
        ))}
      </div>

      <Comparison />
    </section>
  )
}

/** A page being read, top to bottom. Nothing on it moves — the scan passes over. */
function ScanVisual() {
  return (
    <div aria-hidden="true" className="relative w-full max-w-[190px] overflow-hidden rounded-md">
      <div className="flex flex-col gap-[5px]">
        {[86, 64, 78, 52].map((width, index) => (
          <span key={index} className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 flex-none rounded-full bg-(--mkt-hairline)" />
            <span className="h-1.5 rounded-full bg-(--mkt-hairline)" style={{ width: `${width}%` }} />
          </span>
        ))}
      </div>
      <span
        className="mkt-scan absolute inset-x-0 h-px"
        style={{ background: 'linear-gradient(90deg, transparent, var(--color-accent-fill), transparent)' }}
      />
    </div>
  )
}

/** The completion trio, in vocabulary.ts's graded wording. */
function TrioVisual() {
  return (
    <div aria-hidden="true" className="flex flex-wrap items-center justify-center gap-1.5">
      <span className="rounded-full bg-accent-fill px-2.5 py-1 text-[10px] font-semibold text-accent-fill-foreground">
        Got it
      </span>
      <span className="rounded-full border border-(--mkt-hairline) bg-background px-2.5 py-1 text-[10px] font-semibold text-(--mkt-strip-text)">
        Not sure why
      </span>
      <span
        className="rounded-full px-2.5 py-1 text-[10px] font-semibold"
        style={{
          background: 'var(--calyxa-annot-2-tint)',
          border: '1px solid var(--calyxa-annot-2-tint-border)',
          color: 'var(--calyxa-annot-2-deep)',
        }}
      >
        Wrong or stuck
      </span>
    </div>
  )
}

/** The end of the set: the bar full, and a check. */
function DoneVisual() {
  return (
    <div aria-hidden="true" className="flex w-full max-w-[190px] items-center gap-2.5">
      <span className="flex h-[7px] flex-1 overflow-hidden rounded-full bg-(--mkt-hairline)">
        <span className="mkt-fill block h-full w-full rounded-full bg-accent-fill" />
      </span>
      <span
        className="mkt-check flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full text-[11px] font-bold text-accent-fill-foreground"
        style={{ background: 'var(--color-accent-fill)', '--mkt-check-delay': '0.9s' } as React.CSSProperties}
      >
        ✓
      </span>
    </div>
  )
}

/**
 * The same assignment, two nights — alone against the same set with Calyxa.
 *
 * Darcy's call (2026-07-29) to keep the design file's 52 → 38 figures. Flagged
 * at the time and recorded here: these are the design's numbers, not a
 * measurement — nothing in the repo logs set duration against a control, so
 * the first real beta cohort is what should replace them. Everything else on
 * this page is either product-generated or verifiable.
 *
 * 2026-07-30 (Darcy): the two bars were the whole argument for "faster and
 * less grind", and they were making it quietly — same size type as the labels
 * next to them, no number bigger than 13px anywhere. This adds the thing that
 * was missing: a headline stat (the delta itself, in the same accent-emphasis
 * the rest of the page reserves for its biggest claims) and, under each bar, a
 * one-line answer to WHERE the 14 minutes goes — not just that Calyxa is
 * faster, but that the difference is less rereading and less restarting, i.e.
 * less grind, which is the ideal outcome this section exists to sell.
 */
const SEGMENTS = 8
const DELTA_MINUTES = 52 - 38

function Comparison() {
  const [step, setStep] = useState(1)

  useEffect(() => {
    const tick = setInterval(() => setStep((current) => (current % SEGMENTS) + 1), 900)
    return () => clearInterval(tick)
  }, [])

  return (
    <div className="mt-3 w-full max-w-[1240px] rounded-[20px] border border-(--mkt-hairline) bg-background p-5 sm:mt-[18px] sm:rounded-[24px] sm:p-8">
      <div className="flex flex-col items-center gap-1.5 pb-5 text-center sm:gap-2 sm:pb-7">
        <span className="flex items-baseline gap-2">
          <span
            className="mkt-display font-bold text-accent-emphasis"
            style={{ fontSize: 'clamp(38px, 5vw, 56px)', lineHeight: 1, letterSpacing: '-0.02em' }}
          >
            {DELTA_MINUTES}
          </span>
          <span className="text-[16px] font-bold text-accent-emphasis sm:text-[20px]">fewer minutes</span>
        </span>
        <p className="m-0 max-w-[38ch] text-pretty text-[13px] text-muted-foreground sm:text-[15px]">
          Same eight problems — less rereading, less restarting, less grind.
        </p>
      </div>

      <div className="flex flex-col gap-4 sm:gap-5">
        <Row
          label="On your own"
          time="52 min"
          tags={['reread the solution', 'start over', 'copy it down']}
          tagTone="grind"
          labelColor="var(--color-muted-foreground)"
          timeColor="var(--calyxa-annot-2-deep)"
          fill={(index) => (index < step ? 'var(--calyxa-annot-2)' : 'var(--mkt-hairline-faint)')}
        />
        <Row
          label="With Calyxa"
          time="38 min"
          tags={['one nudge', 'back to it']}
          tagTone="ease"
          labelColor="var(--color-accent-emphasis)"
          timeColor="var(--color-accent-emphasis)"
          fill={() => 'var(--color-accent-fill)'}
        />
      </div>
    </div>
  )
}

function Row({
  label,
  time,
  tags,
  tagTone,
  labelColor,
  timeColor,
  fill,
}: {
  label: string
  time: string
  tags: string[]
  tagTone: 'grind' | 'ease'
  labelColor: string
  timeColor: string
  fill: (index: number) => string
}) {
  return (
    <div className="flex flex-col gap-2 sm:gap-2.5">
      <div className="flex items-center gap-2.5 sm:gap-4">
        <span
          className="flex-none text-[11.5px] font-semibold sm:min-w-[96px] sm:text-[13px]"
          style={{ color: labelColor }}
        >
          {label}
        </span>
        <span aria-hidden="true" className="flex flex-1 gap-1 sm:gap-1.5">
          {Array.from({ length: SEGMENTS }, (_, index) => (
            <span
              key={index}
              className="h-[9px] flex-1 rounded-[3px] transition-colors duration-500 sm:h-2.5"
              style={{ background: fill(index) }}
            />
          ))}
        </span>
        <span
          className="flex-none text-[11.5px] font-semibold tabular-nums sm:text-[13px]"
          style={{ color: timeColor }}
        >
          {time}
        </span>
      </div>

      {/* Where the time actually goes — the "less grind" half of the claim,
          not just the "faster" half. */}
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) =>
          tagTone === 'grind' ? (
            <span
              key={tag}
              className="rounded-full px-2.5 py-1 text-[10.5px] font-medium sm:text-[11.5px]"
              style={{
                background: 'var(--calyxa-annot-2-tint)',
                border: '1px solid var(--calyxa-annot-2-tint-border)',
                color: 'var(--calyxa-annot-2-deep)',
              }}
            >
              {tag}
            </span>
          ) : (
            <span
              key={tag}
              className="rounded-full bg-accent-subtle px-2.5 py-1 text-[10.5px] font-medium text-accent-emphasis sm:text-[11.5px]"
            >
              {tag}
            </span>
          )
        )}
      </div>
    </div>
  )
}
