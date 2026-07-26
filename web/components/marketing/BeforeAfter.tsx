'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { CalyxaMark } from '@calyxa/ui'

// Landing v6 "Calyxa makes learning simple." (retitled from Landing v5's
// "Skip the copy-paste loop." — Darcy, 2026-07-24; the before/after content is
// unchanged) — the Before card cycles a live
// highlight through its 8 steps every 900ms (step = step % 8 + 1); the After
// card is one sentence on the green wash. Anchored as #how-it-works for the
// nav/footer links.
//
// 2026-07-24 (Darcy): retyped to match SessionShowcase so the two mid-page
// sections read as one family — same display clamp and sub size, the mono
// eyebrow dropped, and the two cards moved inside the same outer card frame
// the session demo uses. The before/after CONTENT is untouched.
//
// 2026-07-25 (Darcy): the section heading + subtitle dropped a whole type tier
// (62px → 34px cap, 22px → 16.5px sub). StudyMaterials carries the same pair of
// clamps — the two mid-page sections stay one family.

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
      className="flex flex-col items-center bg-background px-[22px] py-14 sm:px-11 sm:pb-[110px] sm:pt-[100px]"
    >
      <h2
        className="mkt-display m-0 text-center font-bold text-foreground"
        style={{ fontSize: 'clamp(23px, 2.2vw, 34px)', lineHeight: 1.1, letterSpacing: '-0.025em' }}
      >
        Calyxa makes learning simple.
      </h2>
      <p className="mb-0 mt-2.5 max-w-[52ch] text-pretty text-center text-[14.5px] text-muted-foreground sm:text-[16.5px]">
        one sentence does what used to take eight steps — and this time you actually learn it
      </p>

      <div className="mt-8 grid w-full max-w-[1240px] items-stretch gap-3.5 rounded-[20px] border border-(--mkt-hairline) bg-background p-3.5 sm:mt-11 sm:grid-cols-2 sm:gap-[22px] sm:rounded-[26px] sm:p-[22px]">
        {/* Before */}
        <div className="flex flex-col gap-3 rounded-2xl border border-(--mkt-hairline) bg-background px-[22px] py-[22px] sm:gap-[18px] sm:rounded-[18px] sm:px-9 sm:py-[34px]">
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
          <p className="mt-auto hidden border-t border-(--mkt-hairline) pt-4 text-[15px] font-medium leading-[1.5] text-foreground sm:block">
            ~10 minutes of screenshot-and-paste busywork to hand in an answer you can&apos;t
            explain — you end up{' '}
            <span className="font-bold text-[#8a4106]">cheating and learning nothing</span>.
          </p>
        </div>

        {/* After */}
        <div className="flex flex-col gap-3 rounded-2xl border border-(--calyxa-sage-border) bg-accent-subtle p-5 sm:gap-[18px] sm:rounded-[18px] sm:px-8 sm:py-[30px]">
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
            <OverlayStill />
            <p className="m-0 hidden border-t border-(--calyxa-sage-border) pt-4 text-[15px] font-medium leading-[1.5] text-accent-emphasis sm:block">
              seconds to ask, zero busywork — you think it through and{' '}
              <span className="font-bold text-accent-fill-foreground">
                actually understand the concept your test needs
              </span>
              .
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

// The real extension overlay, mid-sentence — not a generic chat bubble
// (Darcy, 2026-07-24). This mirrors extension/src/overlay/Overlay.tsx the same
// way HeroDemo does: the host page underneath, then ONE dark glass surface
// above the morphing pill, `data-theme="dark"` stamped exactly as the
// extension stamps it so the shared theme.css tokens flip. The pill is in its
// SPEAK shape — mode-tinted waveform plus the live mode name — so the still
// reads as the tutor talking rather than a message that was posted.
const WAVE_HEIGHTS = [11, 18, 22, 15, 9]

