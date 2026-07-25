'use client'

import { useEffect, useState, type CSSProperties, type MutableRefObject } from 'react'
import { CalyxaMark } from '@calyxa/ui'

// Landing v5 hero demo (the centerpiece): a mac desktop + Chrome window on a
// real Khan Academy trig problem, with the calyxa overlay riding it. The
// overlay is a faithful mirror of the REAL extension's ambient-pill redesign
// (extension/src/overlay/Overlay.tsx + Overlay.css + AnnotationLayer.tsx),
// rendered in DARK theme (data-theme="dark" flips the shared theme.css
// tokens, exactly how the extension stamps prefers-color-scheme):
//
// - ONE bottom-center column: a single transient surface (You-transcript OR
//   caption — never both) stacked gap-3.5 above the morphing pill, mirroring
//   Overlay.tsx's single-surface-slot rule.
// - The pill morphs through the real shape map (text 540×54 / listen 204×52 /
//   think 152×46 / speak 216×52), wears the breathing mode frame while a
//   session is live, and its glow steps opacity per state.
// - Text turns keep the composer open with the ↵ hint swapping to thinking
//   dots (Composer.tsx's busy state); voice turns morph listen → think →
//   speak with the mode-tinted waveform.
// - The committed caption HOLDS (never auto-dissolves) and carries follow-up
//   answer chips in-card under a border-t (the 2026-07-16 persistence rule).
// - On-page annotations replay AnnotationLayer.tsx's system: Circle/Box
//   marks, per-turn ordinal colors in emission order (green→amber→blue), 2px
//   stroke draw-on 480ms + ~8% tint fill at +265ms + label rise at +480ms,
//   600ms stagger, label pill 26px left-aligned 6px above its target, why-
//   note 216px white card below the pill (annotations draw on the light page
//   so they stay light regardless of overlay theme).
//
// The one deliberate non-extension affordance: a mic button in the text pill
// (the real pill reaches voice via the hover row) so visitors can trigger
// the scripted voice path. Replies are Socratic/never-the-answer by design.
//
// The parent hero triggers the same machine from its "See how it works" CTA
// via `askRef` (assigned on mount) — one machine, two entry points.

type HeroMode = 'explore' | 'coach' | 'build' | 'practice' | 'verify' | 'recover'

// Tutor-mode display data (tutor-modes.ts) + the --calyxa-mode-* tokens,
// resolved under the overlay's data-theme="dark" wrapper. The keys ARE the
// token stems, so every entry here needs a --calyxa-mode-<key>-* triple in
// theme.css. Six of the eight real modes are used — the scripted hero session
// (HERO_SESSION) walks through them; challenge/review never come up in a
// single first session, so they are left out rather than faked.
const MODES: Record<HeroMode, { name: string; glyph: string }> = {
  explore: { name: 'Exploring', glyph: '✧' },
  coach: { name: 'Coaching', glyph: '✚' },
  build: { name: 'Building', glyph: '▲' },
  practice: { name: 'Practicing', glyph: '●' },
  verify: { name: 'Verifying', glyph: '✓' },
  recover: { name: 'Recovering', glyph: '♡' },
}
const modeVar = (mode: HeroMode, part: 'text' | 'bg' | 'border') => `var(--calyxa-mode-${mode}-${part})`

export const STUCK_QUESTION = "hey calyxa — I'm stuck on this one"
const MIC_QUESTION = 'which ratio do I use here?'

// ── The scripted turns ────────────────────────────────────────────────────

// Which on-page annotation set draws while the tutor speaks.
type AnnotKind = 'stuck' | 'ratio' | 'answer' | 'solved' | 'generic' | 'none'

type Reply = { mode: HeroMode; text: string; annot: AnnotKind; followups: string[] }

// Canned replies, keyword-matched exactly as in the design script.
function replyFor(question: string): Reply {
  const q = question.toLowerCase()
  if (q.includes('stuck')) {
    return {
      mode: 'explore',
      annot: 'stuck',
      followups: ['which ratio do I use?', 'just tell me AB'],
      text: 'okay — right triangle, you know the 50° angle and the side of length 2. before I say anything: which side is AB, relative to that angle?',
    }
  }
  if (q.includes('ratio') || q.includes('sin') || q.includes('cos') || q.includes('tan')) {
    return {
      mode: 'coach',
      annot: 'ratio',
      followups: ['just tell me AB'],
      text: 'the 2 sits next to the 50° angle, and AB is the hypotenuse. adjacent and hypotenuse — which of the three ratios pairs those two?',
    }
  }
  if (q.includes('tell me') || q.includes('answer')) {
    return {
      mode: 'coach',
      annot: 'answer',
      followups: ['which ratio do I use?'],
      text: "not a chance — but you're close. set up cos 50° = 2 ÷ AB, then rearrange for AB. say the new equation out loud.",
    }
  }
  return {
    mode: 'explore',
    annot: 'generic',
    followups: ["I'm stuck on this one"],
    text: "good question. I never hand over the answer — just the step you're missing. tell me where this triangle stops making sense and we'll start there.",
  }
}

// ── On-page annotations (AnnotationLayer.tsx mirrored over the screenshot) ─
//
// Target rects live in the screenshot's own coordinate space (viewBox
// 2000×1131 = the asset's display size) so marks stay pinned to the triangle
// at any breakpoint. The label pill + why-note are HTML at the extension's
// real px sizes (26px pill, 216px note — the overlay rides the page, it
// doesn't scale with it), hidden on mobile where they'd render as specks.
// Colors are the --calyxa-annot-N ordinal triples, assigned in emission
// order per turn (assignAnnotationColors) — these tokens are NOT theme-
// flipped, so the marks stay light-on-page like the real layer.

