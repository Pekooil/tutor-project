import type { ReactNode } from 'react'
import { CalyxaMark } from '@calyxa/ui'
import { Section } from '@/components/marketing/Section'

// Landing v3's new three-column comparison: a general AI chatbot · calyxa ·
// a human tutor. Design intent: the table must read fair, not rigged — the
// last row is a deliberate outright concession to the human tutor, and the
// availability row favors the chatbot equally. The center column gets the
// sage wash; everything else stays neutral.

type Cell = { text: ReactNode; strong?: boolean }

type Row = { label: string; chatbot: Cell; calyxa: Cell; human: Cell }

const ROWS: Row[] = [
  {
    label: "sees the assignment you're actually on",
    chatbot: { text: 'only what you paste in' },
    calyxa: { text: 'reads the page you already have open' },
    human: { text: "sits next to you — when you're together", strong: true },
  },
  {
    label: "what happens when you're stuck",
    chatbot: { text: 'writes out the full solution' },
    calyxa: { text: "points at the step you're missing — never the answer" },
    human: { text: 'guides you through it', strong: true },
  },
  {
    label: 'remembers what you keep getting wrong',
    chatbot: { text: 'starts fresh every chat' },
    calyxa: { text: 'tracks your misconceptions across sessions' },
    human: { text: 'knows you — if you meet often enough', strong: true },
  },
  {
    label: 'there at 11pm before the test',
    chatbot: { text: 'always on', strong: true },
    calyxa: { text: 'always on' },
    human: { text: 'next scheduled session' },
  },
  {
    label: 'what it costs',
    chatbot: { text: 'free–$20/mo', strong: true },
    calyxa: { text: '$12/mo' },
    human: { text: '$40–80 per hour' },
  },
  {
    label: 'a real person who knows you and keeps you accountable',
    chatbot: { text: 'no' },
    calyxa: { text: 'no — honestly' },
    human: {
      text: (
        <span className="inline-flex items-center gap-1.5 font-semibold text-accent-fill-foreground">
          <span
            aria-hidden="true"
            className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border border-(--color-accent-fill) bg-accent-subtle text-[11px]"
          >
            ✓
          </span>
          yes — nothing replaces that
        </span>
      ),
    },
  },
]

const CELL = 'px-[22px] py-[18px] text-[13.5px] leading-[1.55]'
const HAIR = 'border-(--mkt-hairline-soft)'
const SAGE = 'bg-accent-subtle font-medium text-accent-fill-foreground'

export function WhyUs() {
  return (
    <Section
      id="why-us"
      tone="wash"
      align="center"
      kicker="why calyxa"
      heading="why not just a chatbot? why not a real tutor?"
      sub="calyxa is AI too — the difference is what it can see and what it remembers. the honest comparison:"
    >
      <div className="overflow-x-auto">
        <div className="min-w-[880px] overflow-hidden rounded-2xl border border-(--mkt-hairline) bg-background">
          <div className="grid grid-cols-[220px_1fr_1fr_1fr] xl:grid-cols-[280px_1fr_1fr_1fr]" role="table">
            {/* Column headers */}
            <div role="row" className="contents">
              <div role="columnheader" className={`border-b ${HAIR} px-6 py-5`} />
              <div role="columnheader" className={`flex flex-col gap-[3px] border-b border-l ${HAIR} px-[22px] py-5`}>
                <span className="text-[14.5px] font-semibold text-(--calyxa-chip-text)">a general AI chatbot</span>
                <span className="text-[12px] text-(--mkt-faint)">you paste the problem into a chat</span>
              </div>
              <div
                role="columnheader"
                className={`flex flex-col gap-[3px] border-b border-l border-(--calyxa-sage-border) ${SAGE} px-[22px] py-5`}
              >
                <span className="flex items-center gap-[7px] text-[14.5px] font-semibold">
                  <CalyxaMark className="h-4 w-4" />
                  calyxa
                </span>
                <span className="text-[12px] font-normal text-accent-emphasis">a tutor that sees your screen</span>
              </div>
              <div role="columnheader" className={`flex flex-col gap-[3px] border-b border-l ${HAIR} px-[22px] py-5`}>
                <span className="text-[14.5px] font-semibold text-(--calyxa-chip-text)">a human tutor</span>
                <span className="text-[12px] text-(--mkt-faint)">a real person, on a schedule</span>
              </div>
            </div>

            {ROWS.map((row, index) => {
              const last = index === ROWS.length - 1
              const rowBorder = last ? '' : 'border-b'
              return (
                <div role="row" className="contents" key={row.label}>
                  <div role="rowheader" className={`${rowBorder} ${HAIR} px-6 py-[18px] text-[14px] font-semibold text-foreground`}>
                    {row.label}
                  </div>
                  <div
                    role="cell"
                    className={`${CELL} ${rowBorder} border-l ${HAIR} ${row.chatbot.strong ? 'text-(--calyxa-chip-text)' : 'text-muted-foreground'}`}
                  >
                    {row.chatbot.text}
                  </div>
                  <div
                    role="cell"
                    className={`${CELL} border-l ${HAIR} ${last ? '' : 'border-b'} ${last ? '' : 'border-b-(--calyxa-sage-border)'} ${SAGE}`}
                  >
                    {row.calyxa.text}
                  </div>
                  <div
                    role="cell"
                    className={`${CELL} ${rowBorder} border-l ${HAIR} ${row.human.strong ? 'text-(--calyxa-chip-text)' : 'text-muted-foreground'}`}
                  >
                    {row.human.text}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <p className="mx-auto mt-[22px] max-w-[64ch] text-center text-[13.5px] text-(--mkt-faint)">
        if you have a great tutor and can meet them often, keep them. calyxa is for the other 165 hours a week.
      </p>
    </Section>
  )
}