function OverlayStill() {
  return (
    <div className="rounded-xl border border-(--mkt-border-faint) bg-(--mkt-desk) p-3 sm:rounded-[14px] sm:p-4">
      {/* the host page: the problem it is looking at, untouched */}
      <div className="flex items-center gap-2 rounded-[9px] border border-(--mkt-hairline) bg-background px-[11px] py-2 sm:gap-2.5 sm:rounded-[10px] sm:px-3.5 sm:py-2.5">
        <span className="flex h-[19px] w-[19px] flex-none items-center justify-center rounded-md border border-accent-fill bg-accent-subtle text-[9px] font-semibold text-accent-emphasis sm:h-[22px] sm:w-[22px] sm:rounded-[7px] sm:text-[10.5px]">
          2b
        </span>
        <span className="mkt-math text-[13px] text-foreground sm:text-[15.5px]">x² − 5x + 6 = 0</span>
        <span className="mx-1 hidden h-px flex-1 bg-(--mkt-hairline-soft) sm:block" />
        <span className="ml-auto text-[9px] text-(--mkt-faint) sm:ml-0 sm:text-[10px]">your page</span>
      </div>

      {/* the overlay itself */}
      <div data-theme="dark" className="mt-3 flex flex-col items-center gap-2.5 sm:mt-4 sm:gap-3.5">
        {/* the single transient surface: the caption it is speaking */}
        <div
          className="flex max-w-[270px] items-start gap-2 rounded-[15px] px-3 py-[9px] sm:max-w-[330px] sm:gap-2.5 sm:rounded-[17px] sm:px-[15px] sm:py-3"
          style={{
            background: 'rgba(24, 26, 23, 0.86)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            backdropFilter: 'blur(22px) saturate(1.5)',
            WebkitBackdropFilter: 'blur(22px) saturate(1.5)',
            boxShadow: '0 18px 44px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.25)',
          }}
        >
          <CalyxaMark aria-hidden="true" className="mt-0.5 h-3 w-3 flex-none sm:h-[15px] sm:w-[15px]" />
          <div className="flex flex-col gap-1 text-left sm:gap-1.5">
            <span
              className="flex items-center gap-1 self-start rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.09em] sm:text-[10px]"
              style={{ color: 'var(--calyxa-mode-coach-text)', background: 'var(--calyxa-mode-coach-bg)' }}
            >
              ✚&nbsp;Coaching
            </span>
            <span className="text-[11.5px] leading-[1.55] text-(--color-foreground) sm:text-[12.5px]">
              already looking at 2b — what did you try first?
            </span>
          </div>
        </div>

        {/* the pill, in its speak shape */}
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
            className="relative flex h-11 w-[178px] items-center justify-center gap-[9px] overflow-hidden rounded-[22px] sm:h-[52px] sm:w-[216px] sm:gap-[11px] sm:rounded-[26px]"
            style={{
              background: 'rgba(24, 26, 23, 0.78)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              backdropFilter: 'blur(24px) saturate(1.5)',
              WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
              boxShadow: '0 18px 44px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.25)',
            }}
          >
            <span
              aria-hidden="true"
              className="mkt-mode-frame"
              style={{ '--mkt-mode-frame-color': 'var(--calyxa-mode-coach-border)' } as CSSProperties}
            />
            <span aria-hidden="true" className="flex h-[22px] items-center gap-[3px]">
              {WAVE_HEIGHTS.map((height, index) => (
                <span
                  key={index}
                  className="mkt-wavebar block w-[3px] rounded-[2px]"
                  style={
                    {
                      height,
                      background: 'var(--calyxa-mode-coach-border)',
                      '--mkt-wave-duration': '0.85s',
                      '--mkt-wave-delay': `${(index * 0.1).toFixed(2)}s`,
                    } as CSSProperties
                  }
                />
              ))}
            </span>
            <span
              className="whitespace-nowrap text-[11px] font-medium sm:text-[13px]"
              style={{ color: 'var(--calyxa-mode-coach-text)' }}
            >
              ✚&nbsp;&nbsp;Coaching
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
