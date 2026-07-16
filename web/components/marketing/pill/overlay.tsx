import type { CSSProperties, ReactNode } from 'react'
import { CalyxaMark } from '@calyxa/ui'
import { cn } from '@/lib/utils'

// The ambient-pill overlay language (Landing v3 handoff): the pill, its
// breathing glow, the transient glass surfaces, tutor-mode tints, annotation
// marks, and ping chips every demo on the page shares. Mirrors the
// redesigned extension overlay's pill vocabulary — bottom-center pill plus
// exactly one transient surface at a time; the retired panel vocabulary
// (chat bubbles, board strip, header timer) never appears here.
//
// Everything is presentational: styled spans/divs, CSS-keyframe motion
// (marketing.css's mkt-* classes), nothing focusable unless a caller wraps
// it in its own control. Colors read @calyxa/ui tokens (mode tints, annot
// ordinals, ping tones) or the .mkt neutral set.

// ── Tutor-mode tints (the --calyxa-mode-* token triples) ─────────────────

export type PillMode = 'explore' | 'coach' | 'build' | 'recover'

export const PILL_MODES: Record<PillMode, { name: string; glyph: string }> = {
  explore: { name: 'Exploring', glyph: '✧' },
  coach: { name: 'Coaching', glyph: '✚' },
  build: { name: 'Building', glyph: '▲' },
  recover: { name: 'Recovering', glyph: '♡' },
}

const modeVar = (mode: PillMode, part: 'text' | 'bg' | 'border') => `var(--calyxa-mode-${mode}-${part})`

// ── The pill ──────────────────────────────────────────────────────────────

export type PillState = 'idle' | 'listening' | 'thinking' | 'speaking'

// Pill shapes (width × height, radius) — the handoff's exact set.
const PILL_SHAPES: Record<PillState, [number, number, number]> = {
  idle: [39, 5, 3],
  listening: [204, 52, 26],
  thinking: [152, 46, 23],
  speaking: [216, 52, 26],
}

export function WaveBars({ color, duration = 0.85 }: { color: string; duration?: number }) {
  const heights = [11, 18, 22, 15, 9]
  return (
    <span aria-hidden="true" className="flex h-[22px] items-center gap-[3px]">
      {heights.map((height, index) => (
        <span
          key={index}
          className="mkt-wavebar block w-[3px] rounded-[2px]"
          style={
            {
              height,
              background: color,
              '--mkt-wave-duration': `${duration}s`,
              '--mkt-wave-delay': `${(index * (duration > 0.9 ? 0.12 : 0.1)).toFixed(2)}s`,
            } as CSSProperties
          }
        />
      ))}
    </span>
  )
}

export function ThinkDots({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn('flex items-center gap-1', className)}>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="mkt-thinkdot h-[5px] w-[5px] rounded-full"
          style={{ background: 'var(--color-accent-emphasis)', '--mkt-think-delay': `${index * 0.18}s` } as CSSProperties}
        />
      ))}
    </span>
  )
}

/**
 * The morphing ambient pill. Idle is a bare sliver; listening/thinking/
 * speaking carry their indicator content. `mode` tints the speaking state
 * (waveform bars + glyph + name in the mode's colors).
 */
export function AmbientPill({ state, mode = 'coach' }: { state: PillState; mode?: PillMode }) {
  const [width, height, radius] = PILL_SHAPES[state]
  const modeMeta = PILL_MODES[mode]

  return (
    <div className="mkt-pill" style={{ width, height, borderRadius: radius }}>
      {state === 'listening' && (
        <span className="mkt-fade-up flex items-center gap-[11px] whitespace-nowrap">
          <WaveBars color="var(--color-foreground)" duration={1} />
          <span className="text-[13px] font-medium text-muted-foreground">Listening</span>
        </span>
      )}
      {state === 'thinking' && (
        <span className="mkt-fade-up flex items-center gap-[9px] whitespace-nowrap">
          <ThinkDots />
          <span className="text-[13px] font-medium text-muted-foreground">Thinking</span>
        </span>
      )}
      {state === 'speaking' && (
        <span className="mkt-fade-up flex items-center gap-[11px] whitespace-nowrap">
          <WaveBars color={modeVar(mode, 'border')} />
          <span className="text-[13px] font-medium" style={{ color: modeVar(mode, 'text') }}>
            {modeMeta.glyph}&nbsp;&nbsp;{modeMeta.name}
          </span>
        </span>
      )}
    </div>
  )
}

/** The breathing glow behind the pill; opacity tracks the pill state. */
export function PillGlow({ opacity, inset = -2 }: { opacity: number; inset?: number }) {
  return (
    <div aria-hidden="true" className="mkt-glow" style={{ opacity, inset }}>
      <span className="mkt-breathe block h-full w-full" />
    </div>
  )
}

// ── Transient surfaces ────────────────────────────────────────────────────

