'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CalyxaMark } from '@calyxa/ui'
import { HeroDemo } from '@/components/marketing/HeroDemo'

// useLayoutEffect warns during SSR; fall back to useEffect on the server so the
// scale-to-fit measurement stays flash-free on the client without the warning.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

// Hero (design_handoff_calyxa_hero_2a, 2026-07-20): the design's hero content
// — top nav, the "Featured on Product Hunt" copy block, and the bottom motion
// layer (flowing student questions along an invisible curve, the live
// voice/mode pill cycling the 8 tutor modes every 3s, and the platform chips
// flowing out along a second curve) — rendered full-bleed as part of the page
// (the design's grey frame / rounded card / shadow are intentionally dropped;
// only the green wash remains, spanning the page width). Because every
// coordinate in the motion layer is authored against the design's 1440-wide
// frame, the content renders at its exact design size and is uniformly scaled
// to fit the viewport width (identical proportions at any width). Everything
// from the Mac-mockup live demo down (HeroDemo + the
// works-where-your-homework-is marquee) is unchanged — it just moves below
// this hero.

// The 8 tutor modes (extension/src/overlay/tutor-modes.ts) + their light-theme
// --calyxa-mode-*-border tokens, cycled in order every 3000ms.
const MODES = [
  { name: 'Exploring', glyph: '✧', border: '#7dd3fc' },
  { name: 'Coaching', glyph: '✚', border: '#fdba74' },
  { name: 'Building', glyph: '▲', border: '#c4b5fd' },
  { name: 'Practicing', glyph: '●', border: '#4ade80' },
  { name: 'Challenging', glyph: '◆', border: '#f0abfc' },
  { name: 'Verifying', glyph: '✓', border: '#5eead4' },
  { name: 'Reviewing', glyph: '↺', border: '#a5b4fc' },
  { name: 'Recovering', glyph: '♡', border: '#fda4af' },
] as const

// The three incoming questions ride #cxpath2a, evenly offset by 33.3%.
const FLOW = [
  { text: 'the slope is rise over run, right?', phase: '0' },
  { text: 'can you check where my signs flipped…', phase: '33.3' },
  { text: "what's a negative minus a negative?", phase: '66.6' },
] as const

// The 7 platform chips, distributed at exact 1/7 phase intervals along
// #cxchips2a. `c` is the platform accent fed to the color-mix soft tint.
const CHIPS = [
  { name: 'Canvas', c: '#e2323b', phase: 0 },
  { name: 'Khan Academy', c: '#14a07a', phase: 0.1429 },
  { name: 'MyLab Math', c: '#9a5cb4', phase: 0.2857 },
  { name: 'DeltaMath', c: '#2f9e6f', phase: 0.4286 },
  { name: 'WebAssign', c: '#c8102e', phase: 0.5714 },
  { name: 'AP Classroom', c: '#0077c8', phase: 0.7143 },
  { name: 'Google Classroom', c: '#0f9d58', phase: 0.8571 },
] as const

const NAV_LINKS = [
  { label: 'how it works', href: '#how-it-works' },
  { label: 'pricing', href: '#pricing' },
  { label: 'log in', href: '/login' },
]

const FLOW_SPEED = 26 // seconds — loop duration for the flowing text; chips run at ×1.4
const GLOW_INTENSITY = 0.95 // opacity of the mode pill's glow halo

const CARD_W = 1440
const CARD_H = 880

// One primary-CTA style shared by the nav pill and the hero CTA (values are
// each element's own; this only carries the accent hover, applied inline so it
// beats no layered utility). Kept as constants so both call sites match.
const ACCENT = '#86efac'
const ACCENT_HOVER = '#6ee7a0'

