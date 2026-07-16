import type { CSSProperties, ReactNode } from 'react'
import { C, glassCard, glassCardSoft, sheen, eyebrow, iconTile } from './theme'

// Presentational primitives shared across the premium dashboard screens.
// Pure server components — no state, just the design's repeated chrome.

/** The Calyxa leaf logomark. `id` must be unique per instance (gradient defs). */
export function Logomark({ size = 20, id }: { size?: number; id: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Calyxa">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#7bedaa" />
          <stop offset="0.5" stopColor="#3fd07a" />
          <stop offset="1" stopColor="#1f9d5b" />
        </linearGradient>
      </defs>
      <path
        d="M52,37 C54,28 44,15 35,15 C24,15 15,25 15,35 C15,46 28,55 45,51"
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth="6.5"
        strokeLinecap="round"
      />
      <path
        d="M0,-7 C4.5,-4 4.5,4 0,7.5 C-4.5,4 -4.5,-4 0,-7 Z"
        transform="translate(44,13) rotate(32)"
        fill={`url(#${id})`}
      />
      <circle cx="40" cy="35" r="4" fill={`url(#${id})`} />
    </svg>
  )
}

/** A glass card wrapper (with the built-in top sheen). */
export function GlassCard({
  children,
  soft = false,
  style,
  className,
}: {
  children: ReactNode
  soft?: boolean
  style?: CSSProperties
  className?: string
}) {
  return (
    <div className={className} style={{ ...(soft ? glassCardSoft : glassCard), ...style }}>
      <span style={sheen} />
      {children}
    </div>
  )
}

/** The standard card header: icon tile + eyebrow + title, plus an optional
 * right-aligned slot (action pill or badge). */
export function CardHead({
  icon,
  kicker,
  title,
  right,
  divider = true,
}: {
  icon: ReactNode
  kicker: string
  title: string
  right?: ReactNode
  divider?: boolean
}) {
  return (
    <>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 11, paddingBottom: 13 }}>
        <span style={iconTile}>{icon}</span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
          <span style={eyebrow}>{kicker}</span>
          <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.005em' }}>{title}</span>
        </span>
        {right}
      </div>
      {divider && <div style={{ position: 'relative', height: 1, background: C.hair, marginBottom: 4 }} />}
    </>
  )
}

/** A small rounded status/tag badge. */
export function Badge({
  children,
  bg = 'rgba(28,28,26,.05)',
  color = C.muted,
  style,
}: {
  children: ReactNode
  bg?: string
  color?: string
  style?: CSSProperties
}) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '.07em',
        textTransform: 'uppercase',
        borderRadius: 99,
        padding: '3px 9px',
        background: bg,
        color,
        ...style,
      }}
    >
      {children}
    </span>
  )
}

/** The page header (eyebrow + h1 + optional subtitle), matching each screen. */
export function ScreenHeader({
  kicker,
  title,
  subtitle,
  right,
  titleSize = 28,
  lineHeight = 34,
}: {
  kicker: string
  title: string
  subtitle?: ReactNode
  right?: ReactNode
  titleSize?: number
  lineHeight?: number
}) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 20,
        marginBottom: 22,
        ...({ animation: 'cxPop .5s cubic-bezier(.3,1.4,.4,1) .06s both' } as CSSProperties),
      }}
    >
      <div>
        <p style={{ margin: '0 0 7px', fontSize: 10, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: C.muted }}>
          {kicker}
        </p>
        <h1 style={{ margin: 0, fontSize: titleSize, lineHeight: `${lineHeight}px`, fontWeight: 600, letterSpacing: '-.015em' }}>
          {title}
        </h1>
        {subtitle && <p style={{ margin: '8px 0 0', fontSize: 14, color: C.muted }}>{subtitle}</p>}
      </div>
      {right}
    </header>
  )
}

/** A thin progress bar with the grow animation. */
export function Bar({ width, color, delay = '.3s' }: { width: string; color: string; delay?: string }) {
  return (
    <span
      style={{
        flex: 1,
        height: 7,
        borderRadius: 99,
        background: 'rgba(28,28,26,.06)',
        overflow: 'hidden',
        display: 'block',
      }}
    >
      <span
        style={{
          display: 'block',
          width,
          height: 7,
          borderRadius: 99,
          background: color,
          transformOrigin: 'left',
          animation: `cxGrow .9s cubic-bezier(.3,1.2,.4,1) ${delay} both`,
        }}
      />
    </span>
  )
}