/** The blinking streaming caret (sage, 2.5px). */
export function StreamCaret() {
  return (
    <span
      aria-hidden="true"
      className="mkt-caret ml-[3px] inline-block w-[2.5px] rounded-[2px] align-[-2px]"
      style={{ height: 12, background: 'var(--color-accent-fill)' }}
    />
  )
}

function MicIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-muted-foreground)"
      strokeWidth="1.8"
      strokeLinecap="round"
      className="mt-[3px] h-3.5 w-3.5 flex-none"
      aria-hidden="true"
    >
      <path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z" />
      <path d="M6 11a6 6 0 0 0 12 0" />
      <path d="M12 17v3" />
    </svg>
  )
}

/** The "You" transcript surface: mic icon, YOU label, streaming body. */
export function TranscriptSurface({ text, live, exiting }: { text: string; live?: boolean; exiting?: boolean }) {
  return (
    <div
      className={cn(
        'mkt-glass flex max-w-[420px] items-start gap-[9px] rounded-2xl px-4 py-3',
        // The exit transition and the enter animation fight over the same
        // properties, so the pop class drops the moment the exit begins.
        exiting ? 'mkt-surface-exit' : 'mkt-surface-pop'
      )}
    >
      <MicIcon />
      <div className="flex flex-col gap-0.5">
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">You</span>
        <p className="m-0 text-left text-[13.5px] leading-[1.55] text-foreground">
          {text}
          {live && <StreamCaret />}
        </p>
      </div>
    </div>
  )
}

/** The tutor caption surface: leaf logomark, mode chip, streaming body. */
export function CaptionSurface({
  mode,
  children,
  live,
  maxWidth = 430,
}: {
  mode: PillMode
  children: ReactNode
  live?: boolean
  maxWidth?: number
}) {
  const modeMeta = PILL_MODES[mode]
  return (
    <div className="mkt-glass mkt-surface-pop flex items-start gap-[9px] rounded-2xl px-4 py-3" style={{ maxWidth }}>
      <CalyxaMark className="mt-0.5 h-4 w-4 flex-none" />
      <div className="flex flex-col gap-[5px]">
        <span
          className="self-start rounded-full px-[9px] py-[3px] text-[9.5px] font-semibold uppercase tracking-[0.09em]"
          style={{ background: modeVar(mode, 'bg'), color: modeVar(mode, 'text') }}
        >
          {modeMeta.glyph}&nbsp;{modeMeta.name}
        </span>
        <p className="m-0 text-left text-[13.5px] leading-[1.6] text-foreground">
          {children}
          {live && <StreamCaret />}
        </p>
      </div>
    </div>
  )
}

/** The math surface: the equation the tutor is referring to, mid-transform. */
export function MathSurface({ kicker, from, to }: { kicker: string; from: string; to: string }) {
  return (
    <div className="mkt-glass mkt-surface-pop flex w-[340px] max-w-full flex-col gap-[11px] rounded-[17px] px-[19px] pb-4 pt-[15px]">
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{kicker}</span>
      <div className="flex flex-col items-center gap-1.5 pb-0.5 pt-1.5 font-medium tracking-[-0.01em]">
        <span className="text-[20px] text-foreground">{from}</span>
        <span aria-hidden="true" className="text-[12px] text-muted-foreground">
          ↓
        </span>
        <span className="text-[20px] text-accent-emphasis">{to}</span>
      </div>
    </div>
  )
}

/** The prediction/concept surface: icon tile + title + muted body. */
export function ConceptSurface({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mkt-glass mkt-surface-pop flex w-[400px] max-w-full items-start gap-3 rounded-[17px] px-[17px] py-3.5">
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] bg-accent-subtle text-[15px] text-accent-emphasis">
        ✧
      </span>
      <div className="flex flex-1 flex-col gap-1 text-left">
        <span className="text-[14px] font-semibold leading-[1.4] tracking-[-0.005em] text-foreground">{title}</span>
        <p className="m-0 text-[12.5px] leading-[1.55] text-muted-foreground">{children}</p>
      </div>
    </div>
  )
}

// ── Pings ─────────────────────────────────────────────────────────────────

export type PingTone = 'positive' | 'adjust' | 'watch'

export function PingChip({ tone, glyph, label }: { tone: PingTone; glyph: string; label: string }) {
  return (
    <span className={cn('mkt-ping mkt-surface-pop', `mkt-ping-${tone}`)}>
      <span aria-hidden="true" className="font-bold">
        {glyph}
      </span>
      {label}
    </span>
  )
}

// ── Annotations (the unchanged Meadow mark system, ordinal tokens) ────────

export type AnnotTone = 'green' | 'amber' | 'blue'

// green = annot-1, amber = annot-2, blue = annot-3 (theme.css ordinals).
const ANNOT_ORDINAL: Record<AnnotTone, 1 | 2 | 3> = { green: 1, amber: 2, blue: 3 }