// Units-per-rendered-px at the desktop hero width (image ~1068px wide →
// 2000/1068). Converts the extension's px paddings into viewBox units.
const U = 1.87
// Circle: ~10px x / ~6px y beyond the target (CIRCLE_PAD_X/Y).
const PAD_X = Math.round(10 * U)
const PAD_Y = Math.round(6 * U)
// Box: 6px outside the target, 10px corner radius (BOX_INSET, rx 10).
const BOX_INSET = Math.round(6 * U)
const BOX_RX = Math.round(10 * U)

type Rect = { x: number; y: number; w: number; h: number }

// Landmarks on the (triangle-shifted) screenshot.
const T_FIFTY: Rect = { x: 1533, y: 620, w: 30, h: 19 }
const T_TWO: Rect = { x: 1605, y: 663, w: 17, h: 20 }
const T_QMARK: Rect = { x: 1592, y: 489, w: 12, h: 17 }
const T_INPUT: Rect = { x: 963, y: 190, w: 106, h: 39 }
const T_TRIANGLE: Rect = { x: 1462, y: 342, w: 298, h: 352 }

type HeroMark = { shape: 'circle' | 'box'; rect: Rect; label: string; note?: string }

const ANNOT_SETS: Record<AnnotKind, HeroMark[]> = {
  stuck: [
    { shape: 'circle', rect: T_FIFTY, label: 'the angle you know' },
    { shape: 'circle', rect: T_QMARK, label: 'which side is AB?' },
  ],
  ratio: [
    { shape: 'circle', rect: T_TWO, label: 'the adjacent side', note: 'it touches the 50° angle' },
    { shape: 'circle', rect: T_QMARK, label: 'the hypotenuse — AB' },
  ],
  answer: [
    { shape: 'circle', rect: T_FIFTY, label: 'you know this angle' },
    { shape: 'box', rect: T_INPUT, label: 'yours to fill', note: 'cos 50° = 2 ÷ AB — rearrange it for AB' },
  ],
  solved: [{ shape: 'box', rect: T_INPUT, label: 'AB ≈ 3.11', note: '2 ÷ cos 50° — every step of that was yours' }],
  generic: [{ shape: 'circle', rect: T_TRIANGLE, label: 'let’s start here' }],
  // Turns that are pure conversation. A real session doesn't mark up the page
  // on every reply, and drawing on all eight would read as noise.
  none: [],
}

// AnnotationLayer.tsx's own estimates (estimateLabelWidth / estimateNoteHeight).
const estimateLabelWidth = (text: string) => Math.max(28, Math.round(text.length * 6.8) + 22)
const estimateNoteHeight = (text: string) => Math.round(Math.max(1, Math.ceil(text.length / 28)) * 19.4) + 20

// Entry motion timings (Overlay.css): 600ms stagger between marks; stroke
// draws 480ms, fill fades at +265ms, explanation rises at +480ms.
const STAGGER_S = 0.6

const annotVar = (ordinal: number, part: 'stroke' | 'fill' | 'tint' | 'tint-border' | 'deep') =>
  part === 'stroke' ? `var(--calyxa-annot-${ordinal})` : `var(--calyxa-annot-${ordinal}-${part})`

/**
 * The mock annotation layer. Mounted only while the tutor speaks, so the
 * draw-on animations restart on every reply and dissolve when the next
 * question begins (the layer's 240ms exit fade is approximated by unmount).
 */
