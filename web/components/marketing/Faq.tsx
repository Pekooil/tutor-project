'use client'

import { useId, useState } from 'react'
import { FREE_SESSIONS_PER_MONTH } from '@/components/marketing/Pricing'

// Landing v6 §7: a single-open disclosure accordion, first item open on load,
// clicking the open item closes it. Real disclosure semantics (aria-expanded +
// aria-controls), not a styled list.
//
// Two answers deviate from the design file's copy, which still described the
// private beta: the free-tier answer now states the launch pricing (and points
// at /pricing, the only place pricing lives now that the landing's pricing
// section is gone), and the coverage answer drops "after beta".

// Landing v7 §7: four items with one-line answers, down from five with
// paragraphs. "Will it just do my homework for me?" is gone — it planted an
// objection most visitors were not having and answered it with the moral
// framing the v7 copy rules retire.
const FAQS = [
  {
    q: 'Is it free?',
    a: `${FREE_SESSIONS_PER_MONTH} sessions a month, no card. Pro lifts the cap for $10 a month.`,
  },
  {
    q: "Does it work on my school's portal?",
    a: 'Any page in Chrome. It reads the page and never types into it.',
  },
  {
    q: 'Which math?',
    a: 'Pre-algebra through calculus, plus SAT and ACT.',
  },
  {
    q: 'What happens to my data?',
    a: 'Audio is never stored. Page visits are kept only as a one-way hash. Delete everything any time.',
  },
]

export function Faq() {
  const [open, setOpen] = useState(0)
  const baseId = useId()

  return (
    <section id="faq" className="bg-background px-[22px] pb-8 pt-12 sm:px-11 sm:pb-6 sm:pt-[76px]">
      <div className="mx-auto max-w-[680px]">
        <div className="mb-6 flex flex-col gap-2 text-center sm:mb-8">
          <h2
            className="mkt-display m-0 font-bold text-foreground"
            style={{ fontSize: 'clamp(22px, 2.2vw, 32px)', lineHeight: 1.1, letterSpacing: '-0.025em' }}
          >
            Frequently asked questions
          </h2>
          <p className="m-0 text-[13.5px] text-muted-foreground sm:text-[15px]">
            Everything you need to know about Calyxa
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {FAQS.map((item, index) => {
            const isOpen = open === index
            const panelId = `${baseId}-panel-${index}`
            const buttonId = `${baseId}-trigger-${index}`
            return (
              <div key={item.q} className="overflow-hidden rounded-xl border border-(--mkt-hairline) bg-background">
                <button
                  type="button"
                  id={buttonId}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => setOpen(isOpen ? -1 : index)}
                  className="flex w-full cursor-pointer items-center gap-3 bg-transparent px-4 py-3.5 text-left text-foreground transition-colors hover:bg-[#f7f7f5] sm:px-5 sm:py-4"
                >
                  <span className="flex-1 text-[14px] font-semibold sm:text-[15.5px]">{item.q}</span>
                  <span
                    aria-hidden="true"
                    className="text-[18px] font-normal leading-[0.8] text-(--color-focus-ring) sm:text-[20px]"
                  >
                    {isOpen ? '–' : '+'}
                  </span>
                </button>
                <p
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  hidden={!isOpen}
                  className="m-0 pb-4 pl-4 pr-8 text-[13px] leading-[1.6] text-muted-foreground sm:pb-4 sm:pl-5 sm:pr-12 sm:text-[14px]"
                >
                  {item.a}
                </p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
