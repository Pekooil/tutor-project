'use client'

import { useEffect, useRef, useState } from 'react'
import { CalyxaMark } from '@calyxa/ui'

// Landing v5 "Everything a tutor does, in one session." — a pill tab bar
// (Annotations / Voice / Study kits) auto-rotating every 5s with a 2px
// progress bar in the active tab; a manual click pauses auto-rotate for 9s.
// The mocks deliberately stay on the quadratic x²+5x+6 example while the
// hero shows the trig problem (handoff: intentional). Desktop panels are a
// 5fr/7fr copy+mock grid; mobile swaps the h3+paragraph for one short
// centered line above the mock.

type FeatureTab = 'ann' | 'voice' | 'kits'

const TABS: Array<{ id: FeatureTab; label: string }> = [
  { id: 'ann', label: 'Annotations' },
  { id: 'voice', label: 'Voice' },
  { id: 'kits', label: 'Study kits' },
]

const NEXT_TAB: Record<FeatureTab, FeatureTab> = { ann: 'voice', voice: 'kits', kits: 'ann' }

function ModeChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1 self-start rounded-full bg-[#fff7ed] px-2 py-[3px] text-[9px] font-semibold uppercase tracking-[0.09em] text-[#9a3412] sm:px-[9px] sm:text-[10px]">
      {children}
    </span>
  )
}

// The glass reply bubble the annotation + voice mocks share.
function GlassBubble({
  icon,
  children,
  className = '',
}: {
  icon: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`mkt-glass flex items-start gap-2 rounded-[17px] px-[13px] py-2.5 sm:gap-2.5 sm:px-[17px] sm:py-[13px] ${className}`}
      style={{ boxShadow: '0 18px 44px rgba(28,40,30,0.18), 0 2px 8px rgba(28,40,30,0.08)' }}
    >
      {icon}
      {children}
    </div>
  )
}

// The light mode pill (waveform + label) under each mock.
function ModePill({ waveColor, waveDuration, label, labelColor, glow }: {
  waveColor: string
  waveDuration: string
  label: string
  labelColor: string
  glow: string
}) {
  return (
    <div className="relative">
      <div
        className="pointer-events-none absolute -inset-[9px] rounded-full"
        style={{ background: glow, filter: 'blur(10px)', opacity: 0.65 }}
        aria-hidden="true"
      >
        <span className="mkt-breathe block h-full w-full" />
      </div>
      <div
        className="relative flex h-11 items-center gap-[9px] whitespace-nowrap rounded-[22px] border border-(--mkt-glass-border) px-[18px] sm:h-13 sm:gap-[11px] sm:rounded-[26px] sm:px-[22px]"
        style={{
          background: 'rgba(255,255,255,0.8)',
          backdropFilter: 'blur(24px) saturate(1.5)',
          WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
          boxShadow: '0 18px 44px rgba(28,40,30,0.18), 0 2px 8px rgba(28,40,30,0.08)',
        }}
      >
        <span aria-hidden="true" className="flex h-4 items-center gap-[3px] sm:h-5">
          {['h-2 sm:h-2.5', 'h-[13px] sm:h-4', 'h-4 sm:h-5', 'h-[11px] sm:h-3.5', 'h-[7px] sm:h-2'].map(
            (heightClass, index) => (
              <span
                key={index}
                className={`mkt-wavebar block w-[3px] rounded-[2px] ${heightClass}`}
                style={
                  {
                    background: waveColor,
                    '--mkt-wave-duration': waveDuration,
                    '--mkt-wave-delay': `${(index * 0.12).toFixed(2)}s`,
                  } as React.CSSProperties
                }
              />
            )
          )}
        </span>
        <span className="text-[11.5px] font-medium sm:text-[13px]" style={{ color: labelColor }}>
          {label}
        </span>
      </div>
    </div>
  )
}

