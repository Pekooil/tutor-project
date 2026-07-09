'use client'

import { useEffect, useRef } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { CalyxaMark } from '@calyxa/ui'
import {
  DEMO_TUTOR_MODES,
  segmentText,
  type SceneCheckin,
  type SceneEntry,
  type SceneMilestone,
  type SceneRecap,
  type SceneState,
} from './scene'
import { annotDeep, annotStroke } from './DemoAnnotations'
import { DemoPing } from './DemoPing'

// The overlay recreation, rebuilt to the REDESIGNED overlay (Sprint 25
// Task 3, ADR-040; originally Sprint 20 Task 4, ADR-031): every
// measurement, class, and piece of copy mirrors the shipped components —
// Overlay.tsx's glass panel, TitleBar.tsx's tutor-mode identity + stage
// subtitle + clock, the board strip, Transcript.tsx's un-bubbled tutor
// turns / sage student bubbles / milestone marker rows / answer chips,
// Composer.tsx's input row (the solution-progress bar is retired with it),
// CheckinCard.tsx and RecapCard.tsx as the pre/terminal body states, and
// PingToast.tsx via DemoPing. Colors read @calyxa/ui tokens; where /web's
// shadcn mapping re-targets a name (--color-accent, --color-border), the
// collision-proof aliases (accent-fill, the --cx-demo-* mirrors) are used
// instead. Deliberately zero imports from /extension, and no interactive
// elements — nothing focusable inside an aria-hidden stage.

const MILESTONE_COLORS: Record<SceneMilestone['tone'], { text: string; rule: string }> = {
  positive: { text: 'var(--color-accent-emphasis)', rule: 'var(--calyxa-sage-border)' },
  adjust: { text: 'var(--calyxa-ping-adjust-text)', rule: 'var(--cx-demo-hairline)' },
  watch: { text: 'var(--calyxa-ping-watch-text)', rule: 'var(--calyxa-ping-watch-divider)' },
}

function formatClock(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
}

export function DemoPanel({ state }: { state: SceneState }) {
  const hasContent = state.transcript.length > 0
  const sessionLive = !state.checkin && !state.recap && (hasContent || state.stage !== null || state.board !== null)

  return (
    <div className="relative flex flex-col items-stretch">
      <motion.div
        layout
        transition={{ duration: 0.25, ease: [0, 0, 0.2, 1] }}
        className="relative flex flex-col overflow-hidden rounded-lg border border-(--cx-demo-hairline) bg-background/85 shadow-panel backdrop-blur-[18px] backdrop-saturate-[1.5]"
      >
        {/* The ping toast drops into the top-center of the header (8a). */}
        <DemoPing ping={state.ping} />
        <PanelTitleBar state={state} sessionLive={sessionLive} />
        {state.board && sessionLive && <BoardStrip expression={state.board} />}
        {state.recap ? (
          <RecapBody recap={state.recap} />
        ) : state.checkin ? (
          <CheckinBody checkin={state.checkin} />
        ) : (
          <>
            {hasContent && <PanelTranscript state={state} />}
            <PanelComposer hasContent={hasContent} chips={state.chips} sessionLive={sessionLive} />
          </>
        )}
      </motion.div>
    </div>
  )
}

