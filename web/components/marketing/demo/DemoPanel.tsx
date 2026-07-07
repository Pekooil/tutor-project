'use client'

import { useEffect, useRef } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { CalyxaMark } from '@calyxa/ui'
import { CornerDownLeft } from 'lucide-react'
import { segmentText, type SceneBubble, type SceneState, type StripState, type TagKind } from './scene'
import { annotColor } from './DemoAnnotations'
import { DemoPing } from './DemoPing'

// The overlay recreation (Sprint 20 Task 4, ADR-031): every measurement,
// class, and piece of copy below mirrors the real overlay components
// (extension/src/overlay/*) so a beta user never feels bait-and-switched —
// same 16px panel radius, same bubble shapes, same tag-pill language, same
// waveform anatomy. Deliberately zero imports from /extension: this is a
// scripted recreation, so it renders no <button>/<input> at all (nothing
// focusable inside an aria-hidden stage), only styled divs.

// Mirrors Transcript.tsx's TAG_KIND_PREFIX exactly.
const TAG_KIND_PREFIX: Record<TagKind, string> = {
  reviewing: 'reviewing',
  'known-gap': 'known gap',
  'due-review': 'due review',
  strength: 'strength',
  callback: 'from a previous session',
}

export function DemoPanel({ state }: { state: SceneState }) {
  return (
    <div className="relative h-full">
      <DemoPing label={state.ping?.label ?? null} />
      <div className="flex h-full flex-col overflow-hidden rounded-[16px] border border-(--cx-demo-hairline) bg-background shadow-panel">
        <PanelTitleBar speaking={state.waveform} />
        <PanelTranscript state={state} />
        {state.strip && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: [0, 0, 0.2, 1] }}
            className="px-4 pb-1"
          >
            <StripCard strip={state.strip} />
          </motion.div>
        )}
        <PanelComposer progress={state.progress} recording={false} />
      </div>
    </div>
  )
}

// TitleBar.tsx's anatomy, on Sprint 14's target chrome: logomark + wordmark,
// the Speaking waveform while the tutor talks, − (minimize) and ✕ (end).
function PanelTitleBar({ speaking }: { speaking: boolean }) {
  return (
    <div className="flex flex-none items-center gap-[9px] border-b border-(--cx-demo-hairline) px-4 pb-3 pt-[14px]">
      <CalyxaMark className="h-[19px] w-[19px] flex-none" />
      <span className="text-[13.5px] font-semibold text-foreground">Calyxa</span>
      <span className="ml-auto flex items-center gap-2">
        {speaking && (
          <>
            <span className="flex h-4 items-center">
              <WaveformBars count={7} barWidth={3} gap={3} gradientFrom="#22a06b" gradientTo="#4ade80" durationBase={0.65} />
            </span>
            <span className="text-[11.5px] text-muted-foreground">Speaking</span>
          </>
        )}
      </span>
      <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full border border-(--cx-demo-hairline) bg-background">
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M1.5 5H8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-foreground" />
        </svg>
      </span>
      <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full border border-(--cx-demo-hairline) bg-background">
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-foreground" />
        </svg>
      </span>
    </div>
  )
}

function PanelTranscript({ state }: { state: SceneState }) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const lastBubble = state.bubbles[state.bubbles.length - 1]
  const lastRevealed = lastBubble?.revealedChars ?? 0

  // Keep the newest turn in view as the conversation grows, exactly like the
  // real transcript's scroll anchor.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state.bubbles.length, lastRevealed, state.pendingReply, state.strip])

  return (
    <div
      ref={scrollRef}
      className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {state.bubbles.map((bubble, index) => (
        <Bubble key={index} bubble={bubble} />
      ))}
      {state.pendingReply && <TypingIndicator />}
    </div>
  )
}

