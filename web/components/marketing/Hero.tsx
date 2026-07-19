'use client'

import { useRef } from 'react'
import { HeroDemo, STUCK_QUESTION } from '@/components/marketing/HeroDemo'

// Landing v5 hero: centered H1 + sub + two CTAs over the demo scene, on the
// radial green wash. "See how it works" doesn't scroll anywhere — it fires
// the demo's "stuck" question so the visitor immediately watches a tutor
// exchange. Below the scene, the works-where-your-homework-is platform
// marquee closes the band.

const PLATFORMS: Array<{ name: string; brand: string }> = [
  { name: 'Canvas', brand: '#e2323b' },
  { name: 'MyLab Math', brand: '#9a5cb4' },
  { name: 'Khan Academy', brand: '#14a07a' },
  { name: 'DeltaMath', brand: '#2f9e6f' },
  { name: 'IXL', brand: '#ef7d21' },
  { name: 'WebAssign', brand: '#c8102e' },
  { name: 'a worksheet PDF', brand: '#d0021b' },
]

function PlatformPill({ name, brand, dup }: { name: string; brand: string; dup?: boolean }) {
  return (
    <span
      aria-hidden={dup}
      className={dup ? 'mkt-platform-pill mkt-marquee-dup' : 'mkt-platform-pill'}
      style={{ '--pill': brand } as React.CSSProperties}
    >
      {name}
    </span>
  )
}

// Scroll the demo scene into view. Native smooth scrollIntoView silently
// no-ops on this page (the demo's typing ticks + looping animations cancel
// it — verified in-page; instant scrolling works), so this drives the scroll
// by hand via rAF. Reduced motion jumps instantly.
function scrollDemoIntoView() {
  const demo = document.getElementById('hero-demo')
  if (!demo) return
  const target = Math.max(0, demo.getBoundingClientRect().bottom + window.scrollY - window.innerHeight + 16)
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    window.scrollTo(0, target)
    return
  }
  const start = window.scrollY
  const startTime = performance.now()
  const duration = 600
  const easeOutCubic = (t: number) => 1 - (1 - t) ** 3
  const step = (now: number) => {
    const t = Math.min(1, (now - startTime) / duration)
    window.scrollTo(0, start + (target - start) * easeOutCubic(t))
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

export function Hero({ showPlaceholders }: { showPlaceholders: boolean }) {
  const askRef = useRef<((question: string) => void) | null>(null)

  return (
    <section
      id="hero"
      className="flex flex-col items-center px-[22px] pt-10 sm:px-14 sm:pt-14"
      style={{ background: 'radial-gradient(110% 65% at 50% 0%, #f0fdf4 0%, #ffffff 62%)' }}
    >
      {/* Inline weight: marketing.css's unlayered .mkt-display (600) would
          out-cascade a layered Tailwind font-bold utility. */}
      <h1
        className="mkt-display mkt-h1 m-0 w-full max-w-[1240px] text-balance text-center text-foreground"
        style={{ fontWeight: 700 }}
      >
        Turn AI into your tutor, not your shortcut.
      </h1>
      <p className="mb-0 mt-3.5 max-w-[30ch] text-pretty text-center text-[14.5px] leading-[1.55] text-(--mkt-strip-text) sm:mt-[18px] sm:max-w-[40ch] sm:text-lg">
        it sees the problem on your screen and talks you through it — never the answer
        <span className="max-sm:hidden">, just the step you&apos;re missing</span>.
      </p>
      <div className="mt-[22px] flex w-full flex-col items-center gap-3.5 sm:mt-7 sm:w-auto sm:flex-row">
        <a
          href="/signup"
          className="inline-flex w-full items-center justify-center rounded-[11px] bg-accent-fill px-0 py-3.5 text-[15px] font-semibold text-accent-fill-foreground transition-colors hover:bg-[#6ee7a0] sm:w-auto sm:rounded-xl sm:px-[26px] sm:text-[15.5px]"
          style={{ boxShadow: '0 10px 30px rgba(28,40,30,0.16)' }}
        >
          Add to Chrome — free
        </a>
        <button
          type="button"
          onClick={() => {
            askRef.current?.(STUCK_QUESTION)
            // The scene sits below the fold — bring it into view so the
            // exchange it just fired is actually watchable.
            scrollDemoIntoView()
          }}
          className="hidden cursor-pointer items-center rounded-xl border border-[#79766e] bg-transparent px-[26px] py-3.5 text-[15.5px] font-semibold text-foreground transition-colors hover:bg-(--calyxa-board-bg) sm:inline-flex"
        >
          See how it works
        </button>
      </div>

      <HeroDemo askRef={askRef} showPlaceholders={showPlaceholders} />

      {/* works-where-your-homework-is strip */}
      <div className="flex w-full flex-col items-center gap-[11px] py-8 sm:gap-3.5 sm:pb-11 sm:pt-11">
        <p className="mkt-eyebrow m-0 text-(--mkt-faint)">
          <span className="max-sm:hidden">works where your homework already is</span>
          <span className="sm:hidden">works where your homework is</span>
        </p>
        <ul className="sr-only">
          {PLATFORMS.map((platform) => (
            <li key={platform.name}>{platform.name}</li>
          ))}
        </ul>
        <div aria-hidden="true" className="mkt-marquee mkt-marquee-fast w-full max-w-[900px]">
          <div className="mkt-marquee-track">
            {PLATFORMS.map((platform) => (
              <PlatformPill key={platform.name} name={platform.name} brand={platform.brand} />
            ))}
            {PLATFORMS.map((platform) => (
              <PlatformPill key={`dup-${platform.name}`} name={platform.name} brand={platform.brand} dup />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
