import type { ReactNode } from 'react'
import { Section } from '@/components/marketing/Section'
import {
  AnnotLabel,
  PILL_MODES,
  StepBadge,
  TermMark,
  WhyNote,
  type PillMode,
} from '@/components/marketing/pill/overlay'

// Landing v3: the four-systems section shrunk to a one-screen spec panel
// ("the engine under the pill") — one bordered panel, four numbered rows,
// each with a name + one-liner left and a single exemplar right. The old
// animated vignettes (looping check-in scans, the mode-cycling header, the
// tap-to-fire ping catalog, mini overlay mockups) are deliberately gone:
// the design shows exactly four mode chips + "+ 4 more", four sample pings
// + "18 in the catalog", one annotated glyph, one prediction card. Server
// component — nothing here moves.

const MODE_CHIPS: PillMode[] = ['explore', 'coach', 'build', 'recover']

const PING_SAMPLES = [
  { tone: 'positive', glyph: '✓', label: 'Key concept understood' },
  { tone: 'positive', glyph: '✦', label: 'Self-caught' },
  { tone: 'adjust', glyph: '≡', label: 'Breaking it into steps' },
  { tone: 'watch', glyph: '◎', label: 'Misconception confirmed' },
] as const

function Row({ n, name, blurb, children, last }: { n: string; name: string; blurb: string; children: ReactNode; last?: boolean }) {
  return (
    <div
      className={`grid items-center gap-6 px-7 py-6 max-md:grid-cols-1 md:grid-cols-[64px_minmax(0,320px)_minmax(0,1fr)] ${last ? '' : 'border-b border-(--mkt-hairline-soft)'}`}
    >
      <span className="font-mono text-[13px] font-semibold text-(--mkt-faint)">{n}</span>
      <div>
        <h3 className="m-0 text-[16.5px] font-semibold tracking-[-0.01em] text-foreground">{name}</h3>
        <p className="mb-0 mt-1.5 text-[13.5px] leading-[1.55] text-muted-foreground">{blurb}</p>
      </div>
      <div className="md:justify-self-end">{children}</div>
    </div>
  )
}

export function AdaptiveSection() {
  return (
    <Section
      id="adaptive"
      kicker="the machinery"
      heading="the engine under the pill."
      sub="not a chatbot wrapper — four systems running in parallel while you work, tuning every turn of the session."
      className="mx-auto max-w-[1020px]"
    >
      <div className="overflow-hidden rounded-2xl border border-(--mkt-hairline)">
        <Row
          n="01"
          name="misconception prediction"
          blurb="one prediction before the first question — from your history and the page it just read."
        >
          <div
            className="max-w-[360px] rounded-xl border border-(--calyxa-sage-border) bg-(--calyxa-board-bg) px-4 py-[13px]"
            style={{ boxShadow: '0 0 0 3px rgba(134, 239, 172, 0.14)' }}
          >
            <p className="m-0 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-accent-emphasis">AI prediction</p>
            <p className="mb-0 mt-1.5 text-[13px] text-foreground">
              likely sticking point: <span className="font-semibold">sign errors on the roots</span>
            </p>
            <p className="mb-0 mt-1 text-[11.5px] text-(--mkt-faint)">came up twice in tuesday&apos;s session</p>
          </div>
        </Row>

        <Row
          n="02"
          name="tutor modes"
          blurb="eight ways to teach, switched live turn by turn. the pill wears whichever is driving."
        >
          <div className="flex max-w-[420px] flex-wrap gap-2 md:justify-end">
            {MODE_CHIPS.map((mode) => (
              <span
                key={mode}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold"
                style={{
                  background: `var(--calyxa-mode-${mode}-bg)`,
                  border: `1px solid var(--calyxa-mode-${mode}-border)`,
                  color: `var(--calyxa-mode-${mode}-text)`,
                }}
              >
                <span aria-hidden="true" className="font-bold">
                  {PILL_MODES[mode].glyph}
                </span>
                {PILL_MODES[mode].name}
              </span>
            ))}
            <span className="inline-flex items-center rounded-full border border-(--mkt-hairline) bg-(--calyxa-board-bg) px-3 py-1.5 text-[12.5px] font-semibold text-(--mkt-faint)">
              + 4 more
            </span>
          </div>
        </Row>

        <Row
          n="03"
          name="annotations"
          blurb="labeled marks, why-notes, and numbered step badges — drawn on the page itself, echoed in what it says."
        >
          <div className="flex items-center gap-9 py-4 pl-4 pr-7 max-md:pl-1">
            <span className="relative mt-[18px] inline-block text-[22px] font-medium text-foreground">
              <TermMark tone="amber" pad={10}>
                5x
                <StepBadge tone="amber" n={1} style={{ left: 'calc(50% + 34px)', top: -24, height: 19, width: 19, fontSize: 10.5 }} />
                <AnnotLabel tone="amber" side="above" offset={30}>
                  Add to 5
                </AnnotLabel>
              </TermMark>
            </span>
            <WhyNote tone="amber" className="max-w-[200px]">
              b is what the two numbers add up to.
            </WhyNote>
          </div>
        </Row>

        <Row
          n="04"
          name="pings"
          blurb="three tones — sage for wins, neutral for teaching moves, amber for watch-outs. one at a time, never a feed."
          last
        >
          <div className="flex max-w-[440px] flex-wrap gap-2 md:justify-end">
            {PING_SAMPLES.map((ping) => (
              <span key={ping.label} className={`mkt-ping mkt-ping-${ping.tone} !shadow-none`}>
                <span aria-hidden="true" className="font-bold">
                  {ping.glyph}
                </span>
                {ping.label}
              </span>
            ))}
            <span className="inline-flex items-center rounded-full border border-(--mkt-hairline) bg-(--calyxa-board-bg) px-3 py-1.5 text-[12px] font-semibold text-(--mkt-faint)">
              18 in the catalog
            </span>
          </div>
        </Row>
      </div>
    </Section>
  )
}