function Bubble({ bubble }: { bubble: SceneBubble }) {
  if (bubble.role === 'student') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: [0, 0, 0.2, 1] }}
        className="flex flex-none justify-end"
      >
        <p className="m-0 max-w-[80%] rounded-2xl rounded-tr-sm bg-surface px-3.5 py-2 text-[13.5px] leading-relaxed text-foreground">
          {bubble.text}
        </p>
      </motion.div>
    )
  }

  const streaming = bubble.revealedChars < bubble.text.length
  const visibleText = bubble.text.slice(0, bubble.revealedChars)
  const segments = segmentText(visibleText, bubble.links)

  return (
    <div className="flex flex-none justify-start">
      <div className="flex max-w-[88%] flex-col items-start gap-1.5">
        <p className="m-0 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-foreground">
          {segments.map((segment, index) =>
            segment.color ? (
              // The color-link (ADR-029 amendment): the exact phrase shares
              // its annotation's color — underline + tint, not a block fill.
              <span
                key={index}
                style={{
                  color: annotColor(segment.color),
                  textDecorationLine: 'underline',
                  textDecorationColor: `${annotColor(segment.color)}55`,
                  textUnderlineOffset: 3,
                }}
              >
                {segment.text}
              </span>
            ) : (
              <span key={index}>{segment.text}</span>
            )
          )}
          {streaming && (
            <span
              aria-hidden="true"
              className="cx-demo-caret ml-[2px] inline-block w-[2px] bg-accent-glow-strong"
              style={{ height: '1.05em', verticalAlign: '-0.18em' }}
            />
          )}
        </p>
        {bubble.tags.length > 0 && (
          <span className="flex flex-wrap gap-1.5">
            {bubble.tags.slice(0, 2).map((tag, index) => (
              <motion.span
                key={index}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.15, ease: [0, 0, 0.2, 1] }}
                className="rounded-full border border-(--cx-demo-hairline) bg-surface px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
              >
                {TAG_KIND_PREFIX[tag.kind]}: {tag.label}
              </motion.span>
            ))}
          </span>
        )}
      </div>
    </div>
  )
}