// TitleBar.tsx's anatomy: the identity cluster is the live tutor MODE while
// a session runs (glyph chip + name over the topic/stage subtitle, design
// 8c) and the classic mark + wordmark otherwise; the right side carries the
// Speaking waveform, the recap's plain meta, the live clock, and the
// (non-interactive here) window controls.
function PanelTitleBar({ state, sessionLive }: { state: SceneState; sessionLive: boolean }) {
  const mode = DEMO_TUTOR_MODES[state.mode]
  const chip: { label: string; pulsing: boolean } | null = state.checkin
    ? state.checkin.variant === 'scan'
      ? { label: 'Scanning', pulsing: true }
      : { label: 'New session', pulsing: false }
    : null

  const identity = sessionLive ? (
    <span className="flex min-w-0 items-center gap-2.5">
      <span
        aria-hidden="true"
        className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border text-[14px] font-bold transition-[color,background-color,border-color,box-shadow] duration-[450ms]"
        style={{
          color: `var(--calyxa-mode-${mode.key}-text)`,
          background: `var(--calyxa-mode-${mode.key}-bg)`,
          borderColor: `var(--calyxa-mode-${mode.key}-border)`,
          // The 8c gradient glow: edge + soft drop + wide bloom, tinted
          // from the mode border (Overlay.css's --cx-mode-glow, mirrored).
          boxShadow: `0 0 0 1px color-mix(in srgb, var(--calyxa-mode-${mode.key}-border) 35%, transparent), 0 3px 10px -2px color-mix(in srgb, var(--calyxa-mode-${mode.key}-border) 60%, transparent), 0 0 16px 3px color-mix(in srgb, var(--calyxa-mode-${mode.key}-border) 30%, transparent)`,
        }}
      >
        {mode.glyph}
      </span>
      <span className="flex min-w-0 flex-col gap-px">
        <span
          className="truncate text-[13.5px] font-semibold leading-tight tracking-[-0.01em] transition-colors duration-[450ms]"
          style={{ color: `var(--calyxa-mode-${mode.key}-text)` }}
        >
          {mode.name}
        </span>
        {state.stage && (
          <span className="truncate text-[11px] leading-tight text-muted-foreground">{state.stage}</span>
        )}
      </span>
    </span>
  ) : (
    <span className="flex min-w-0 items-center gap-[9px]">
      <CalyxaMark className="h-[19px] w-[19px] flex-none" />
      <span className="text-[13.5px] font-semibold text-foreground">Calyxa</span>
    </span>
  )

  return (
    <div className="flex flex-none items-center gap-2.5 border-b border-(--cx-demo-hairline) px-3.5 pb-[9px] pt-[10px]">
      {identity}
      {state.waveform && (
        <span className="ml-2 flex flex-none items-center gap-2">
          <span className="flex h-4 items-center">
            <WaveformBars count={7} barWidth={3} gap={3} gradientFrom="#22a06b" gradientTo="#4ade80" durationBase={0.65} />
          </span>
          <span className="text-[11.5px] text-muted-foreground">Speaking</span>
        </span>
      )}
      <span className="ml-auto flex items-center gap-1.5">
        {state.recap?.meta && <span className="mr-1 text-[11.5px] text-muted-foreground">{state.recap.meta}</span>}
        {chip && (
          <span className="mr-1 flex items-center gap-1.5 rounded-full bg-accent-subtle px-[10px] py-1 text-[11.5px] font-semibold text-accent-emphasis">
            {chip.pulsing && (
              <span aria-hidden="true" className="cx-demo-dot h-[7px] w-[7px] rounded-full bg-accent-glow-strong" />
            )}
            {chip.label}
          </span>
        )}
        {sessionLive && (
          <span className="flex flex-none items-center gap-1.5 text-[11.5px] tabular-nums text-muted-foreground">
            <span aria-hidden="true" className="cx-demo-dot h-[7px] w-[7px] rounded-full bg-accent-glow-strong" />
            {formatClock(state.elapsedMs)}
          </span>
        )}
        <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full border border-(--cx-demo-hairline) bg-background text-muted-foreground">
          <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1.5 5H8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
        <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full border border-(--cx-demo-hairline) bg-background text-muted-foreground">
          <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
      </span>
    </div>
  )
}

// The board strip (design 8a): pins the current equation just below the
// header while a session is live. The trailing spacer matches the product
// (the equation centers against the BOARD label).
function BoardStrip({ expression }: { expression: string }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-(--cx-demo-hairline) bg-(--calyxa-board-bg) px-3.5 py-[7px]">
      <span className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground">BOARD</span>
      <span className="flex-1 text-center text-[14.5px] tabular-nums text-foreground">{expression}</span>
      <span aria-hidden="true" className="w-[38px] flex-none" />
    </div>
  )
}

