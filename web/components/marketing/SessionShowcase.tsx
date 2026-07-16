'use client'

import { useRef, useState } from 'react'
import { useMotionValueEvent, useReducedMotion, useScroll } from 'motion/react'
import { cn } from '@/lib/utils'
import { Section } from '@/components/marketing/Section'
import { PILL_BEAT_ALTS, PILL_STAGE_ALT, PillStageFrame } from '@/components/marketing/pill/PillStage'

// The pinned session walkthrough, redrawn in the Landing v3 pill language
// (visuals in pill/PillStage.tsx; the retired panel vocabulary is gone from
// the copy below too). The scrollytelling machinery is unchanged: one stage
// sticks in the left column while four copy beats scroll past on the right;
// scroll progress over the track scrubs one continuous session, so scrolling
// back rewinds it — the "wait, it's live" proof a video can't give. Below
// lg, and for anyone with prefers-reduced-motion, the pin degrades to
// stacked beat cards rendering each beat's frame statically.

type Beat = {
  title: string
  body: string
  /** Beat 4's spoken-reply caption — what the tutor says out loud. */
  spoken?: { quote: string; note: string }
}

const BEATS: Beat[] = [
  {
    title: 'it points at the problem.',
    body: 'calyxa draws on the page itself — labeled marks on the equation and its terms, numbered step badges for the order to think in, and a why-note that explains the step. the same colors echo in what it says, so when it says “the middle term 5x,” you can see exactly which 5x it means.',
  },
  {
    title: 'the moment it clicks, it’s on the record.',
    body: 'get the key idea and a sage ping names it in the moment. the math surface carries the problem through each transformation — from x² + 5x + 6 = 0 to its factored form — so you always see exactly the equation the tutor is talking about.',
  },
  {
    title: 'it saw that mistake coming.',
    body: 'before the session starts, calyxa predicts your likely sticking point — here, sign errors on the roots. when the slip actually happens — x = 2 instead of x = −2 — an amber ping names it in the moment, and the pill switches from exploring to coaching.',
  },
  {
    title: 'talk it through out loud.',
    body: 'most sessions happen by voice. you think out loud, the pill listens, and the tutor answers in its own voice while the live transcript keeps up.',
    spoken: {
      quote: 'exactly — say it out loud: why negative?',
      note: 'spoken aloud — calyxa replies in under 2.5 seconds.',
    },
  },
]

export function SessionShowcase() {
  const reduceMotion = useReducedMotion() ?? false
  const trackRef = useRef<HTMLDivElement | null>(null)
  // Progress runs while the track crosses the viewport center, so copy beat
  // i sits at the reader's eye line exactly while the stage shows beat i.
  const { scrollYProgress } = useScroll({ target: trackRef, offset: ['start center', 'end center'] })
  const [scrub, setScrub] = useState(0)
  useMotionValueEvent(scrollYProgress, 'change', (value) => {
    setScrub(Number.isFinite(value) ? value : 0)
  })
  const activeBeat = Math.max(0, Math.min(BEATS.length - 1, Math.floor(scrub * BEATS.length)))

  return (
    <Section
      id="session-showcase"
      kicker="see it work"
      heading="it talks you through the problem, live."
      sub="annotations, pings, predictions, and voice — one session, four things happening at once. scroll scrubs the session; scrolling back rewinds it."
    >
      {/* The pinned walkthrough. Kept in the DOM at every width (CSS-hidden
          below lg and under reduced motion) so useScroll's target ref always
          resolves and there is no hydration flash. */}
      <div
        ref={trackRef}
        className={cn(
          'hidden grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-[52px]',
          !reduceMotion && 'lg:grid'
        )}
      >
        <div>
          <div className="sticky top-28">
            {/* Keyed on the active beat: re-entering a beat (either scroll
                direction) replays its draw-ons — the rewind. */}
            <PillStageFrame key={activeBeat} beat={activeBeat} alt={PILL_STAGE_ALT} />
          </div>
        </div>
        <div className="flex flex-col">
          {BEATS.map((beat, index) => (
            <div
              key={beat.title}
              className={cn(
                'flex min-h-[85vh] flex-col justify-center transition-opacity duration-300',
                index === activeBeat ? 'opacity-100' : 'opacity-40'
              )}
            >
              <BeatCopy beat={beat} index={index} />
            </div>
          ))}
        </div>
      </div>

      {/* The stacked fallback: below lg always, and at every width under
          reduced motion — four static frames, one per beat. */}
      <div className={cn('flex flex-col gap-20', !reduceMotion && 'lg:hidden')}>
        {BEATS.map((beat, index) => (
          <div key={beat.title} className="flex flex-col gap-6">
            <BeatCopy beat={beat} index={index} />
            <PillStageFrame beat={index} alt={PILL_BEAT_ALTS[index]} />
          </div>
        ))}
      </div>
    </Section>
  )
}

function BeatCopy({ beat, index }: { beat: Beat; index: number }) {
  return (
    <div>
      <p className="m-0 font-mono text-[11px] font-semibold tracking-[0.12em] text-(--mkt-faint)">
        {String(index + 1).padStart(2, '0')}
      </p>
      <h3 className="mkt-display mkt-h3 mt-3 text-foreground">{beat.title}</h3>
      <p className="mt-3.5 max-w-xl text-pretty text-[15.5px] leading-[1.65] text-muted-foreground">{beat.body}</p>
      {beat.spoken && (
        <figure className="mt-[18px] rounded-r-[10px] border-l-[3px] border-(--color-accent-fill) bg-(--calyxa-board-bg) px-[18px] py-3.5">
          <blockquote className="m-0 text-[15px] text-foreground">&ldquo;{beat.spoken.quote}&rdquo;</blockquote>
          <figcaption className="mt-[5px] text-[13px] text-muted-foreground">{beat.spoken.note}</figcaption>
        </figure>
      )}
    </div>
  )
}
