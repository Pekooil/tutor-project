'use client'

import { useEffect, useState } from 'react'
import { CalyxaMark } from '@calyxa/ui'

// Landing v5 "Skip the copy-paste loop." — the Before card cycles a live
// highlight through its 8 steps every 900ms (step = step % 8 + 1); the After
// card is one sentence on the green wash. Anchored as #how-it-works for the
// nav/footer links.

const STEPS = [
  'Screenshot the problem',
  'Open a new chat',
  'Paste it in',
  "Type where you're stuck",
  'Read the full solution',
  'Copy it down',
  'Turn it in',
  'Miss the same step on the test',
]

export function BeforeAfter() {
  const [step, setStep] = useState(1)

  useEffect(() => {
    const tick = setInterval(() => setStep((current) => (current % 8) + 1), 900)
    return () => clearInterval(tick)
  }, [])

  return (
    <section
      id="how-it-works"
      className="flex flex-col items-center border-t border-(--mkt-hairline-soft) bg-(--calyxa-board-bg) px-[22px] py-14 sm:px-14 sm:py-[104px]"
    >
      <p className="mkt-eyebrow m-0">getting unstuck</p>
      <h2 className="mkt-display mkt-h2 mb-0 mt-3 text-center text-foreground sm:mt-4">Skip the copy-paste loop.</h2>
      <p className="mb-0 mt-4 hidden max-w-[50ch] text-pretty text-center text-[17px] leading-[1.6] text-(--mkt-strip-text) sm:block">
        one sentence does what used to take eight steps — and this time you actually learn it.
      </p>

      <div className="mt-[22px] grid w-full max-w-[1060px] items-stretch gap-3.5 sm:mt-13 sm:grid-cols-2 sm:gap-6">
        {/* Before */}
        <div className="flex flex-col gap-3 rounded-2xl border border-(--mkt-hairline) bg-background px-[22px] py-[22px] sm:gap-[18px] sm:rounded-[20px] sm:px-9 sm:py-[34px]">
          <div className="flex items-baseline justify-between">
            <span className="text-[12.5px] font-semibold text-muted-foreground sm:text-sm">Before</span>
            <span className="text-[11.5px] font-semibold text-(--mkt-faint) sm:text-[13px]">
              <span className="inline-block min-w-[11px] text-[18px] tabular-nums text-foreground sm:min-w-[15px] sm:text-2xl">
                {step}
              </span>{' '}
              / 8 steps
            </span>
          </div>
          <div className="flex flex-col gap-[3px] sm:gap-1">
            {STEPS.map((label, index) => {
              const number = index + 1
              const active = number === step
              const last = number === 8
              return (
                <span
                  key={label}
                  className={`-mx-2.5 flex items-center gap-2 rounded-full border px-2.5 py-[3px] text-[12.5px] transition-[background-color,border-color] duration-300 sm:gap-[11px] sm:py-1 sm:text-sm ${
                    last
                      ? 'font-medium text-[#8a4106] sm:text-foreground'
                      : 'text-(--mkt-strip-text)'
                  } ${active ? 'border-accent-fill bg-accent-subtle' : 'border-transparent bg-transparent'}`}
                >
                  <span className="sm:hidden">{number}&nbsp;</span>
                  <span
                    className={`hidden h-5 w-5 flex-none items-center justify-center rounded-md border text-[10px] font-semibold sm:flex ${
                      last
                        ? 'border-[#f0e0bc] bg-[#fbf3e4] text-[#8a4106]'
                        : 'border-(--mkt-hairline) bg-[#f7f7f5] text-(--mkt-faint)'
                    }`}
                  >
                    {number}
                  </span>
                  {label}
                </span>
              )
            })}
          </div>
        </div>

        {/* After */}
        <div className="flex flex-col gap-3 rounded-2xl border border-(--calyxa-sage-border) bg-accent-subtle p-5 sm:gap-[18px] sm:rounded-[20px] sm:px-8 sm:py-[30px]">
          <div className="flex items-baseline justify-between">
            <span className="text-[12.5px] font-semibold text-accent-emphasis sm:text-sm">After</span>
            <span className="text-[11.5px] font-semibold text-accent-emphasis sm:text-[13px]">
              <span className="text-[18px] text-accent-fill sm:text-2xl">1</span> step
            </span>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-3 sm:gap-[18px]">
            <p className="mkt-display m-0 text-[19px] leading-[1.3] tracking-[-0.015em] text-accent-fill-foreground sm:text-[26px] sm:leading-[1.25] sm:tracking-[-0.02em]">
              “hey calyxa — I&apos;m stuck on 2b.”
            </p>
            <div className="flex flex-col gap-2 rounded-xl border border-(--mkt-border-faint) bg-(--mkt-desk) p-3 sm:gap-2.5 sm:rounded-[14px] sm:p-4">
              <div className="flex items-center gap-2 rounded-[9px] border border-(--mkt-hairline) bg-background px-[11px] py-2 sm:gap-2.5 sm:rounded-[10px] sm:px-3.5 sm:py-2.5">
                <span className="flex h-[19px] w-[19px] flex-none items-center justify-center rounded-md border border-accent-fill bg-accent-subtle text-[9px] font-semibold text-accent-emphasis sm:h-[22px] sm:w-[22px] sm:rounded-[7px] sm:text-[10.5px]">
                  2b
                </span>
                <span className="mkt-math text-[13px] text-foreground sm:text-[15.5px]">x² − 5x + 6 = 0</span>
                <span className="mx-1 hidden h-px flex-1 bg-(--mkt-hairline-soft) sm:block" />
                <span className="ml-auto text-[9px] text-(--mkt-faint) sm:ml-0 sm:text-[10px]">your page</span>
              </div>
              <div
                className="mkt-glass flex max-w-[270px] items-start gap-[7px] self-center rounded-[15px] px-3 py-[9px] sm:max-w-[340px] sm:gap-2 sm:px-3.5 sm:py-2.5"
                style={{ boxShadow: '0 14px 34px rgba(28,40,30,0.16), 0 2px 8px rgba(28,40,30,0.08)' }}
              >
                <CalyxaMark className="mt-0.5 h-3 w-3 flex-none sm:h-3.5 sm:w-3.5" />
                <div className="flex flex-col gap-[3px] sm:gap-1">
                  <span className="flex items-center gap-1 self-start rounded-full bg-[#fff7ed] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.09em] text-[#9a3412]">
                    ✚&nbsp;Coaching
                  </span>
                  <span className="text-[11.5px] leading-[1.5] text-foreground sm:text-[12.5px]">
                    already looking at 2b — what did you try first?
                  </span>
                </div>
              </div>
            </div>
            <p className="m-0 hidden text-[13.5px] leading-[1.6] text-accent-emphasis sm:block">
              no screenshot, no paste — and it never hands over the answer.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