function PanelTranscript({ state }: { state: SceneState }) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const last = state.transcript[state.transcript.length - 1]
  const lastRevealed = last && last.role !== 'milestone' ? last.revealedChars : 0

  // Keep the newest entry in view as the conversation grows, exactly like
  // the real transcript's scroll anchor.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state.transcript.length, lastRevealed, state.pendingReply, state.chips])

  return (
    <div
      ref={scrollRef}
      // max-h mirrors the real overlay's chat-area cap — the panel's HEIGHT
      // is intrinsic (DemoStage anchors by `bottom`), so this is what keeps
      // a long conversation scrolling instead of growing without bound.
      className="flex max-h-[272px] flex-col gap-2.5 overflow-y-auto px-3.5 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {state.transcript.map((entry, index) => (
        <Entry key={index} entry={entry} />
      ))}
      {state.chips && state.chips.length > 0 && <ChipRow chips={state.chips} />}
      {state.pendingReply && <TypingIndicator />}
    </div>
  )
}

function Entry({ entry }: { entry: SceneEntry }) {
  const reduceMotion = useReducedMotion() ?? false
  // The design 8a Message-in: every committed entry settles in from 9px
  // below on the overlay's curve; reduced motion renders it in place.
  const entryMotion = {
    initial: reduceMotion ? false : ({ opacity: 0, y: 9 } as const),
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.45, ease: [0.2, 0.8, 0.2, 1] as const },
  }

  if (entry.role === 'milestone') {
    const colors = MILESTONE_COLORS[entry.milestone.tone]
    return (
      <motion.div {...entryMotion} className="my-0.5 flex flex-none items-center gap-2.5" style={{ color: colors.text }}>
        <span aria-hidden="true" className="h-px flex-1" style={{ background: colors.rule }} />
        <span className="flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold">
          <span aria-hidden="true" className="text-[12px] leading-none">
            {entry.milestone.glyph}
          </span>
          {entry.milestone.line}
        </span>
        <span aria-hidden="true" className="h-px flex-1" style={{ background: colors.rule }} />
      </motion.div>
    )
  }

  if (entry.role === 'student') {
    return (
      <motion.div {...entryMotion} className="flex flex-none justify-end">
        <p className="m-0 max-w-[78%] rounded-[14px] rounded-br-[4px] border border-(--calyxa-sage-border) bg-accent-subtle px-[13px] py-2 text-[13.5px] leading-normal text-accent-fill-foreground">
          {entry.text}
        </p>
      </motion.div>
    )
  }

  const streaming = entry.revealedChars < entry.text.length
  const visibleText = entry.text.slice(0, entry.revealedChars)
  const segments = segmentText(visibleText, entry.links)

  // Tutor turns get NO bubble — the 14px mark + open text sitting on the
  // panel (design 8a). Echoed phrases read the annotation's ordinal deep
  // color with a stroke-colored underline, the shipped Transcript.tsx
  // treatment.
  return (
    <motion.div {...entryMotion} className="flex flex-none justify-start gap-[9px]">
      <span aria-hidden="true" className="mt-[3px] flex-none">
        <CalyxaMark className="h-3.5 w-3.5" />
      </span>
      <div className="flex max-w-[92%] flex-col items-start">
        <p className="m-0 w-full whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-foreground">
          {segments.map((segment, index) =>
            segment.ordinal ? (
              <span
                key={index}
                style={{
                  color: annotDeep(segment.ordinal),
                  textDecorationLine: 'underline',
                  textDecorationColor: annotStroke(segment.ordinal),
                  textUnderlineOffset: 2,
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
      </div>
    </motion.div>
  )
}

// Answer chips (design 8a): a wrap row of white capsules indented 23px
// under the tutor line (the mark's 14px + the 9px gap). Rendered as styled
// spans — the stage is aria-hidden, nothing focusable.
function ChipRow({ chips }: { chips: string[] }) {
  const reduceMotion = useReducedMotion() ?? false
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 9 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
      className="flex flex-none flex-wrap gap-[7px] pl-[23px]"
    >
      {chips.map((chip) => (
        <span
          key={chip}
          className="rounded-full border border-(--cx-demo-hairline) bg-background px-[11px] py-[5px] text-[12px] leading-normal text-(--calyxa-chip-text)"
        >
          {chip}
        </span>
      ))}
    </motion.div>
  )
}

// Transcript.tsx's TypingIndicator: the breathing orb + expanding ring shown
// while a reply is on its way; reduced motion renders the orb at rest.
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
          className="absolute h-5 w-5 rounded-full border border-(--color-accent-fill)"
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

// The check-in body (CheckinCard.tsx, revised design 5a): the scanning orb
// while the opening scan runs, then "one prediction, not a menu" — the
// topic card, the glow-haloed AI-prediction card, and the two actions.
function CheckinBody({ checkin }: { checkin: SceneCheckin }) {
  if (checkin.variant === 'scan') {
    return (
      <div className="flex flex-col items-center gap-[18px] px-[18px] pb-[38px] pt-9">
        <div aria-hidden="true" className="relative flex h-16 w-16 items-center justify-center">
          <div className="cx-demo-ring absolute h-16 w-16 rounded-full border-2 border-(--color-accent-fill)" />
          <div
            className="cx-demo-orb h-[52px] w-[52px] rounded-full shadow-[0_0_20px_rgba(74,222,128,0.45)]"
            style={{ background: 'radial-gradient(circle at 38% 32%, #dcfce7 0%, #86efac 45%, #4ade80 100%)' }}
          />
        </div>
        <span className="text-[14px] tracking-[0.01em] text-muted-foreground">{checkin.line}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 px-4 pb-4 pt-[15px]">
      <p className="m-0 text-[14.5px] font-semibold tracking-[-0.01em] text-foreground">What are we working on today?</p>
      <span className="flex w-full items-center gap-2.5 rounded-[11px] border-[1.5px] border-(--color-accent-fill) bg-accent-subtle px-3 py-[9px] text-left">
        <span className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px] border border-(--calyxa-sage-border) bg-background">
          <CalyxaMark className="h-[15px] w-[15px]" />
        </span>
        <span className="min-w-0 truncate text-[14px] font-semibold text-accent-fill-foreground">{checkin.topic}</span>
      </span>
      <div aria-hidden="true" className="h-px bg-(--cx-demo-hairline-soft)" />
      <div className="flex items-center gap-2">
        <p className="m-0 text-[14.5px] font-semibold tracking-[-0.01em] text-foreground">Where you usually get stuck</p>
        <span
          className="rounded-full px-2 py-[2.5px] text-[9.5px] font-bold uppercase tracking-[0.06em] text-accent-fill-foreground"
          style={{ background: 'linear-gradient(120deg, var(--calyxa-ai-tag-from), var(--calyxa-ai-tag-to))' }}
        >
          AI prediction
        </span>
      </div>
      <div className="relative">
        <span
          aria-hidden="true"
          className="absolute -inset-[3px] rounded-[15px] opacity-70 blur-[8px]"
          style={{
            background:
              'linear-gradient(120deg, var(--color-accent-fill), var(--calyxa-ai-tag-to), var(--calyxa-ai-tag-from), var(--color-accent-fill))',
          }}
        />
        <div className="relative flex items-center gap-[11px] rounded-[12px] border-[1.5px] border-(--color-accent-fill) bg-accent-subtle px-[13px] py-[11px]">
          <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[8px] border border-(--calyxa-sage-border) bg-background">
            <CalyxaMark className="h-[17px] w-[17px]" />
          </span>
          <span className="flex min-w-0 flex-col gap-px">
            <span className="text-[14px] font-semibold leading-tight text-accent-fill-foreground">{checkin.sticking}</span>
            <span className="text-[11.5px] leading-[1.35] text-accent-emphasis">
              {checkin.evidence ?? 'a common first place to check on this topic'}
            </span>
          </span>
        </div>
      </div>
      <div className="mt-0.5 flex gap-2">
        <span className="flex h-10 flex-1 items-center justify-center rounded-full bg-accent-fill text-[13.5px] font-semibold text-accent-fill-foreground">
          Start session
        </span>
        <span className="flex h-10 flex-none items-center justify-center rounded-full border border-(--cx-demo-hairline) bg-background px-4 text-[13.5px] font-semibold text-(--calyxa-chip-text)">
          No, other
        </span>
      </div>
    </div>
  )
}

// The post-session recap (RecapCard.tsx, design 7b): the panel body's
// TERMINAL state — Concept, "What improved" (sage checks), "Still needs
// practicing" (empty circles under the amber overline), the "Generated for
// you" placeholder tiles (post-beta slot, straight from the board), one
// exit.
function RecapBody({ recap }: { recap: SceneRecap }) {
  const improved = recap.outcomes.filter((outcome) => outcome.outcome !== 'revisit')
  const practicing = recap.outcomes.filter((outcome) => outcome.outcome === 'revisit')

  return (
    <div className="flex flex-col gap-3.5 px-[18px] pb-[17px] pt-[15px]">
      <div>
        <div className="mb-[3px] text-[10.5px] font-semibold uppercase tracking-[0.11em] text-(--calyxa-hint-text)">Concept</div>
        <div className="text-[16px] font-semibold tracking-[-0.015em] text-foreground">{recap.concept}</div>
      </div>
      {improved.length > 0 && (
        <div>
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-accent-emphasis">What improved</div>
          <div className="flex flex-col gap-[7px]">
            {improved.map((outcome) => (
              <div key={outcome.title} className="flex items-center gap-2.5 text-[13.5px] text-foreground">
                <span className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-accent-fill text-[10.5px] font-bold text-accent-fill-foreground">
                  ✓
                </span>
                {outcome.title}
              </div>
            ))}
          </div>
        </div>
      )}
      {practicing.length > 0 && (
        <div>
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-(--calyxa-recap-practice-text)">
            Still needs practicing
          </div>
          <div className="flex flex-col gap-[7px]">
            {practicing.map((outcome) => (
              <div key={outcome.title} className="flex items-center gap-2.5 text-[13.5px] text-(--calyxa-chip-text)">
                <span className="h-[18px] w-[18px] flex-none rounded-full border-[1.5px] border-(--cx-demo-hairline) bg-background" />
                {outcome.title}
              </div>
            ))}
          </div>
        </div>
      )}
      <div>
        <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-(--calyxa-hint-text)">Generated for you</div>
        <div className="grid grid-cols-2 gap-2">
          <span className="cx-demo-placeholder flex h-[52px] items-center justify-center rounded-[10px] px-1.5 text-center font-mono text-[10px]">
            study material
          </span>
          <span className="cx-demo-placeholder flex h-[52px] items-center justify-center rounded-[10px] px-1.5 text-center font-mono text-[10px]">
            study material
          </span>
        </div>
      </div>
      <span className="flex h-[42px] w-full items-center justify-center rounded-full bg-accent-fill text-[14px] font-semibold text-accent-fill-foreground">
        Complete session
      </span>
    </div>
  )
}

// Composer.tsx's input row (design-08 restyle — NO progress bar: retired,
// the pings and milestone markers are the progress). Styled spans, nothing
// focusable.
function PanelComposer({ hasContent, chips, sessionLive }: { hasContent: boolean; chips: string[] | null; sessionLive: boolean }) {
  const placeholder =
    chips && chips.length > 0
      ? 'Tap an answer — or say it your way'
      : sessionLive
        ? 'Answer out loud or type here'
        : 'Ask a math question…'

  return (
    <div className={`${hasContent ? 'border-t border-(--cx-demo-hairline)' : ''} px-[11px] pb-[10px] pt-2`}>
      <div className="flex items-center gap-[7px] rounded-full border border-(--cx-demo-hairline) bg-background py-[5px] pl-[13px] pr-1.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <span className="flex h-[32px] flex-1 items-center truncate text-[12.5px] text-muted-foreground">{placeholder}</span>
        <span className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full border border-(--cx-demo-hairline) bg-background">
          <span aria-hidden="true" className="block h-2.5 w-[5px] rounded-full bg-muted-foreground" />
        </span>
        <span className="flex h-[32px] w-[32px] flex-none items-center justify-center rounded-full bg-accent-fill text-[14px] font-semibold text-accent-fill-foreground">
          <span aria-hidden="true">↑</span>
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