export const annotVar = (tone: AnnotTone, part: 'stroke' | 'fill' | 'tint' | 'tint-border' | 'deep') => {
  const n = ANNOT_ORDINAL[tone]
  if (part === 'stroke') return `var(--calyxa-annot-${n})`
  return `var(--calyxa-annot-${n}-${part})`
}

/** The label pill every mark carries (verb-first, tint bg + deep text). */
export function AnnotLabel({
  tone,
  side,
  offset = 40,
  animate,
  delay = 0.7,
  children,
}: {
  tone: AnnotTone
  side: 'above' | 'below'
  offset?: number
  animate?: boolean
  delay?: number
  children: ReactNode
}) {
  return (
    <span
      className={cn('absolute left-1/2 inline-flex h-[25px] items-center whitespace-nowrap rounded-full px-2.5 text-[11.5px] font-semibold', animate && 'mkt-annot-label')}
      style={
        {
          // Centering lives in `transform`, matching the mkt-rise-x
          // keyframe's end state — Tailwind's -translate-x-1/2 would use the
          // separate `translate` property and compose with the animation
          // into a double shift.
          transform: 'translate(-50%, 0)',
          [side === 'above' ? 'top' : 'bottom']: -offset,
          background: annotVar(tone, 'tint'),
          border: `1px solid ${annotVar(tone, 'tint-border')}`,
          color: annotVar(tone, 'deep'),
          boxShadow: '0 1px 2px rgba(15, 23, 42, 0.06)',
          '--mkt-annot-delay': `${delay}s`,
        } as CSSProperties
      }
    >
      {children}
    </span>
  )
}

/** The numbered step badge at a mark's corner. */
export function StepBadge({ tone, n, style }: { tone: AnnotTone; n: number; style?: CSSProperties }) {
  return (
    <span
      className="absolute flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold"
      style={{
        background: annotVar(tone, 'tint'),
        border: `1.5px solid ${annotVar(tone, 'stroke')}`,
        color: annotVar(tone, 'deep'),
        ...style,
      }}
    >
      {n}
    </span>
  )
}

/**
 * An ellipse mark around an inline term. Wrap the term as children; the SVG
 * overshoots the box by `pad` on each side. With `animate`, the stroke
 * draws on (~.5s dashoffset) then the fill fades in, on the given delays.
 */
export function TermMark({
  tone,
  pad = 10,
  animate,
  drawDelay = 0.2,
  fillDelay = 0.5,
  children,
}: {
  tone: AnnotTone
  pad?: number
  animate?: boolean
  drawDelay?: number
  fillDelay?: number
  children: ReactNode
}) {
  return (
    <span className="relative inline-block">
      {children}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute overflow-visible"
        style={{ left: -pad, top: -8, width: `calc(100% + ${pad * 2}px)`, height: 'calc(100% + 16px)' }}
      >
        <ellipse
          cx="50%"
          cy="50%"
          rx="48%"
          ry="46%"
          fill={annotVar(tone, 'fill')}
          stroke="none"
          className={animate ? 'mkt-annot-fill' : undefined}
          style={{ '--mkt-annot-delay': `${fillDelay}s` } as CSSProperties}
        />
        <ellipse
          cx="50%"
          cy="50%"
          rx="48%"
          ry="46%"
          fill="none"
          stroke={annotVar(tone, 'stroke')}
          strokeWidth={animate ? 2.5 : 2}
          pathLength={1}
          className={animate ? 'mkt-annot-draw' : undefined}
          style={{ '--mkt-annot-delay': `${drawDelay}s` } as CSSProperties}
        />
      </svg>
    </span>
  )
}

/** The why-note card: white, tone-tinted border, 6px tone dot. */
export function WhyNote({ tone, className, style, children }: { tone: AnnotTone; className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <span
      className={cn('flex items-start gap-[7px] rounded-xl bg-background/95 px-3 py-[9px]', className)}
      style={{ border: `1px solid ${annotVar(tone, 'tint-border')}`, boxShadow: '0 4px 14px rgba(15, 23, 42, 0.08)', ...style }}
    >
      <span aria-hidden="true" className="mt-[6px] h-1.5 w-1.5 flex-none rounded-full" style={{ background: annotVar(tone, 'stroke') }} />
      <span className="text-left text-[12px] font-normal leading-[1.55] text-(--calyxa-chip-text)">{children}</span>
    </span>
  )
}

/** An in-caption echo chip: the phrase in its annotation's ordinal tint. */
export function EchoChip({ tone, children }: { tone: AnnotTone; children: ReactNode }) {
  return (
    <span
      className="rounded-[5px] px-1 py-px font-medium"
      style={{ background: annotVar(tone, 'tint'), color: annotVar(tone, 'deep') }}
    >
      {children}
    </span>
  )
}