export function Hero({ showPlaceholders }: { showPlaceholders: boolean }) {
  const [modeIdx, setModeIdx] = useState(0)
  const [scale, setScale] = useState(1)
  const rootRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const askRef = useRef<((question: string) => void) | null>(null)

  const mode = MODES[modeIdx]
  const modeGlow = `radial-gradient(closest-side,${mode.border} 0%,${mode.border} 48%,transparent 74%)`

  // Uniform scale-to-fit: the card is authored at 1440×880, so scale it to the
  // stage's available width and reserve the scaled height in layout so the
  // demo below flows right after it.
  useIsomorphicLayoutEffect(() => {
    // Scale to fill the full viewport width at any size — uncapped, so on
    // screens wider than the 1440 design frame the flowing text + platform
    // chips still run to the real screen edges instead of clipping inset.
    const measure = () => {
      const avail = stageRef.current?.clientWidth ?? CARD_W
      setScale(avail / CARD_W)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // Mode cycling every 3s.
  useEffect(() => {
    const timer = setInterval(() => setModeIdx((i) => (i + 1) % MODES.length), 3000)
    return () => clearInterval(timer)
  }, [])

  // A single rAF loop drives both the flowing text and the flowing chips, by
  // mutating DOM directly (no per-frame React state). Queries are scoped to the
  // component root. Frozen at phase offsets under prefers-reduced-motion.
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    const dur = FLOW_SPEED * 1000
    const chipDur = dur * 1.4
    const tick = (now: number) => {
      const scope = rootRef.current
      if (scope) {
        scope.querySelectorAll<SVGTextPathElement>('.cx-flow').forEach((tp) => {
          const phase = parseFloat(tp.dataset.phase || '0')
          if (reduced) {
            tp.setAttribute('startOffset', `${phase}%`)
          } else {
            const t = (now % dur) / dur
            tp.setAttribute('startOffset', `${((t * 100 + phase) % 100).toFixed(2)}%`)
          }
        })
        scope.querySelectorAll<HTMLElement>('.cx-chip').forEach((chip) => {
          const path = scope.querySelector<SVGPathElement>(`#${chip.dataset.path}`)
          if (!path) return
          const len = path.getTotalLength()
          const phase = parseFloat(chip.dataset.phase || '0')
          const t = reduced ? phase : (now / chipDur + phase) % 1
          const p = path.getPointAtLength(t * len)
          const p2 = path.getPointAtLength(Math.min(len, t * len + 24))
          const ang = (Math.atan2(p2.y - p.y, p2.x - p.x) * 180) / Math.PI
          chip.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px) translate(-50%,-50%) rotate(${ang.toFixed(1)}deg)`
        })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <>
      {/* Full-bleed hero: the design's green wash spans the page width (no grey
          frame, no rounded card, no shadow) so the hero reads as part of the
          site. The 1440-wide content is centered and scaled to fit. */}
      <div
        ref={stageRef}
        className="flex justify-center overflow-hidden"
        style={{
          background:
            'radial-gradient(80rem 40rem at 50% -14rem, rgba(187,247,208,0.55), rgba(240,253,244,0.5) 42%, transparent 72%), #ffffff',
        }}
      >
        {/* Height reservation for the scaled card so the demo flows below it. */}
        <div style={{ width: CARD_W * scale, height: CARD_H * scale, flex: 'none' }}>
          <div
            ref={rootRef}
            style={{
              position: 'relative',
              width: CARD_W,
              height: CARD_H,
              flex: 'none',
              overflow: 'hidden',
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          >
            {/* Top navigation bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 36, padding: '24px 56px' }}>
              <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 9, color: 'inherit' }}>
                <CalyxaMark style={{ width: 26, height: 26 }} />
                <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em', color: '#1c1c1a' }}>
                  calyxa
                </span>
              </a>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 30 }}>
                {NAV_LINKS.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    style={{ fontSize: 14.5, fontWeight: 500, color: '#55554f', textDecoration: 'none' }}
                  >
                    {link.label}
                  </a>
                ))}
                <a
                  href="/signup"
                  onMouseEnter={(e) => (e.currentTarget.style.background = ACCENT_HOVER)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = ACCENT)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    background: ACCENT,
                    color: '#14532d',
                    fontSize: 14,
                    fontWeight: 600,
                    padding: '10px 20px',
                    borderRadius: 999,
                    textDecoration: 'none',
                    boxShadow: '0 6px 18px rgba(28,40,30,0.14)',
                  }}
                >
                  Add to Chrome — free
                </a>
              </div>
            </div>

            {/* Centered hero copy block */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                paddingTop: 84,
                position: 'relative',
                zIndex: 2,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ fontSize: 16, color: '#55554f' }}>Featured on</span>
                <svg viewBox="0 0 24 24" style={{ width: 22, height: 22 }} aria-hidden="true">
                  <path fill="#da552f" d="M12 0C5.372 0 0 5.372 0 12s5.372 12 12 12 12-5.372 12-12S18.628 0 12 0z" />
                  <path
                    fill="#ffffff"
                    d="M13.6 8H8.8v8h1.87v-2.4h2.93a2.8 2.8 0 100-5.6zm0 3.73h-2.93v-1.86h2.93a.93.93 0 010 1.86z"
                  />
                </svg>
                <span style={{ fontSize: 16.5, fontWeight: 600, color: '#1c1c1a' }}>Product Hunt</span>
              </div>
              <h1
                style={{
                  margin: '22px 0 0',
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  fontSize: 72,
                  lineHeight: 1.02,
                  letterSpacing: '-0.032em',
                  textAlign: 'center',
                  whiteSpace: 'nowrap',
                  color: '#1c1c1a',
                }}
              >
                Stop copying. Start learning.
              </h1>
              <p
                style={{
                  margin: '20px 0 0',
                  fontSize: 20,
                  lineHeight: 1.5,
                  color: '#55554f',
                  textAlign: 'center',
                  maxWidth: 640,
                  textWrap: 'pretty',
                }}
              >
                Your Adaptive AI tutor that teaches directly on any homework, website, or PDF.
              </p>
              <a
                href="/signup"
                onMouseEnter={(e) => (e.currentTarget.style.background = ACCENT_HOVER)}
                onMouseLeave={(e) => (e.currentTarget.style.background = ACCENT)}
                style={{
                  marginTop: 34,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                  background: ACCENT,
                  color: '#14532d',
                  fontSize: 17,
                  fontWeight: 600,
                  padding: '17px 34px',
                  borderRadius: 999,
                  border: '1px solid rgba(20,83,45,0.18)',
                  textDecoration: 'none',
                  boxShadow: '0 14px 36px rgba(28,40,30,0.18), 0 2px 8px rgba(28,40,30,0.08)',
                }}
              >
                Add to Chrome — free
              </a>
            </div>

            {/* Bottom motion layer */}
            <div style={{ position: 'absolute', inset: 'auto 0 0 0', height: 360, pointerEvents: 'none' }}>
              <svg
                viewBox="0 0 1440 360"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}
                aria-hidden="true"
              >
                <path id="cxpath2a" d="M -220,60 C 100,10 300,150 480,112 C 540,90 601,92 648,97" fill="none" stroke="none" />
                {FLOW.map((line) => (
                  <text
                    key={line.phase}
                    style={{ fontFamily: 'var(--font-geist-sans), sans-serif', fontSize: 15.5, fill: '#9b988f', letterSpacing: '0.01em' }}
                  >
                    <textPath href="#cxpath2a" className="cx-flow" data-phase={line.phase} startOffset={`${line.phase}%`}>
                      {line.text}
                    </textPath>
                  </text>
                ))}
                <path
                  id="cxchips2a"
                  d="M 832,94 C 950,102 1060,132 1165,180 C 1268,227 1368,282 1460,338 C 1544,389 1628,434 1710,472"
                  fill="none"
                  stroke="none"
                />
              </svg>

              {/* Live mode pill (the product cameo) */}
              <div style={{ position: 'absolute', left: 612, bottom: 240, zIndex: 3 }}>
                {/* Bigger/stronger ambient glow (Darcy's ask): the app's tight
                    -1/blur-10 halo, expanded to a broad mode-tinted wash and
                    with the gradient moved onto the breathing span so the
                    scale pulse actually reads. Same gradient + cxBreathePill
                    keyframe the extension pill uses. */}
                <div
                  className="cx-glow"
                  style={{
                    position: 'absolute',
                    inset: -28,
                    borderRadius: 99,
                    filter: 'blur(26px)',
                    opacity: GLOW_INTENSITY,
                    transition: 'opacity 0.6s ease',
                    pointerEvents: 'none',
                  }}
                >
                  <span
                    className="cx-anim"
                    style={{
                      display: 'block',
                      width: '100%',
                      height: '100%',
                      borderRadius: 99,
                      background: modeGlow,
                      animation: 'cxBreathePill 3s ease-in-out infinite',
                    }}
                  />
                </div>
                <div
                  style={{
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 11,
                    width: 216,
                    height: 52,
                    borderRadius: 26,
                    background: 'rgba(24,26,23,0.78)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    backdropFilter: 'blur(24px) saturate(1.5)',
                    WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
                    boxShadow: '0 18px 44px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.35)',
                  }}
                >
                  {/* Animated border sheen */}
                  <span
                    className="cx-anim"
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      borderRadius: 'inherit',
                      padding: 2,
                      background: `linear-gradient(130deg, ${mode.border}, transparent 42%, transparent 58%, ${mode.border})`,
                      WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                      WebkitMaskComposite: 'xor',
                      maskComposite: 'exclude',
                      pointerEvents: 'none',
                      opacity: 0.5,
                      animation: 'cxModeBreathe 3.2s ease-in-out infinite',
                    }}
                  />
                  {/* Waveform */}
                  <span style={{ display: 'flex', alignItems: 'center', gap: 3, height: 22 }}>
                    {[
                      { h: 11, d: '0s' },
                      { h: 18, d: '0.12s' },
                      { h: 22, d: '0.24s' },
                      { h: 15, d: '0.36s' },
                      { h: 9, d: '0.48s' },
                    ].map((bar, i) => (
                      <span
                        key={i}
                        className="cx-anim"
                        style={{
                          width: 3,
                          height: bar.h,
                          borderRadius: 2,
                          background: mode.border,
                          animation: `cxWave 0.85s ease-in-out ${bar.d} infinite`,
                        }}
                      />
                    ))}
                  </span>
                  {/* Match the extension pill's label exactly: the glyph must
                      render in the overlay's --font-sans system stack (theme.css),
                      not the marketing body font — same symbol, but Geist drew it
                      differently. 13px / 500, the app's speak-state values. */}
                  <span
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontSize: 13,
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                      color: mode.border,
                    }}
                  >
                    {mode.glyph}
                    &nbsp;&nbsp;
                    {mode.name}
                  </span>
                </div>
              </div>

              {/* Flowing platform chips */}
              {CHIPS.map((chip) => (
                <div
                  key={chip.name}
                  className="cx-chip"
                  data-path="cxchips2a"
                  data-phase={chip.phase}
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    willChange: 'transform',
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '7px 15px',
                    borderRadius: 999,
                    background: `color-mix(in srgb, ${chip.c} 11%, #ffffff)`,
                    border: `1px solid color-mix(in srgb, ${chip.c} 30%, #ffffff)`,
                    boxShadow: '0 6px 18px rgba(28,28,26,0.08)',
                    fontSize: 13,
                    fontWeight: 600,
                    color: `color-mix(in srgb, ${chip.c} 62%, #1c1c1a)`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {chip.name}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* The Mac-mockup live demo, moved down beneath the hero. A scaled
          negative margin lifts it up so the top of the Mac demo peeks in just
          under the flowing hero; a transparent background lets the hero's
          flowing chips show through the small overlap instead of being
          covered. (The works-where-your-homework-is eyebrow + platform-pill
          marquee that used to close this band were removed 2026-07-20.) */}
      <section
        id="hero-demo-section"
        className="relative z-10 flex flex-col items-center px-[22px] sm:px-14"
        style={{ marginTop: -Math.round(120 * scale) }}
      >
        <HeroDemo askRef={askRef} showPlaceholders={showPlaceholders} />
      </section>
    </>
  )
}