function PageAnnotations({ kind }: { kind: AnnotKind }) {
  const marks = ANNOT_SETS[kind]
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <svg viewBox="0 0 2000 1131" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        {marks.map(({ shape, rect }, index) => {
          const ordinal = index + 1
          const delay = index * STAGGER_S
          const strokeProps = {
            fill: 'none',
            stroke: annotVar(ordinal, 'stroke'),
            strokeWidth: 2,
            vectorEffect: 'non-scaling-stroke' as const,
            pathLength: 1,
            className: 'mkt-annot-draw',
            style: { '--mkt-annot-delay': `${delay}s` } as CSSProperties,
          }
          const fillProps = {
            fill: annotVar(ordinal, 'fill'),
            stroke: 'none',
            className: 'mkt-annot-fill',
            style: { '--mkt-annot-delay': `${delay + 0.265}s` } as CSSProperties,
          }
          if (shape === 'box') {
            const box = {
              x: rect.x - BOX_INSET,
              y: rect.y - BOX_INSET,
              width: rect.w + BOX_INSET * 2,
              height: rect.h + BOX_INSET * 2,
              rx: BOX_RX,
            }
            return (
              <g key={index}>
                <rect {...box} {...fillProps} />
                <rect {...box} {...strokeProps} />
              </g>
            )
          }
          const ellipse = {
            cx: rect.x + rect.w / 2,
            cy: rect.y + rect.h / 2,
            rx: rect.w / 2 + PAD_X,
            ry: rect.h / 2 + PAD_Y,
          }
          return (
            <g key={index}>
              <ellipse {...ellipse} {...fillProps} />
              <ellipse {...ellipse} {...strokeProps} />
            </g>
          )
        })}
      </svg>
      {marks.map(({ rect, label, note }, index) => {
        const ordinal = index + 1
        // Natural placement (naturalLabelPosition): the explanation box sits
        // 6px above the target, left-aligned to its left edge, clamped to
        // the viewport (the image) on the right.
        const boxWidth = note ? Math.max(estimateLabelWidth(label), 216) : estimateLabelWidth(label)
        const above = 26 + 6 + (note ? 8 + estimateNoteHeight(note) : 0)
        return (
          <div
            key={index}
            className="mkt-annot-explain absolute hidden flex-col items-start gap-2 sm:flex"
            style={
              {
                left: `min(${((rect.x / 2000) * 100).toFixed(2)}%, calc(100% - ${boxWidth + 4}px))`,
                top: `calc(${((rect.y / 1131) * 100).toFixed(2)}% - ${above}px)`,
                '--mkt-annot-delay': `${index * STAGGER_S + 0.48}s`,
              } as CSSProperties
            }
          >
            <span
              className="inline-flex h-[26px] items-center whitespace-nowrap rounded-full px-[11px] text-[12px] font-semibold"
              style={{
                background: annotVar(ordinal, 'tint'),
                border: `1px solid ${annotVar(ordinal, 'tint-border')}`,
                color: annotVar(ordinal, 'deep'),
                boxShadow: '0 1px 2px rgba(15, 23, 42, 0.06)',
              }}
            >
              {label}
            </span>
            {note && (
              <span
                className="flex w-[216px] gap-2 rounded-xl px-3 py-[9px] text-left text-[12.5px] leading-[1.55]"
                style={{
                  background: 'rgba(255, 255, 255, 0.94)',
                  border: '1px solid #e5e3de',
                  color: '#46463f',
                  boxShadow: '0 4px 14px rgba(15, 23, 42, 0.08)',
                }}
              >
                <span
                  className="mt-[6px] h-1.5 w-1.5 flex-none rounded-full"
                  style={{ background: annotVar(ordinal, 'stroke') }}
                />
                {note}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── The overlay's presentational bits (Overlay.tsx mirrored) ──────────────

// PillWave: 5 bars, heights [11,18,22,15,9], 3px wide, 3px gap, r2.
const WAVE_HEIGHTS = [11, 18, 22, 15, 9]

function PillWave({ color, durationS }: { color: string; durationS: number }) {
  return (
    <span aria-hidden="true" className="flex h-[22px] items-center gap-[3px]">
      {WAVE_HEIGHTS.map((height, index) => (
        <span
          key={index}
          className="mkt-wavebar block w-[3px] rounded-[2px]"
          style={
            {
              height,
              background: color,
              '--mkt-wave-duration': `${durationS}s`,
              '--mkt-wave-delay': `${(index * (durationS < 1 ? 0.1 : 0.12)).toFixed(2)}s`,
            } as CSSProperties
          }
        />
      ))}
    </span>
  )
}

// The streaming caret (2.5×13px, r2, accent, step-end blink).
function StreamCaret() {
  return (
    <span
      aria-hidden="true"
      className="mkt-caret inline-block w-[2.5px] rounded-[2px] bg-(--color-accent)"
      style={{ height: 13, marginLeft: 3, verticalAlign: -2 }}
    />
  )
}

function ThinkDots() {
  return (
    <span aria-label="Thinking" role="status" className="flex flex-none items-center gap-1 px-1.5">
      {[0, 0.18, 0.36].map((delay) => (
        <span
          key={delay}
          aria-hidden="true"
          className="mkt-thinkdot h-[5px] w-[5px] rounded-full bg-(--color-accent-emphasis)"
          style={{ '--mkt-think-delay': `${delay}s` } as CSSProperties}
        />
      ))}
    </span>
  )
}

function MicIcon({ className, stroke }: { className: string; stroke: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z" />
      <path d="M6 11a6 6 0 0 0 12 0" />
      <path d="M12 17v3" />
    </svg>
  )
}

// Streaming word tokens: stable per-index keys so only new words run the
// word-in entry (StreamTokens' machinery).
function StreamWords({ text }: { text: string }) {
  const words = text ? text.split(' ') : []
  return (
    <>
      {words.map((word, index) => (
        <span key={index} className="mkt-word-in inline-block whitespace-pre-wrap">
          {index < words.length - 1 ? `${word} ` : word}
        </span>
      ))}
    </>
  )
}

// ── The demo state machine ────────────────────────────────────────────────

type HeroPhase = '' | 'fillq' | 'think' | 'speak'

type DemoState = {
  q: string
  pendingQ: string
  asked: string
  full: string
  typed: string
  transcript: string
  mode: HeroMode
  phase: HeroPhase
  listening: boolean
  voice: boolean
  annot: AnnotKind
  followups: string[]
}

const IDLE: DemoState = {
  q: '',
  pendingQ: '',
  asked: '',
  full: '',
  typed: '',
  transcript: '',
  mode: 'coach',
  phase: '',
  listening: false,
  voice: false,
  annot: 'generic',
  followups: [],
}

// The initial floating suggestion chips (marketing entry point).
const CHIPS: Array<{ full: string; short: string | null; question: string }> = [
  { full: '“hey calyxa — I’m stuck on this one”', short: '“I’m stuck on this one”', question: STUCK_QUESTION },
  { full: '“which ratio do I use?”', short: '“which ratio do I use?”', question: MIC_QUESTION },
  { full: '“just tell me AB”', short: null, question: 'just tell me what AB is' },
]

// The pill's shape map (PILL_SHAPES: text 540×54 r27 / listen 204×52 r26 /
// think 152×46 r23 / speak 216×52 r26), scaled down on mobile. Static class
// strings so the Tailwind scanner sees them.
type PillShape = 'text' | 'listen' | 'think' | 'speak'
const PILL_SHAPE_CLASSES: Record<PillShape, string> = {
  text: 'h-[42px] w-full rounded-[21px] sm:h-[54px] sm:w-[540px] sm:rounded-[27px]',
  listen: 'h-10 w-40 rounded-[20px] sm:h-[52px] sm:w-[204px] sm:rounded-[26px]',
  think: 'h-9 w-[120px] rounded-[18px] sm:h-[46px] sm:w-[152px] sm:rounded-[23px]',
  speak: 'h-10 w-[170px] rounded-[20px] sm:h-[52px] sm:w-[216px] sm:rounded-[26px]',
}

// The trig-problem follow-up chips carried on an auto-opened reply, so the
// scripted flow (replyFor keyword matching) continues from the personalized
// opening exactly as it would from the "I'm stuck" chip.
const OPENING_FOLLOWUPS = ['which ratio do I use?', 'just tell me AB']

// ── The scripted session (landing hero, `script` prop) ────────────────────
//
// One whole tutoring session, start to finish, played on a loop: the student
// arrives stuck, gets a ratio wrong, is walked back through SOH-CAH-TOA rather
// than corrected, sets the equation up themselves, solves it, and leaves with
// a study kit. That arc is the product claim — so it is spelled out here as a
// fixed sequence rather than left to replyFor's keyword matching, which can
// only answer one question at a time and has no ending.
//
// Every tutor line obeys the same rule the real tutor does: it asks the next
// question, it never hands over the answer. The one place a number appears
// (turn 7) is arithmetic the student has already fully derived.

export type ScriptedTurn = {
  /** What the student says — typed out as a live voice transcript. */
  student: string
  /** The tutor's reply — streamed word by word into the caption. */
  reply: string
  mode: HeroMode
  /** Which on-page marks draw while this reply streams ('none' for none). */
  annot: AnnotKind
}

export const HERO_SESSION: ScriptedTurn[] = [
  {
    student: "hey calyxa — I'm stuck on this one",
    mode: 'explore',
    annot: 'stuck',
    reply:
      'okay — right triangle, you know the 50° angle and the side of length 2. before I say anything: which side is AB, relative to that angle?',
  },
  {
    student: 'the long one? the hypotenuse',
    mode: 'coach',
    annot: 'ratio',
    reply:
      "that's it. and the 2 sits right against the 50°, so that one's the adjacent side. adjacent and hypotenuse — which of the three ratios pairs those two?",
  },
  {
    student: 'sine?',
    mode: 'recover',
    annot: 'none',
    reply:
      "not quite — sine is opposite over hypotenuse. say the three out loud with me: soh, cah, toa. which one has adjacent and hypotenuse in it?",
  },
  {
    student: 'oh — cah. so cosine',
    mode: 'build',
    annot: 'none',
    reply: 'there it is. so write the equation out: cos 50° equals what, over what?',
  },
  {
    student: 'cos 50 equals 2 over AB',
    mode: 'coach',
    annot: 'answer',
    reply:
      "exactly right, and you set that up yourself. now AB is stuck underneath. what would you do to both sides to get it out of the denominator?",
  },
  {
    student: 'multiply both sides by AB',
    mode: 'verify',
    annot: 'none',
    reply: 'good — that gives you AB times cos 50° = 2. one move left before AB is alone. what is it?',
  },
  {
    student: 'divide by cos 50. so AB is 2 over cos 50',
    mode: 'verify',
    annot: 'solved',
    reply: "that's the whole thing. run it on your calculator: 2 ÷ cos 50° ≈ 3.11. type it in and hit check.",
  },
  {
    student: 'it worked — 3.11',
    mode: 'practice',
    annot: 'none',
    reply:
      "and every step of that was yours. I'm keeping the one you slipped on — sine vs cosine — and I'll put two more like it in your notes for later.",
  },
]

// Reading beats between scripted turns, and the longer breath before the
// session starts over from the top.
const SCRIPT_START_MS = 1400
const SCRIPT_TURN_HOLD_MS = 2600
const SCRIPT_RESTART_HOLD_MS = 4600

export function HeroDemo({
  askRef,
  showPlaceholders,
  autoOpen = false,
  openingText,
  voiceOnly = false,
  script,
  interactive = true,
}: {
  askRef?: MutableRefObject<((question: string) => void) | null>
  showPlaceholders: boolean
  // Pre-signup onboarding (components/onboarding/PreflightWizard.tsx) only:
  // when `autoOpen` is set with an `openingText`, the demo starts a session on
  // mount and streams that personalized first line (referencing the student's
  // pain point) instead of resting on the idle suggestion chips. Both default
  // off, so the landing page renders the demo exactly as before.
  autoOpen?: boolean
  openingText?: string
  // Landing v6 hero (Darcy, 2026-07-24): drop the wide text composer entirely
  // and run the demo as a pure voice session — the pill only ever wears its
  // listen / think / speak shapes, and every question (autoplay, chips,
  // followups) goes in through the microphone path. The full pill, composer
  // included, is still what /start and the pill harness render.
  voiceOnly?: boolean
  // Landing v6 hero (Darcy, 2026-07-24): a fixed session to play on a loop
  // (HERO_SESSION). When set, the demo drives ITSELF turn by turn and the
  // replyFor keyword matcher is bypassed entirely — every reply comes from the
  // script. `askRef` is still published, but nothing on the landing calls it.
  script?: ScriptedTurn[]
  // false = play-only: no suggestion chips, no follow-up chips, and the whole
  // overlay is pointer-transparent, so the demo is a film rather than a toy.
  interactive?: boolean
}) {
  // Deadlines live outside React state so the 80ms tick reads them without
  // re-subscribing (mirrors the script's instance fields). Declared before
  // `state` so the auto-open initializer below can arm the first deadline.
  const [deadlines] = useState(() => ({ at: 0 }))
  // Scripted-session cursor: which turn is playing, and when its reading beat
  // is up. Same reasoning as `deadlines` — the tick reads it without
  // re-subscribing.
  const [cursor] = useState(() => ({ turn: 0, holdAt: 0 }))
  const [state, setState] = useState<DemoState>(() => {
    if (autoOpen && openingText) {
      deadlines.at = Date.now() + 950
      // A grounded 'stuck' reply carrying the personalized opening line: the
      // 'stuck' annotation set (the 50° angle + "which side is AB?") matches
      // the shared trig question every opening line pivots to.
      return {
        ...IDLE,
        asked: '__auto__',
        full: openingText,
        mode: 'explore',
        annot: 'stuck',
        followups: OPENING_FOLLOWUPS,
        phase: 'think',
      }
    }
    return IDLE
  })

  // Commit a question: think for ~950ms, then the reply streams. `scripted`
  // overrides the keyword matcher when a fixed session is playing.
  const send = (s: DemoState, question: string, voice: boolean, scripted?: Reply): DemoState => {
    const reply = scripted ?? replyFor(question)
    deadlines.at = Date.now() + 950
    return {
      ...s,
      asked: question,
      full: reply.text,
      mode: reply.mode,
      annot: reply.annot,
      followups: reply.followups,
      typed: '',
      q: '',
      pendingQ: '',
      transcript: '',
      phase: 'think',
      listening: false,
      voice,
    }
  }

  // Public ask (chips, CTA, in-card followups): the question first fills the
  // composer like a typed message, then sends.
  const askTyped = (question: string) => {
    if (!question.trim()) return
    deadlines.at = Date.now() + 700
    setState((s) => ({ ...s, q: question, pendingQ: question, phase: 'fillq', listening: false, voice: false }))
  }

  // The voice equivalent: the question arrives as a live transcript that types
  // itself out, then commits as a spoken turn. `voiceOnly` routes every entry
  // point through here, so the composer never opens.
  const askSpoken = (question: string) => {
    if (!question.trim()) return
    setState((s) => {
      if (s.listening) return s
      deadlines.at = Date.now() + 400
      return { ...s, listening: true, transcript: '', q: '', pendingQ: question, phase: '', voice: true }
    })
  }

  const ask = voiceOnly ? askSpoken : askTyped

  const submitTyped = () => {
    setState((s) => (s.q.trim() ? send(s, s.q, false) : s))
  }

  const startListening = () => {
    setState((s) => {
      if (s.listening) return s
      deadlines.at = Date.now() + 400
      return { ...s, listening: true, transcript: '', q: '', pendingQ: MIC_QUESTION, phase: '' }
    })
  }

  // Start the scripted turn at `cursor.turn`: the student speaks, and the tick
  // takes it from there.
  const speakTurn = (turns: ScriptedTurn[]) => {
    deadlines.at = Date.now() + 400
    setState((s) => ({
      ...s,
      listening: true,
      transcript: '',
      q: '',
      pendingQ: turns[cursor.turn].student,
      phase: '',
      voice: true,
    }))
  }

  useEffect(() => {
    if (askRef) askRef.current = ask
    // A session that loops forever is exactly the kind of motion
    // prefers-reduced-motion asks us to stop, and there are no playback
    // controls to offer instead (the demo is play-only). So under reduced
    // motion the script does not run at all: the demo settles on one finished
    // turn — tutor reply held, marks on the page — as a still frame that says
    // the same thing. The CSS draw-on/stream animations are already disabled
    // by marketing.css's reduced-motion block.
    const playScript =
      script && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? script : undefined
    if (script && !playScript) {
      const still = script[0]
      setState((s) => ({
        ...s,
        asked: still.student,
        full: still.reply,
        typed: still.reply,
        mode: still.mode,
        annot: still.annot,
        followups: [],
        phase: 'speak',
        listening: false,
        voice: true,
      }))
    }
    const tick = setInterval(() => {
      setState((s) => {
        if (s.listening) {
          // The live transcript types word-by-word, holds a beat, then sends.
          // `pendingQ` carries whichever question is being spoken (the mic
          // button's own, or one handed in through askSpoken/the script).
          const spoken = s.pendingQ || MIC_QUESTION
          const words = spoken.split(' ')
          const count = s.transcript ? s.transcript.split(' ').length : 0
          if (count < words.length) {
            if (Date.now() < deadlines.at) return s
            deadlines.at = Date.now() + 160
            return { ...s, transcript: words.slice(0, count + 1).join(' ') }
          }
          if (Date.now() < deadlines.at + 500) return s
          const turn = playScript?.[cursor.turn]
          return send(
            s,
            spoken,
            true,
            turn && { mode: turn.mode, annot: turn.annot, followups: [], text: turn.reply }
          )
        }
        if (s.phase === 'fillq') {
          return Date.now() >= deadlines.at ? send(s, s.pendingQ, false) : s
        }
        if (s.phase === 'think') {
          return Date.now() >= deadlines.at ? { ...s, phase: 'speak' } : s
        }
        if (s.phase === 'speak' && s.typed.length < s.full.length) {
          const words = s.full.split(' ')
          const count = s.typed ? s.typed.split(' ').length : 0
          return { ...s, typed: words.slice(0, count + 1).join(' ') }
        }
        // The reply has finished streaming. In scripted mode, hold it long
        // enough to read, then take the next turn — wrapping to turn 0 after
        // the last one, so the session plays forever.
        if (playScript && s.phase === 'speak') {
          const last = cursor.turn === playScript.length - 1
          if (cursor.holdAt === 0) {
            cursor.holdAt = Date.now() + (last ? SCRIPT_RESTART_HOLD_MS : SCRIPT_TURN_HOLD_MS)
            return s
          }
          if (Date.now() < cursor.holdAt) return s
          cursor.holdAt = 0
          cursor.turn = last ? 0 : cursor.turn + 1
          deadlines.at = Date.now() + 400
          return {
            ...s,
            listening: true,
            transcript: '',
            q: '',
            pendingQ: playScript[cursor.turn].student,
            phase: '',
            voice: true,
          }
        }
        return s
      })
    }, 80)
    const opening = playScript ? setTimeout(() => speakTurn(playScript), SCRIPT_START_MS) : undefined
    return () => {
      clearInterval(tick)
      if (opening) clearTimeout(opening)
      if (askRef) askRef.current = null
    }
    // Mount-only on purpose: the tick reads everything through functional
    // setState + the deadlines/cursor objects, so re-subscribing per render
    // would only churn the interval.
  }, [])

  const mode = MODES[state.mode]
  const streaming = state.phase === 'speak' && state.typed.length < state.full.length
  const busy = state.phase === 'think' || streaming
  const sessionLive = state.asked !== '' || state.phase !== '' || state.listening

  // Which pill shape (PillState): voice turns morph listen → think → speak;
  // text turns keep the composer open with dots in the right slot. Under
  // `voiceOnly` there are no text turns, so the shape that would have been the
  // composer rests at `listen` instead — the pill waiting for you to speak.
  const pillShape: PillShape = state.listening
    ? 'listen'
    : (state.voice || voiceOnly) && state.phase === 'think'
      ? 'think'
      : (state.voice || voiceOnly) && streaming
        ? 'speak'
        : voiceOnly
          ? 'listen'
          : 'text'

  // Glow: opacity steps with attention state; tints to the mode while
  // speaking (Overlay.tsx's glowOpacity/glowBackground). Under voiceOnly the
  // resting shape IS 'listen', so key the bright step off actually listening
  // rather than the shape, or the pill would never dim between turns.
  const glowOpacity =
    (pillShape === 'listen' && (state.listening || !voiceOnly)) || pillShape === 'speak'
      ? 0.8
      : busy
        ? 0.62
        : 0.42
  const glowBackground =
    pillShape === 'speak'
      ? `radial-gradient(closest-side, ${modeVar(state.mode, 'border')} 0%, ${modeVar(state.mode, 'border')} 48%, transparent 74%)`
      : 'radial-gradient(closest-side, var(--color-accent-glow) 0%, var(--color-accent-glow-strong) 48%, transparent 74%)'

  // The single transient surface (exactly one at a time).
  const surface: 'transcript' | 'caption' | null = state.listening
    ? 'transcript'
    : state.phase === 'speak'
      ? 'caption'
      : null

  return (
    <div id="hero-demo" className="relative mt-8 flex w-full max-w-[1020px] flex-col gap-2 sm:mt-12 sm:gap-3">
      {/* mac desktop backdrop */}
      <div
        className="relative overflow-hidden rounded-[14px] border border-[rgba(28,28,26,0.12)] sm:rounded-[18px]"
        style={{
          background: 'radial-gradient(120% 160% at 12% -10%, #2fb56d 0%, #14532d 48%, #0b2317 100%)',
          boxShadow: '0 60px 120px -36px rgba(28,40,30,0.5), 0 4px 16px rgba(28,40,30,0.1)',
        }}
      >
        {/* menu bar */}
        <div
          className="flex h-[18px] items-center gap-[9px] px-2.5 text-[7.5px] font-medium text-white/80 sm:h-7 sm:gap-[15px] sm:px-4 sm:text-[11px]"
          style={{ background: 'rgba(8,12,9,0.35)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)' }}
        >
          <span className="font-bold">Chrome</span>
          <span>File</span>
          <span>Edit</span>
          <span>View</span>
          <span>History</span>
          <span className="hidden sm:inline">Bookmarks</span>
          <span className="hidden sm:inline">Window</span>
          <span className="hidden sm:inline">Help</span>
          <span className="ml-auto flex gap-2 text-white/70 sm:gap-4">
            <span>Sat Jul 19</span>
            <span>11:25 AM</span>
          </span>
        </div>

        {/* Chrome window */}
        <div
          className="relative mx-auto mt-3.5 w-[92%] rounded-t-[8px] bg-white sm:mt-[26px] sm:w-[89%] sm:rounded-t-[12px]"
          style={{ boxShadow: '0 40px 90px rgba(0,0,0,0.5)' }}
        >
          {/* tab bar */}
          <div className="flex h-6 items-center gap-1.5 rounded-t-[8px] bg-[#dfe1e5] px-[9px] sm:h-[38px] sm:gap-2.5 sm:rounded-t-[12px] sm:px-3.5">
            <span className="mr-0.5 flex gap-1 sm:mr-1.5 sm:gap-[7px]">
              <span className="h-[7px] w-[7px] rounded-full bg-[#ff5f57] sm:h-[11px] sm:w-[11px]" />
              <span className="h-[7px] w-[7px] rounded-full bg-[#febc2e] sm:h-[11px] sm:w-[11px]" />
              <span className="h-[7px] w-[7px] rounded-full bg-[#28c840] sm:h-[11px] sm:w-[11px]" />
            </span>
            <span className="flex h-[18px] min-w-0 items-center gap-[5px] self-end overflow-hidden whitespace-nowrap rounded-t-[6px] bg-white px-[9px] text-[8px] text-[#3c4043] sm:h-[30px] sm:gap-2 sm:rounded-t-[9px] sm:px-4 sm:text-[11.5px]">
              <span className="h-2 w-2 flex-none rounded-full bg-[#14bf96] sm:h-[11px] sm:w-[11px]" />
              Solve for a side in right triangles | Khan Academy
              <span className="ml-2 hidden text-[#9aa0a6] sm:inline">✕</span>
            </span>
          </div>
          {/* url bar row */}
          <div className="flex h-[22px] items-center gap-[7px] border-b border-[#e8eaed] bg-white px-[9px] sm:h-9 sm:gap-3 sm:px-4">
            <span className="hidden gap-3.5 text-[13px] text-[#5f6368] sm:flex">
              <span>←</span>
              <span className="text-[#bdc1c6]">→</span>
              <span>⟳</span>
            </span>
            <span className="flex h-[15px] flex-1 items-center gap-2 overflow-hidden whitespace-nowrap rounded-full bg-[#f1f3f4] px-2 text-[7.5px] text-[#3c4043] sm:h-[26px] sm:px-[13px] sm:text-[11.5px]">
              <span className="hidden h-[9px] w-[9px] flex-none rounded-[2px] border-[1.5px] border-[#5f6368] sm:block" />
              khanacademy.org/math/trigonometry/right-triangles-trig
            </span>
            <span className="flex items-center gap-[3px] sm:gap-[5px]">
              <CalyxaMark className="h-[11px] w-[11px] sm:h-4 sm:w-4" />
              <span className="h-1 w-1 rounded-full bg-[#28c840] sm:h-1.5 sm:w-1.5" />
            </span>
          </div>

          {/* page content */}
          <div className="relative">
            <img
              src="/hero-khan.png"
              alt="Khan Academy — solve for a side in right triangles"
              className="block w-full"
            />
            <div
              className="pointer-events-none absolute inset-0"
              style={{ background: 'linear-gradient(180deg, transparent 50%, rgba(10,16,11,0.24) 100%)' }}
              aria-hidden="true"
            />

            {/* live annotations while the tutor speaks */}
            {state.phase === 'speak' && <PageAnnotations kind={state.annot} />}

            {/* "sees this page" badge */}
            <span
              className="absolute right-2 top-[7px] flex items-center gap-1 rounded-full border border-[rgba(134,239,172,0.35)] px-[7px] py-[3px] text-[7.5px] font-semibold text-[#86EFAC] sm:right-4 sm:top-3.5 sm:gap-1.5 sm:px-[11px] sm:py-[5px] sm:text-[10.5px]"
              style={{
                background: 'rgba(24,26,23,0.72)',
                backdropFilter: 'blur(14px)',
                WebkitBackdropFilter: 'blur(14px)',
              }}
            >
              <CalyxaMark className="h-[9px] w-[9px] flex-none sm:h-3 sm:w-3" /> sees this page
            </span>

            {/* ── The overlay column (Overlay.tsx's render): ONE centered
                stack — a single transient surface above the pill, dark theme
                stamped exactly like the extension does. ── */}
            <div
              data-theme="dark"
              className={`absolute inset-x-0 bottom-2 flex flex-col items-center gap-2 px-3 sm:bottom-[18px] sm:gap-3.5 sm:px-6 ${
                interactive ? '' : 'pointer-events-none select-none'
              }`}
            >
              {/* the single transient surface slot */}
              {surface === 'transcript' && (
                <div
                  key="transcript"
                  className="mkt-surface-pop flex max-w-[280px] items-start gap-2.5 rounded-[17px] px-[13px] py-[9px] sm:max-w-[440px] sm:px-[17px] sm:py-[13px]"
                  style={{
                    background: 'rgba(24, 26, 23, 0.86)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    backdropFilter: 'blur(22px) saturate(1.5)',
                    WebkitBackdropFilter: 'blur(22px) saturate(1.5)',
                    boxShadow: '0 18px 44px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.35)',
                  }}
                >
                  <MicIcon className="mt-[3px] h-[15px] w-[15px] flex-none" stroke="var(--color-muted-foreground)" />
                  <div className="flex flex-col gap-[3px]">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-(--color-muted-foreground)">
                      You
                    </span>
                    <p className="m-0 text-left text-[12px] leading-[1.55] text-(--color-foreground) sm:text-[14px]">
                      {state.transcript}
                      <StreamCaret />
                    </p>
                  </div>
                </div>
              )}
              {surface === 'caption' && (
                <div
                  key="caption"
                  className="mkt-surface-pop flex max-w-[280px] items-start gap-2.5 rounded-[17px] px-[13px] py-[9px] sm:max-w-[460px] sm:px-[17px] sm:py-[13px]"
                  style={{
                    background: 'rgba(24, 26, 23, 0.86)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    backdropFilter: 'blur(22px) saturate(1.5)',
                    WebkitBackdropFilter: 'blur(22px) saturate(1.5)',
                    boxShadow: '0 18px 44px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.35)',
                  }}
                >
                  <CalyxaMark aria-hidden="true" className="mt-0.5 h-[13px] w-[13px] flex-none sm:h-[17px] sm:w-[17px]" />
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <span
                      className="flex items-center gap-[5px] self-start rounded-full px-[9px] py-[3px] text-[9px] font-semibold uppercase tracking-[0.09em] sm:text-[10px]"
                      style={{ color: modeVar(state.mode, 'text'), background: modeVar(state.mode, 'bg') }}
                    >
                      {mode.glyph}&nbsp;{mode.name}
                    </span>
                    <p
                      className="m-0 text-left text-[12px] leading-[1.55] text-(--color-foreground) sm:text-[14px]"
                      aria-live="polite"
                    >
                      {streaming ? <StreamWords text={state.typed} /> : state.full}
                      {streaming && <StreamCaret />}
                    </p>
                    {/* the held reply's in-card follow-up chips */}
                    {interactive && !streaming && state.followups.length > 0 && (
                      <div className="mt-1 flex flex-wrap items-center gap-[7px] border-t border-(--color-border) pt-2.5">
                        {state.followups.map((chip) => (
                          <button
                            key={chip}
                            type="button"
                            onClick={() => setState((s) => send(s, chip, false))}
                            className="cursor-pointer rounded-full border border-(--color-border) bg-(--color-background) px-[11px] py-[5px] text-[11px] leading-normal text-(--calyxa-chip-text) transition-colors hover:border-(--color-accent) sm:text-[12px]"
                          >
                            {chip}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {/* the floating suggestion chips (marketing entry, idle only) */}
              {interactive && !surface && !state.asked && state.phase === '' && (
                <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2">
                  {CHIPS.map((chip) => (
                    <button
                      key={chip.question}
                      type="button"
                      onClick={() => ask(chip.question)}
                      className={`${chip.short === null ? 'hidden sm:inline-flex' : 'inline-flex'} cursor-pointer rounded-full border border-[rgba(28,28,26,0.16)] px-2.5 py-[5px] text-[10px] text-[#3f3f3a] transition-colors hover:border-[#1f9d5b] hover:text-[#1c1c1a] sm:px-3.5 sm:py-[7px] sm:text-[13px]`}
                      style={{
                        background: 'rgba(255,255,255,0.78)',
                        backdropFilter: 'blur(12px)',
                        WebkitBackdropFilter: 'blur(12px)',
                      }}
                    >
                      <span className={chip.short === null ? undefined : 'hidden sm:inline'}>{chip.full}</span>
                      {chip.short !== null && <span className="sm:hidden">{chip.short}</span>}
                    </button>
                  ))}
                </div>
              )}

              {/* the morphing ambient pill */}
              <div className="relative flex w-full max-w-[560px] justify-center sm:w-auto sm:max-w-none">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute rounded-full"
                  style={{
                    inset: -1,
                    background: glowBackground,
                    filter: 'blur(10px)',
                    opacity: glowOpacity,
                    transition: 'opacity 0.6s ease',
                  }}
                >
                  <span className="mkt-breathe block h-full w-full" />
                </div>
                <div
                  className={`relative flex items-center justify-center overflow-hidden ${PILL_SHAPE_CLASSES[pillShape]}`}
                  style={{
                    background: 'rgba(24, 26, 23, 0.78)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    backdropFilter: 'blur(24px) saturate(1.5)',
                    WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
                    boxShadow: '0 18px 44px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.35)',
                    transition:
                      'width 0.55s cubic-bezier(0.32, 1.4, 0.36, 1), height 0.55s cubic-bezier(0.32, 1.4, 0.36, 1), border-radius 0.55s cubic-bezier(0.32, 1.4, 0.36, 1)',
                  }}
                >
                  {/* the breathing tutor-mode frame while a session is live */}
                  {sessionLive && (
                    <span
                      aria-hidden="true"
                      className="mkt-mode-frame"
                      style={{ '--mkt-mode-frame-color': modeVar(state.mode, 'border') } as CSSProperties}
                    />
                  )}
                  {pillShape === 'text' && (
                    <div key="text" className="mkt-pillfade flex w-full items-center gap-2 pl-3 pr-2 sm:gap-2.5 sm:pl-4 sm:pr-2.5">
                      <CalyxaMark aria-hidden="true" className="h-3.5 w-3.5 flex-none sm:h-[18px] sm:w-[18px]" />
                      <input
                        type="text"
                        value={state.q}
                        onChange={(event) => setState((s) => ({ ...s, q: event.target.value }))}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') submitTyped()
                        }}
                        readOnly={busy || state.phase === 'fillq'}
                        placeholder={state.asked ? 'Answer here — or ask anything…' : 'Ask about this problem…'}
                        aria-label="Ask calyxa"
                        className="min-w-0 flex-1 border-none bg-transparent p-0 text-[11.5px] text-(--color-foreground) caret-(--color-accent) outline-none placeholder:text-(--color-muted-foreground) sm:text-[14.5px]"
                      />
                      {busy ? (
                        <ThinkDots />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="flex-none rounded-[7px] border border-(--color-border) bg-[rgba(255,255,255,0.07)] px-[7px] py-[3px] text-[9px] font-semibold text-(--color-muted-foreground) sm:text-[10.5px]"
                        >
                          ↵
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={startListening}
                        title="Talk instead"
                        aria-label="Talk instead"
                        className="flex h-[26px] w-[26px] flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 transition-colors hover:bg-[rgba(134,239,172,0.12)] sm:h-7 sm:w-7"
                      >
                        <MicIcon className="w-[13px] flex-none sm:w-[15px]" stroke="var(--color-accent-emphasis)" />
                      </button>
                    </div>
                  )}
                  {pillShape === 'listen' && (
                    <span key="listen" className="mkt-pillfade flex items-center gap-[11px] whitespace-nowrap">
                      <PillWave color="var(--color-foreground)" durationS={1} />
                      <span className="text-[11px] font-medium text-(--color-muted-foreground) sm:text-[13px]">
                        Listening
                      </span>
                    </span>
                  )}
                  {pillShape === 'think' && (
                    <span key="think" className="mkt-pillfade flex items-center gap-[9px] whitespace-nowrap">
                      <ThinkDots />
                      <span className="text-[11px] font-medium text-(--color-muted-foreground) sm:text-[13px]" role="status">
                        Thinking
                      </span>
                    </span>
                  )}
                  {pillShape === 'speak' && (
                    <span key="speak" className="mkt-pillfade flex items-center gap-[11px] whitespace-nowrap">
                      <PillWave color={modeVar(state.mode, 'border')} durationS={0.85} />
                      <span className="text-[11px] font-medium sm:text-[13px]" style={{ color: modeVar(state.mode, 'text') }}>
                        {mode.glyph}&nbsp;&nbsp;{mode.name}
                      </span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {showPlaceholders && (
        <p className="m-0 text-center text-[9.5px] text-[#6f6f68] sm:text-[11px]">
          scripted demo — the real calyxa floats over your actual homework tab
        </p>
      )}
    </div>
  )
}
