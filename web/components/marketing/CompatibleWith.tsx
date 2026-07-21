'use client'

import { useEffect, useRef, useState } from 'react'

// "COMPATIBLE WITH" + a single rotating platform pill, sitting to the right of
// the Product Hunt badge in the hero badge row (2026-07-21).
//
// The pill is the same one the removed hero motion layer used to fly along a
// curve — brand-tinted soft fill, brand-tinted border, name only — just scaled
// up to sit at the Product Hunt badge's weight. Name-only by design: no brand
// logos are used, so there are no third-party brand assets in the bundle and
// nothing is redrawn or approximated.
//
// Swaps are an odometer flip (keyframes in marketing.css): the outgoing pill
// turns up and away over the top edge while the incoming one rises from below
// and flips into place. Both are mounted at once on stacked layers for the
// duration of the flip.

export type Platform = {
  /** Platform name, exactly as the platform writes it. */
  name: string
  /** Brand accent, fed to the color-mix soft tint + border. */
  color: string
}

const ROTATE_MS = 2600
const FLIP_MS = 420

// The pill sits in a fixed-width slot so the centered badge row never shifts
// as names of different lengths swap through. Sized to the widest name
// ("Google Classroom") with a little slack.
const SLOT_W = 258
const PILL_H = 54

export function CompatibleWith({ platforms }: { platforms: Platform[] }) {
  const [idx, setIdx] = useState(0)
  // The pill being flipped out, kept mounted for the length of the flip.
  const [outgoing, setOutgoing] = useState<number | null>(null)
  // Suppresses the flip-in animation on first paint — the pill should just be
  // there on load, not flip in from nowhere.
  const [started, setStarted] = useState(false)
  const [reduced, setReduced] = useState(false)
  const clearRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  }, [])

  useEffect(() => {
    if (platforms.length < 2) return
    const tick = setInterval(() => {
      setIdx((i) => {
        const next = (i + 1) % platforms.length
        if (!reduced) {
          setOutgoing(i)
          setStarted(true)
          window.clearTimeout(clearRef.current)
          clearRef.current = window.setTimeout(() => setOutgoing(null), FLIP_MS)
        }
        return next
      })
    }, ROTATE_MS)
    return () => {
      clearInterval(tick)
      window.clearTimeout(clearRef.current)
    }
  }, [platforms.length, reduced])

  const current = platforms[idx]
  if (!current) return null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <span
        style={{
          fontSize: 15,
          fontWeight: 500,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: '#8a887f',
          whiteSpace: 'nowrap',
        }}
      >
        Compatible with
      </span>

      {/* `perspective` here is what makes the children's rotateX read as a
          turning card rather than a vertical squash. */}
      <div
        style={
          {
            position: 'relative',
            width: SLOT_W,
            height: PILL_H,
            perspective: 620,
            '--mkt-pill-flip-ms': `${FLIP_MS}ms`,
          } as React.CSSProperties
        }
      >
        {outgoing !== null && outgoing !== idx && (
          <Pill key={`out-${outgoing}`} platform={platforms[outgoing]} className="mkt-pill-flip-out" />
        )}
        <Pill key={`in-${idx}`} platform={current} className={started ? 'mkt-pill-flip-in' : undefined} />
      </div>

      {/* The rotation is decorative motion; a live region would announce a new
          platform every few seconds. Screen readers get the full list once. */}
      <span className="sr-only">
        Compatible with {platforms.map((p) => p.name).join(', ')}.
      </span>
    </div>
  )
}

function Pill({ platform, className }: { platform: Platform; className?: string }) {
  return (
    <span
      className={className}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        display: 'inline-flex',
        alignItems: 'center',
        height: PILL_H,
        padding: '0 28px',
        borderRadius: 999,
        background: `color-mix(in srgb, ${platform.color} 11%, #ffffff)`,
        border: `1px solid color-mix(in srgb, ${platform.color} 30%, #ffffff)`,
        boxShadow: '0 6px 18px rgba(28,28,26,0.08)',
        fontSize: 21,
        fontWeight: 600,
        letterSpacing: '-0.01em',
        color: `color-mix(in srgb, ${platform.color} 62%, #1c1c1a)`,
        whiteSpace: 'nowrap',
      }}
    >
      {platform.name}
    </span>
  )
}
