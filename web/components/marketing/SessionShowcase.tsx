'use client'

import { useRef, useState } from 'react'
import { useMotionValueEvent, useReducedMotion, useScroll } from 'motion/react'
import { cn } from '@/lib/utils'
import { Section } from '@/components/marketing/Section'
import { DemoStage } from '@/components/marketing/demo/DemoStage'
import { sessionBeats, sessionBeatTimes } from '@/components/marketing/demo/scripts'

// Sprint 20 Task 6: the pinned session walkthrough. One DemoStage sticks in
// the left column while four copy beats scroll past on the right; scroll
// progress over the track scrubs the sessionBeats script, so scrolling back
// rewinds the session — the "wait, it's live" proof a video can't give.
// Below lg, and for anyone with prefers-reduced-motion, the pin degrades to
// stacked beat cards, each rendering its beat's final frame statically via
// DemoStage's fixed-frame mode (same script, scrub disabled).

type Beat = {
  title: string
  body: string
  /** Beat 4's spoken-reply caption — what the tutor says out loud. */
  spoken?: { quote: string; note: string }
  /** The stacked card's text alternative for this beat's frame. */
  alt: string
}

// Every beat names the feature by its product name — annotations, the
// solution progress bar, profile tags, pings, voice — the same vocabulary a
// beta user later sees in the extension.
const BEATS: Beat[] = [
  {
    title: 'It points at the problem.',
    body: 'Calyxa draws annotations on the page itself — a box around the equation, a box around the term it means. Each box is color-linked to the exact phrase in the tutor’s reply, so when it says “the middle term 5x,” you can see which 5x it means.',
    alt: 'Demo frame: annotation boxes drawn around x² + 5x + 6 = 0 and its terms 5x and 6, each color-matched to the same phrase in the tutor’s reply.',
  },
  {
    title: 'You see yourself getting closer.',
    body: 'The solution progress bar sits under the conversation and moves as you work. Take a wrong step — x = 2 instead of x = −2 — and the bar eases back. Catch it yourself and it climbs past where it was.',
    alt: 'Demo frame: the solution progress bar eased back after a sign mistake, then climbing again once the student corrects to x = −2 and x = −3.',
  },
  {
    title: 'It knows what you’re working on.',
    body: 'Profile tags on the tutor’s replies show what Calyxa remembers about you — a known gap with sign errors, a callback to factoring practice from three days ago. Close a gap for good and a ping marks the moment.',
    alt: 'Demo frame: a known-gap tag and a callback tag on the tutor’s replies, with a “Gap closed: sign errors” ping above the panel and the progress bar full.',
  },
  {
    title: 'Talk it through out loud.',
    body: 'Most sessions happen by voice. You think out loud, the waveform listens, and the tutor answers in its own voice while the transcript keeps up.',
    spoken: {
      quote: 'Nice work — want to try one more like it?',
      note: 'Spoken aloud — Calyxa replies in under 2.5 seconds.',
    },
    alt: 'Demo frame: the voice waveform pulsing while the tutor speaks, with the session recap strip showing factoring quadratics up and coming back Thursday.',
  },
]

const PINNED_ALT =
  'A scripted Calyxa session that scrubs with your scroll: annotations draw around x² + 5x + 6 = 0, the solution progress bar rises and eases back on a wrong step, profile tags and a “Gap closed: sign errors” ping appear, and the voice waveform pulses over a session recap.'

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
      sub="Annotations, solution progress, profile tags, and voice — one session, four things happening at once."
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
              <DemoStage script={sessionBeats} scrub={scrub} alt={PINNED_ALT} />
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
              <DemoStage script={sessionBeats} frameMs={sessionBeatTimes[index + 1]} alt={beat.alt} />
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