// Transcript.tsx's TypingIndicator: the breathing orb + expanding ring shown
// while a reply is on its way. Reduced motion renders the orb at rest with
// no ring — the real overlay's pulse is driven by motion tokens that zero
// out under prefers-reduced-motion, so the static orb IS the faithful frame
// (ADR-031's every-marketing-animation rule; these infinite pulses
// previously ran regardless).
function TypingIndicator() {
  const reduceMotion = useReducedMotion()

  if (reduceMotion) {
    return (
      <div className="flex flex-none items-center py-1">
        <div className="relative flex h-5 w-5 items-center justify-center">
          <div
            aria-hidden="true"
            className="h-3.5 w-3.5 rounded-full shadow-[0_0_6px_rgba(74,222,128,0.45)]"
            style={{ background: 'radial-gradient(circle at 38% 32%, #dcfce7 0%, #86efac 45%, #4ade80 100%)' }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-none items-center py-1">
      <div className="relative flex h-5 w-5 items-center justify-center">
        <motion.div
          aria-hidden="true"
          className="absolute h-5 w-5 rounded-full border border-accent"
          animate={{ scale: [0.7, 1.9], opacity: [0.55, 0] }}
          transition={{ duration: 2.6, ease: 'easeOut', repeat: Infinity }}
        />
        <motion.div
          aria-hidden="true"
          className="h-3.5 w-3.5 rounded-full shadow-[0_0_6px_rgba(74,222,128,0.45)]"
          style={{ background: 'radial-gradient(circle at 38% 32%, #dcfce7 0%, #86efac 45%, #4ade80 100%)' }}
          animate={{ scale: [0.86, 1.1, 0.86], opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 2.8, ease: 'easeInOut', repeat: Infinity }}
        />
      </div>
    </div>
  )
}

// InsightStrip.tsx's overview/recap cards, compacted to the Sprint 14
// above-the-composer placement.
function StripCard({ strip }: { strip: StripState }) {
  if (strip.variant === 'overview') {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-(--cx-demo-hairline) bg-surface px-3.5 py-2.5">
        <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Where you are</p>
        <div className="flex flex-col gap-1.5">
          {strip.mastery.map((node) => (
            <div key={node.title} className="flex items-center gap-2">
              <span className="w-[45%] flex-none truncate text-[12px] text-foreground">{node.title}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-(--cx-demo-hairline)">
                <span
                  className="block h-full rounded-full bg-accent-glow-strong"
                  style={{ width: `${Math.round(node.value * 100)}%` }}
                />
              </span>
            </div>
          ))}
        </div>
        {strip.workingThrough && (
          <p className="m-0 text-[12px] leading-snug text-muted-foreground">{strip.workingThrough}</p>
        )}
        {strip.due && <p className="m-0 text-[12px] leading-snug text-muted-foreground">{strip.due}</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-(--cx-demo-hairline) bg-surface px-3.5 py-2.5">
      <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Session recap</p>
      {strip.concepts.map((concept) => (
        <div key={concept.title} className="flex items-center justify-between gap-2">
          <span className="truncate text-[12.5px] text-foreground">{concept.title}</span>
          <span className="flex flex-none items-center gap-1 text-[12px] text-muted-foreground">
            {Math.round(concept.value * 100)}%
            {concept.delta && (
              <span className={concept.delta === 'up' ? 'text-accent-emphasis' : 'text-muted-foreground'}>
                {concept.delta === 'up' ? '▲' : '▼'}
              </span>
            )}
          </span>
        </div>
      ))}
      {strip.resolved && (
        <p className="m-0 text-[12px] leading-snug text-accent-emphasis">✓ Gap closed: {strip.resolved}</p>
      )}
      {strip.trend && (
        <p className="m-0 text-[12px] font-medium leading-snug text-accent-emphasis">{strip.trend}</p>
      )}
      {strip.comingBack && (
        <p className="m-0 text-[12px] leading-snug text-muted-foreground">Coming back: {strip.comingBack}</p>
      )}
    </div>
  )
}

// Composer.tsx's input row plus Sprint 14's two target additions: the thin,
// low-saturation solution-progress bar inside the composer frame (ADR-028)
// and the ↵ send icon.
function PanelComposer({ progress, recording }: { progress: number; recording: boolean }) {
  return (
    <div className="flex-none border-t border-(--cx-demo-hairline) px-[18px] pb-[14px] pt-2.5">
      <div className="mb-2.5 h-[3px] w-full overflow-hidden rounded-full bg-(--cx-demo-hairline)">
        <div
          className="h-full rounded-full bg-accent-glow-strong transition-[width] duration-500 ease-out"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
      <div className="flex items-center gap-2 rounded-full border border-(--cx-demo-hairline) bg-background py-[7px] pl-[18px] pr-[7px] shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        {recording ? (
          <div className="flex h-[34px] flex-1 items-center justify-center">
            <WaveformBars count={24} barWidth={3} gap={3} gradientFrom="#4ade80" gradientTo="#86efac" durationBase={0.9} />
          </div>
        ) : (
          <span className="flex-1 truncate text-[14.5px] text-muted-foreground">Ask a math question…</span>
        )}
        <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full border border-(--cx-demo-hairline) bg-background">
          <span aria-hidden="true" className="block h-[13px] w-[7px] rounded-full bg-muted-foreground" />
        </span>
        <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full bg-accent text-accent-foreground">
          <CornerDownLeft aria-hidden="true" size={15} strokeWidth={2.25} />
        </span>
      </div>
    </div>
  )
}

// Composer.tsx's WaveformBars, CSS-keyframe variant (cx-demo-bar lives in
// DemoStage's scoped <style>, gated to prefers-reduced-motion:
// no-preference — under reduced motion the bars sit static at full height,
// same as the real overlay).
export function WaveformBars({
  count,
  barWidth,
  gap,
  gradientFrom,
  gradientTo,
  durationBase,
}: {
  count: number
  barWidth: number
  gap: number
  gradientFrom: string
  gradientTo: string
  durationBase: number
}) {
  return (
    <div aria-hidden="true" className="flex h-full items-center" style={{ gap }}>
      {Array.from({ length: count }, (_, index) => (
        <span
          key={index}
          className="cx-demo-bar block h-full rounded-full"
          style={{
            width: barWidth,
            background: `linear-gradient(180deg, ${gradientFrom}, ${gradientTo})`,
            transformOrigin: 'center',
            animationDuration: `${(durationBase + (index % 5) * 0.12).toFixed(2)}s`,
            animationDelay: `${((index * 0.13) % 1).toFixed(2)}s`,
          }}
        />
      ))}
    </div>
  )
}
