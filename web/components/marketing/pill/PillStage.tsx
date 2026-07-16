import type { CSSProperties } from 'react'
import {
  AmbientPill,
  AnnotLabel,
  CaptionSurface,
  ConceptSurface,
  EchoChip,
  MathSurface,
  PillGlow,
  PingChip,
  StepBadge,
  TermMark,
  TranscriptSurface,
  WhyNote,
  annotVar,
} from '@/components/marketing/pill/overlay'

// The scrollytelling stage (Landing v3): one continuous session rendered as
// four scrub-addressable frames in the pill language — the retired panel
// vocabulary (chat bubbles, board strip, milestone rows, header timer)
// never appears. Each frame is a pure render of (beat); SessionShowcase's
// scroll scrub keys the pinned stage on the active beat, so entering a beat
// (in either scroll direction — that's the rewind) replays its draw-on and
// surface-pop entrances via the mkt-* CSS animations, which no-op to their
// end state under prefers-reduced-motion.

export const PILL_BEAT_ALTS = [
  'The overlay draws on the worksheet: a green "Start here" box around x² + 5x + 6 = 0, an amber ellipse and step badge on 5x with a why-note, a blue ellipse on 6, while the tutor speaks in Exploring mode with the same colors echoed in its caption.',
  'A sage "Key concept understood" ping above the math surface, which carries x² + 5x + 6 = 0 down to its factored form (x + 2)(x + 3) = 0 while the pill speaks in Building mode.',
  'The predicted slip happens: x = 2 instead of x = −2 gets an amber "Check this sign" mark, an amber "Misconception confirmed" ping fires, a card recalls the pre-session prediction, and the pill switches to Coaching.',
  'The student talks it through out loud — the transcript surface streams their reasoning while the pill listens with its glow up.',
] as const

export const PILL_STAGE_ALT =
  'Pinned recreation of the Calyxa ambient pill working through x² + 5x + 6 = 0 as you scroll: annotations draw onto the equation, pings and the math surface track the win, the predicted sign error switches the pill into coaching, and the session ends spoken out loud.'

function SheetKicker() {
  return (
    <p className="m-0 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-(--mkt-faint)">
      Problem 2 · solve by factoring
    </p>
  )
}