function AnnotationsMock() {
  return (
    <div className="overflow-hidden rounded-[14px] border border-(--mkt-hairline) bg-(--mkt-desk) shadow-[0_18px_44px_-14px_rgba(28,40,30,0.16)] sm:rounded-[20px] sm:border-(--mkt-hairline) sm:p-7 sm:pb-8 sm:shadow-none">
      <div className="overflow-hidden bg-background sm:rounded-[14px] sm:border sm:border-(--mkt-hairline) sm:shadow-[0_24px_60px_-18px_rgba(28,40,30,0.16)]">
        <div className="flex items-center gap-2.5 border-b border-(--mkt-hairline-soft) bg-(--calyxa-board-bg) px-3 py-[9px] sm:gap-3.5 sm:px-[18px] sm:py-3">
          <span className="flex gap-[5px] sm:gap-1.5">
            <span className="h-2 w-2 rounded-full bg-(--mkt-hairline) sm:h-2.5 sm:w-2.5" />
            <span className="h-2 w-2 rounded-full bg-(--mkt-hairline) sm:h-2.5 sm:w-2.5" />
            <span className="hidden h-2.5 w-2.5 rounded-full bg-(--mkt-hairline) sm:block" />
          </span>
          <span className="flex flex-1 items-center rounded-full border border-(--mkt-hairline-soft) bg-background px-2.5 py-[3px] text-[9.5px] text-(--mkt-faint) sm:max-w-[320px] sm:px-[13px] sm:py-1 sm:text-[11px]">
            <span className="max-sm:hidden">mathpath.example.edu/unit-4</span>
            <span className="sm:hidden">mathpath.example.edu</span>
          </span>
          <span className="ml-auto flex items-center gap-1 rounded-full border border-(--calyxa-sage-border) bg-accent-subtle px-2 py-[3px] text-[9px] font-semibold text-accent-emphasis sm:gap-1.5 sm:px-2.5 sm:py-1 sm:text-[10.5px]">
            <CalyxaMark className="hidden h-[11px] w-[11px] sm:block" />
            calyxa active
          </span>
        </div>
        <div className="px-4 pb-[26px] pt-6 sm:px-[46px] sm:pb-[34px] sm:pt-[38px]">
          <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground sm:text-[10.5px]">
            Problem 2 · factor
          </span>
          <div className="mb-10 mt-9 flex justify-center sm:mb-13 sm:mt-12">
            <span className="mkt-math relative whitespace-nowrap text-[21px] text-foreground sm:text-4xl">
              x² +{' '}
              <span className="relative inline-block">
                5x
                <svg
                  className="absolute -left-2 -top-1.5 h-[calc(100%+12px)] w-[calc(100%+16px)] overflow-visible sm:-left-[11px] sm:-top-[9px] sm:h-[calc(100%+18px)] sm:w-[calc(100%+22px)]"
                  aria-hidden="true"
                >
                  <ellipse cx="50%" cy="50%" rx="49%" ry="47%" fill="rgba(180,83,9,0.07)" stroke="#b45309" strokeWidth="2.5" />
                </svg>
                <span className="absolute -top-[34px] left-1/2 flex h-[21px] -translate-x-1/2 items-center whitespace-nowrap rounded-full border border-[#f0e0bc] bg-[#fbf3e4] px-[9px] font-sans text-[10px] font-semibold text-[#8a4106] sm:-top-[46px] sm:h-[26px] sm:px-3 sm:text-[12.5px]">
                  they add to +5
                </span>
              </span>{' '}
              +{' '}
              <span className="relative inline-block">
                6
                <svg
                  className="absolute -left-[9px] -top-1.5 h-[calc(100%+12px)] w-[calc(100%+18px)] overflow-visible sm:-left-[13px] sm:-top-[9px] sm:h-[calc(100%+18px)] sm:w-[calc(100%+26px)]"
                  aria-hidden="true"
                >
                  <ellipse cx="50%" cy="50%" rx="49%" ry="47%" fill="rgba(134,239,172,0.14)" stroke="#3fd07a" strokeWidth="2.5" />
                </svg>
                <span className="absolute -bottom-[34px] left-1/2 flex h-[21px] -translate-x-1/2 items-center whitespace-nowrap rounded-full border border-(--calyxa-sage-border) bg-accent-subtle px-[9px] font-sans text-[10px] font-semibold text-accent-emphasis sm:-bottom-[46px] sm:h-[26px] sm:px-3 sm:text-[12.5px]">
                  they multiply to +6
                </span>
              </span>{' '}
              = 0
            </span>
          </div>
          <div className="flex flex-col items-center gap-[11px] sm:gap-3.5">
            <GlassBubble
              className="max-w-[440px]"
              icon={<CalyxaMark className="mt-0.5 h-[15px] w-[15px] flex-none sm:h-[17px] sm:w-[17px]" />}
            >
              <div className="flex flex-col gap-[5px] sm:gap-1.5">
                <ModeChip>✚&nbsp;Coaching</ModeChip>
                <span className="text-[11.5px] leading-[1.55] text-foreground sm:text-[13.5px]">
                  you&apos;re looking for two numbers that do both jobs at once. what pair could that be?
                </span>
              </div>
            </GlassBubble>
            <ModePill
              waveColor="#fdba74"
              waveDuration="0.85s"
              label="✚  Coaching"
              labelColor="#9a3412"
              glow="radial-gradient(closest-side, #fed7aa 0%, #fdba74 48%, transparent 74%)"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function VoiceMock() {
  return (
    <div className="flex flex-col items-center gap-[11px] rounded-2xl border border-(--mkt-hairline) bg-(--mkt-desk) px-4 pb-6 pt-[26px] sm:gap-3.5 sm:rounded-[20px] sm:px-10 sm:pb-[38px] sm:pt-11">
      <GlassBubble
        className="max-w-[290px] sm:max-w-[420px]"
        icon={
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="#6b6b65"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
            className="mt-[3px] w-[13px] flex-none sm:w-[15px]"
          >
            <path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z" />
            <path d="M6 11a6 6 0 0 0 12 0" />
            <path d="M12 17v3" />
          </svg>
        }
      >
        <div className="flex flex-col gap-0.5 sm:gap-[3px]">
          <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground sm:text-[10px]">
            You
          </span>
          <p className="m-0 text-[12.5px] leading-[1.55] text-foreground sm:text-sm">
            why is it negative two and not two?<span className="max-sm:hidden"> the six is positive…</span>
          </p>
        </div>
      </GlassBubble>
      <GlassBubble
        className="max-w-[300px] sm:max-w-[440px]"
        icon={<CalyxaMark className="mt-0.5 h-[15px] w-[15px] flex-none sm:h-[17px] sm:w-[17px]" />}
      >
        <div className="flex flex-col gap-[5px] sm:gap-1.5">
          <ModeChip>✚&nbsp;Coaching</ModeChip>
          <span className="text-[12.5px] leading-[1.55] text-foreground sm:text-sm">
            exactly — <span className="max-sm:hidden">say it out loud: </span>the six is positive, so what must the{' '}
            <span className="font-medium text-accent-emphasis">signs</span> have in common?
          </span>
          <span className="text-[10.5px] text-(--mkt-faint) sm:text-[11.5px]">
            <span className="max-sm:hidden">spoken aloud · replies in under 2.5s</span>
            <span className="sm:hidden">spoken aloud · under 2.5s</span>
          </span>
        </div>
      </GlassBubble>
      <ModePill
        waveColor="#1c1c1a"
        waveDuration="1s"
        label="Listening"
        labelColor="#6b6b65"
        glow="radial-gradient(closest-side, #bbf7d0 0%, #4ade80 48%, transparent 74%)"
      />
    </div>
  )
}

function KitsMock() {
  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <div className="flex flex-col gap-2.5 rounded-[14px] border border-(--calyxa-sage-border) bg-(--calyxa-board-bg) px-5 py-[18px] shadow-[0_0_0_3px_rgba(134,239,172,0.14)] sm:gap-3.5 sm:rounded-[18px] sm:px-7 sm:py-[26px] sm:shadow-[0_0_0_4px_rgba(134,239,172,0.14),0_16px_40px_-14px_rgba(28,40,30,0.18)]">
        <span className="self-start rounded-full border border-(--calyxa-sage-border) bg-accent-subtle px-[9px] py-[3px] text-[9.5px] font-semibold uppercase tracking-[0.08em] text-accent-emphasis sm:px-2.5 sm:py-1 sm:text-[10.5px]">
          practice · 5 problems
        </span>
        <span className="text-[13.5px] font-semibold tracking-[-0.01em] text-foreground sm:text-[15.5px]">
          Sign errors on roots
        </span>
        <div className="flex flex-col gap-2 sm:gap-2.5">
          <span className="mkt-math text-sm text-foreground sm:text-[17px]">1.&nbsp; x² − 3x − 10 = 0</span>
          <span className="mkt-math hidden text-[17px] text-(--mkt-faint) sm:block">2.&nbsp; x² + x − 12 = 0</span>
          <span className="text-[10.5px] text-(--mkt-faint) sm:text-[11.5px]">
            …because this is the slip you actually made.
          </span>
        </div>
      </div>
      <div className="flex gap-3 max-sm:flex-row sm:grid sm:grid-cols-2 sm:gap-4">
        <div className="flex flex-1 flex-col gap-2 rounded-[14px] border border-(--mkt-hairline) bg-(--calyxa-board-bg) p-4 sm:gap-3.5 sm:rounded-[18px] sm:px-7 sm:py-[26px]">
          <span className="self-start rounded-full border border-(--mkt-hairline) bg-[#f7f7f5] px-[9px] py-[3px] text-[9.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:px-2.5 sm:py-1 sm:text-[10.5px]">
            notes
          </span>
          <span className="text-xs font-semibold leading-[1.4] text-foreground sm:text-[15.5px] sm:tracking-[-0.01em]">
            Factoring quadratics — your session
          </span>
          <div className="hidden flex-col gap-2 text-[13px] leading-[1.5] text-(--mkt-strip-text) sm:flex">
            <span>
              · the pair has to multiply to c <span className="font-medium text-foreground">and</span> add to b
            </span>
            <span>· positive c → same signs; the sign of b picks which</span>
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-2 rounded-[14px] border border-(--mkt-hairline) bg-(--calyxa-board-bg) p-4 sm:gap-3.5 sm:rounded-[18px] sm:px-7 sm:py-[26px]">
          <span className="self-start rounded-full border border-(--mkt-hairline) bg-[#f7f7f5] px-[9px] py-[3px] text-[9.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:px-2.5 sm:py-1 sm:text-[10.5px]">
            flashcards · 8
          </span>
          <span className="text-xs font-semibold leading-[1.4] text-foreground sm:text-[15.5px] sm:tracking-[-0.01em]">
            Quick checks before the test
          </span>
          <div className="mt-0.5 hidden flex-col gap-1.5 rounded-xl border border-(--mkt-hairline-soft) bg-background px-4 py-3.5 sm:flex">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-(--mkt-faint)">card 1 of 8</span>
            <span className="text-[13px] leading-[1.5] text-foreground">
              if the product is positive and the sum is negative, the signs are…
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

const PANELS: Record<
  FeatureTab,
  { heading: string; body: string; mobileBody: string; mock: () => React.ReactNode }
> = {
  ann: {
    heading: 'It draws on the problem itself.',
    body: "labeled marks on the terms it's talking about, and a why-note for the step — on the page you already have open. when it says “the middle term,” you can see exactly which term it means.",
    mobileBody: 'labeled marks and a why-note — on the page you already have open.',
    mock: AnnotationsMock,
  },
  voice: {
    heading: 'Talk it through out loud.',
    body: 'you think out loud. it listens, answers in its own voice, and the live transcript keeps up — most sessions never touch the keyboard.',
    mobileBody: 'you think out loud. it answers in its own voice — the transcript keeps up.',
    mock: VoiceMock,
  },
  kits: {
    heading: 'Every session leaves a kit behind.',
    body: 'notes, practice problems, and flashcards — built from what you got wrong, not from a generic worksheet.',
    mobileBody: 'notes, practice problems, and flashcards — built from what you got wrong.',
    mock: KitsMock,
  },
}

export function Features() {
  const [tab, setTab] = useState<FeatureTab>('ann')
  const manualAtRef = useRef(0)

  useEffect(() => {
    const rotate = setInterval(() => {
      if (Date.now() - manualAtRef.current < 9000) return
      setTab((current) => NEXT_TAB[current])
    }, 5000)
    return () => clearInterval(rotate)
  }, [])

  const panel = PANELS[tab]

  return (
    <section className="flex flex-col items-center bg-background px-[22px] py-14 sm:px-20 sm:py-28">
      <p className="mkt-eyebrow m-0">one session</p>
      <h2 className="mkt-display mkt-h2-sm mb-0 mt-3 text-center text-foreground sm:mt-4">
        Everything a tutor does, in one session.
      </h2>
      <p className="mb-0 mt-4 hidden max-w-[56ch] text-pretty text-center text-[16.5px] leading-[1.6] text-(--mkt-strip-text) sm:block">
        it draws on the problem itself, talks you through it out loud, and leaves a study kit behind when you&apos;re
        done.
      </p>

      <div
        role="tablist"
        aria-label="Feature"
        className="mt-[18px] flex gap-1 rounded-full border border-(--mkt-hairline) bg-(--calyxa-board-bg) p-1 sm:mt-9"
      >
        {TABS.map(({ id, label }) => {
          const active = id === tab
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                manualAtRef.current = Date.now()
                setTab(id)
              }}
              className={`relative cursor-pointer overflow-hidden rounded-full px-[13px] py-1.5 text-[11.5px] font-semibold sm:px-[18px] sm:py-2 sm:text-[13.5px] ${
                active ? 'bg-accent-fill text-accent-fill-foreground' : 'text-muted-foreground'
              }`}
            >
              {label}
              {/* keyed so the progress bar restarts on every activation */}
              {active && <span key={`${id}-prog`} className="mkt-tabprog w-full" aria-hidden="true" />}
            </button>
          )
        })}
      </div>

      <div className="mt-5 w-full max-w-[1100px] sm:mt-12">
        <p className="mb-3 mt-0 text-center text-[13px] leading-[1.6] text-(--mkt-strip-text) sm:hidden">
          {panel.mobileBody}
        </p>
        <div className="grid items-center gap-4 sm:grid-cols-[5fr_7fr] sm:gap-16">
          <div className="hidden flex-col items-start gap-4 sm:flex">
            <h3 className="mkt-display mkt-h3 m-0 text-foreground">{panel.heading}</h3>
            <p className="m-0 text-pretty text-base leading-[1.65] text-(--mkt-strip-text)">{panel.body}</p>
          </div>
          <div>{panel.mock()}</div>
        </div>
      </div>
    </section>
  )
}
