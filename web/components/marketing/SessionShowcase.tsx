'use client'

import { useRef, useState } from 'react'
import { useMotionValueEvent, useReducedMotion, useScroll } from 'motion/react'
import { cn } from '@/lib/utils'
import { Section } from '@/components/marketing/Section'
import { DemoStage } from '@/components/marketing/demo/DemoStage'
import { sessionBeats, sessionBeatTimes, sessionShowcaseAlts } from '@/components/marketing/demo/scripts'

// Sprint 25 Task 6 (originally Sprint 20 Task 6): the pinned session
// walkthrough. One DemoStage sticks in the left column while four copy beats
// scroll past on the right; scroll progress over the track scrubs the
// sessionBeats script, so scrolling back rewinds the session — the "wait,
// it's live" proof a video can't give. Below lg, and for anyone with
// prefers-reduced-motion, the pin degrades to stacked beat cards, each
// rendering its beat's final frame statically via DemoStage's fixed-frame
// mode (same script, scrub disabled).

type Beat = {
  title: string
  body: string
  /** Beat 4's spoken-reply caption — what the tutor says out loud. */
  spoken?: { quote: string; note: string }
}

// Every beat names the feature by its product name — annotations, milestone
// markers, the board strip, tutor modes, pings, voice — the same vocabulary
// a beta user later sees in the extension. Alt text for the frames lives
// with the script (sessionShowcaseAlts) so copy and scene stay in one place.
const BEATS: Beat[] = [
  {
    title: 'It points at the problem.',
    body: 'Calyxa draws on the page itself — labeled marks on the equation and its terms, numbered step badges for the order to think in, and a why-note that explains the step. The same marks echo in the tutor’s reply, so when it says “the middle term 5x,” you can see exactly which 5x it means.',
  },
  {
    title: 'The moment it clicks, it’s on the record.',
    body: 'Get the key idea and a milestone marker settles into the transcript — and stays there as you keep working. Up top, the board strip carries the problem through each transformation, from x² + 5x + 6 = 0 to its factored form, while the stage subtitle counts off where you are in the session.',
  },
  {
    title: 'It saw that mistake coming.',
    body: 'Before the session starts, Calyxa predicts your likely sticking point — here, sign errors on the roots. When the slip actually happens — x = 2 instead of x = −2 — a ping names it in the moment, and the session switches from Exploring to Coaching right in the header.',
  },
  {
    title: 'Talk it through out loud.',
    body: 'Most sessions happen by voice. You think out loud, the waveform listens, and the tutor answers in its own voice while the transcript keeps up.',
    spoken: {
      quote: 'Exactly — say it out loud: why negative?',
      note: 'Spoken aloud — Calyxa replies in under 2.5 seconds.',
    },
  },
]

export function SessionShowcase() {
  const reduceMotion = useReducedMotion() ?? false
  const trackRef = useRef<HTMLDivElement | null>(null)
  // Progress runs while the track crosses the viewport center, so copy beat
  // i sits at the reader's eye line exactly while the scene is inside beat i
  // (both are quarters of the same span).
  const { scrollYProgress } = useScroll({ target: trackRef, offset: ['start center', 'end center'] })
  const [scrub, setScrub] = useState(0)
  useMotionValueEvent(scrollYProgress, 'change', (value) => {
    setScrub(Number.isFinite(value) ? value : 0)
  })
  const activeBeat = Math.max(0, Math.min(BEATS.length - 1, Math.floor(scrub * BEATS.length)))

  return (
    <Section
      id="session-showcase"
      kicker="See it work"
      heading="It talks you through the problem, live."
      sub="Annotations, milestone markers, predictions and pings, and voice — one session, four things happening at once."
    >
      {/* The pinned walkthrough. Kept in the DOM at every width (CSS-hidden
          below lg and under reduced motion) so useScroll's target ref always
          resolves and there is no hydration flash. */}
      <div
        ref={trackRef}
        className={cn(
          'hidden grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-14',
          !reduceMotion && 'lg:grid'
        )}
      >
        <div>
          <div className="sticky top-28">
            <div className="mkt-stage">
              <DemoStage script={sessionBeats} scrub={scrub} alt={sessionShowcaseAlts.pinned} />
            </div>
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
            <div className="mkt-stage">
              <DemoStage script={sessionBeats} frameMs={sessionBeatTimes[index + 1]} alt={sessionShowcaseAlts.beats[index]} />
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

function BeatCopy({ beat, index }: { beat: Beat; index: number }) {
  return (
    <div>
      <p className="mkt-kicker">{String(index + 1).padStart(2, '0')}</p>
      <h3 className="mkt-display mt-3 text-3xl text-foreground sm:text-4xl">{beat.title}</h3>
      <p className="mt-4 max-w-xl text-pretty text-base text-muted-foreground sm:text-lg">{beat.body}</p>
      {beat.spoken && (
        <figure className="mkt-quote mt-5">
          <blockquote className="m-0 text-base text-foreground">&ldquo;{beat.spoken.quote}&rdquo;</blockquote>
          <figcaption className="mt-1 text-sm text-muted-foreground">{beat.spoken.note}</figcaption>
        </figure>
      )}
    </div>
  )
}