function Frame({ beat }: { beat: number }) {
  switch (beat) {
    case 0:
      return (
        <>
          <div className="px-[34px] py-7">
            <SheetKicker />
            <div className="ml-[30px] mt-[66px]">
              <span className="relative inline-block whitespace-nowrap text-[30px] font-medium tracking-[0.02em] text-foreground">
                {/* The green "Start here" box around the whole equation */}
                <svg
                  aria-hidden="true"
                  className="pointer-events-none absolute overflow-visible"
                  style={{ left: -18, top: -13, width: 'calc(100% + 36px)', height: 'calc(100% + 26px)' }}
                >
                  <rect
                    x="1"
                    y="1"
                    width="99%"
                    height="95%"
                    rx="11"
                    fill={annotVar('green', 'fill')}
                    stroke={annotVar('green', 'stroke')}
                    strokeWidth="2"
                    pathLength={1}
                    className="mkt-annot-draw"
                    style={{ '--mkt-annot-delay': '0.1s' } as CSSProperties}
                  />
                </svg>
                <span
                  className="mkt-annot-fill absolute -left-10 -top-16 inline-flex h-[25px] items-center whitespace-nowrap rounded-full px-2.5 text-[11.5px] font-semibold"
                  style={
                    {
                      background: annotVar('green', 'tint'),
                      border: `1px solid ${annotVar('green', 'tint-border')}`,
                      color: annotVar('green', 'deep'),
                      '--mkt-annot-delay': '0.4s',
                    } as CSSProperties
                  }
                >
                  Start here
                </span>
                x² +{' '}
                <TermMark tone="amber" pad={9} animate drawDelay={0.5} fillDelay={0.8}>
                  5x
                  <StepBadge tone="amber" n={1} style={{ left: 'calc(50% + 46px)', top: -40 }} />
                  <AnnotLabel tone="amber" side="above" offset={38} animate delay={1}>
                    Add to 5
                  </AnnotLabel>
                </TermMark>{' '}
                +{' '}
                <TermMark tone="blue" pad={10} animate drawDelay={1.1} fillDelay={1.4}>
                  6
                  <StepBadge tone="blue" n={2} style={{ left: 'calc(50% + 58px)', bottom: -42 }} />
                  <AnnotLabel tone="blue" side="below" offset={40} animate delay={1.6}>
                    Multiply to 6
                  </AnnotLabel>
                </TermMark>{' '}
                = 0
                {/* The amber arrow out to the why-note */}
                <svg aria-hidden="true" className="absolute max-xl:hidden" style={{ left: 'calc(100% + 8px)', top: -36, width: 34, height: 36, overflow: 'visible' }}>
                  <path d="M2,30 C10,24 20,15 30,9" fill="none" stroke={annotVar('amber', 'stroke')} strokeWidth="1.5" strokeLinecap="round" opacity=".8" />
                  <path d="M30,9 L22,9 M30,9 L26,16" fill="none" stroke={annotVar('amber', 'stroke')} strokeWidth="1.5" strokeLinecap="round" opacity=".8" />
                </svg>
                <WhyNote tone="amber" className="absolute w-[182px] max-xl:hidden" style={{ left: 'calc(100% + 44px)', top: -64 }}>
                  b is what the two numbers add up to.
                </WhyNote>
              </span>
            </div>
          </div>
          <Overlay>
            <CaptionSurface mode="explore" maxWidth={440}>
              what two numbers multiply to <EchoChip tone="blue">6</EchoChip> and add up to{' '}
              <EchoChip tone="amber">5</EchoChip>?
            </CaptionSurface>
            <AmbientPill state="speaking" mode="explore" />
          </Overlay>
        </>
      )
    case 1:
      return (
        <>
          <div className="px-[34px] py-7">
            <SheetKicker />
            <div className="ml-[30px] mt-11 opacity-45">
              <span className="text-[26px] font-medium tracking-[0.02em] text-foreground">x² + 5x + 6 = 0</span>
            </div>
          </div>
          <Overlay>
            <PingChip tone="positive" glyph="✓" label="Key concept understood · factor pairs" />
            <MathSurface kicker="Problem 2 · on your sheet" from="x² + 5x + 6 = 0" to="(x + 2)(x + 3) = 0" />
            <AmbientPill state="speaking" mode="build" />
          </Overlay>
        </>
      )
    case 2:
      return (
        <>
          <div className="px-[34px] py-7">
            <SheetKicker />
            <div className="ml-[30px] mt-10 flex flex-col gap-[46px]">
              <span className="text-[22px] font-medium tracking-[0.02em] text-(--calyxa-chip-text)">
                (x + 2)(x + 3) = 0
              </span>
              <span className="self-start whitespace-nowrap text-[22px] font-medium tracking-[0.02em] text-foreground">
                <TermMark tone="amber" pad={12} animate drawDelay={0.3} fillDelay={0.6}>
                  x = 2
                  <AnnotLabel tone="amber" side="above" offset={38} animate delay={0.8}>
                    Check this sign
                  </AnnotLabel>
                </TermMark>
                , x = −3
              </span>
            </div>
          </div>
          <Overlay>
            <PingChip tone="watch" glyph="◎" label="Misconception confirmed · sign errors" />
            <ConceptSurface title="it predicted this before you started">
              likely sticking point:{' '}
              <strong className="font-semibold" style={{ color: 'var(--calyxa-ping-watch-text)' }}>
                sign errors on the roots
              </strong>{' '}
              — came up twice in tuesday&apos;s session.
            </ConceptSurface>
            <AmbientPill state="speaking" mode="coach" />
          </Overlay>
        </>
      )
    default:
      return (
        <>
          <div className="px-[34px] py-7">
            <SheetKicker />
            <div className="ml-[30px] mt-10 flex flex-col gap-2 opacity-45">
              <span className="text-[22px] font-medium tracking-[0.02em] text-foreground">(x + 2)(x + 3) = 0</span>
              <span className="text-[22px] font-medium tracking-[0.02em] text-foreground">
                x = −2, x = −3&nbsp;&nbsp;<span className="text-accent-emphasis">✓</span>
              </span>
            </div>
          </div>
          <Overlay>
            <TranscriptSurface
              text="okay so negative two times negative three is positive six… so both signs flip"
              live
            />
            <div className="relative -m-2 p-2">
              <PillGlow opacity={0.8} />
              <AmbientPill state="listening" />
            </div>
          </Overlay>
        </>
      )
  }
}

function Overlay({ children }: { children: React.ReactNode }) {
  return <div className="absolute inset-x-0 bottom-[22px] flex flex-col items-center gap-3">{children}</div>
}

/**
 * One beat frame of the session. Key it on `beat` so re-entering a beat
 * replays its entrance animations (the scrub's rewind feel); `alt` renders
 * the sr-only line while the visual stays decorative.
 */
export function PillStageFrame({ beat, alt }: { beat: number; alt: string }) {
  return (
    <div className="relative h-[420px] overflow-hidden rounded-[14px] border border-(--mkt-hairline-soft) bg-(--calyxa-board-bg)">
      <p className="sr-only">{alt}</p>
      <div aria-hidden="true" className="absolute inset-0">
        <Frame beat={beat} />
      </div>
    </div>
  )
}
