import type { CSSProperties } from 'react'

// Landing v5 wall of love: three vertical marquee columns (26s/34s/30s) on
// desktop, one 24s column on mobile, masked top/bottom. Every quote is a
// PLACEHOLDER pending beta cohort 3 — each card carries a placeholder badge
// and the section carries a caption saying so, both behind the
// showPlaceholders flag (hidden only for marketing screenshots).

type Quote = { name: string; detail: string; text: string }

const MAYA: Quote = {
  name: 'Maya R.',
  detail: 'Algebra II · cohort 2',
  text: "it never just tells me. it's annoying for five seconds and then it clicks.",
}
const PRIYA: Quote = {
  name: 'Priya S.',
  detail: 'Geometry · cohort 3',
  text: "talking out loud feels weird for one problem. then it's just how you do homework.",
}
const DEV: Quote = {
  name: 'Dev K.',
  detail: 'Precalc · cohort 1',
  text: 'I stopped pasting homework into a chatbot. this one actually sees my screen.',
}
const JORDAN: Quote = {
  name: 'Jordan M.',
  detail: 'Algebra II · cohort 1',
  text: 'the study kit after each session is the only reason I passed unit 4.',
}
const SAM: Quote = {
  name: 'Sam T.',
  detail: 'AP Calc AB · cohort 2',
  text: 'the amber ping called my sign error before I made it. rude. accurate.',
}
const ALEX: Quote = {
  name: 'Alex B.',
  detail: 'College algebra · cohort 3',
  text: "it's like the tutor lives inside canvas. I forget it's an extension.",
}

const DESKTOP_COLUMNS: Array<{ quotes: Quote[]; duration: string }> = [
  { quotes: [MAYA, PRIYA], duration: '26s' },
  { quotes: [DEV, JORDAN], duration: '34s' },
  { quotes: [SAM, ALEX], duration: '30s' },
]

const MOBILE_COLUMN: Quote[] = [MAYA, SAM, JORDAN]

function QuoteCard({ quote, showPlaceholders }: { quote: Quote; showPlaceholders: boolean }) {
  return (
    <div className="flex flex-col gap-[11px] rounded-[13px] border border-(--mkt-hairline) bg-background px-5 py-[18px] sm:gap-3.5 sm:rounded-[14px] sm:px-6 sm:py-[22px]">
      <div className="flex items-center gap-2.5 sm:gap-[11px]">
        <span
          aria-hidden="true"
          className="h-[30px] w-[30px] flex-none rounded-full border border-(--mkt-hairline) sm:h-[34px] sm:w-[34px]"
          style={{ background: 'repeating-linear-gradient(45deg, #eceae5 0 4px, #f7f7f5 4px 8px)' }}
        />
        <div className="flex flex-col">
          <span className="text-[12.5px] font-semibold text-foreground sm:text-[13.5px]">{quote.name}</span>
          <span className="text-[10.5px] text-(--mkt-faint) sm:text-[11.5px]">{quote.detail}</span>
        </div>
        {showPlaceholders && (
          <span className="ml-auto rounded border border-(--mkt-hairline) bg-[#f7f7f5] px-1.5 py-[3px] font-mono text-[8px] font-semibold uppercase tracking-[0.08em] text-(--mkt-faint) sm:text-[9px]">
            placeholder
          </span>
        )}
      </div>
      <p className="m-0 text-[12.5px] leading-[1.6] text-(--mkt-strip-text) sm:text-[13.5px]">{quote.text}</p>
    </div>
  )
}

function MarqueeColumn({
  quotes,
  duration,
  showPlaceholders,
}: {
  quotes: Quote[]
  duration: string
  showPlaceholders: boolean
}) {
  return (
    <div
      className="mkt-vmarquee gap-3 sm:gap-[18px]"
      style={{ '--mkt-vmarquee-duration': duration } as CSSProperties}
    >
      {quotes.map((quote, index) => (
        <QuoteCard key={`a-${index}`} quote={quote} showPlaceholders={showPlaceholders} />
      ))}
      {/* duplicate half for the seamless -50% loop */}
      {quotes.map((quote, index) => (
        <div key={`b-${index}`} aria-hidden="true">
          <QuoteCard quote={quote} showPlaceholders={showPlaceholders} />
        </div>
      ))}
    </div>
  )
}

const MASK = 'linear-gradient(180deg, transparent, #000 9%, #000 91%, transparent)'

export function WallOfLove({ showPlaceholders }: { showPlaceholders: boolean }) {
  return (
    <section className="flex flex-col items-center border-t border-(--mkt-hairline-soft) bg-(--calyxa-board-bg) px-[22px] py-14 sm:px-20 sm:py-[104px]">
      <p className="mkt-eyebrow m-0">beta cohort</p>
      <h2 className="mkt-display mkt-h2-sm mb-0 mt-3 text-center text-foreground sm:mt-4">
        Loved by students who hate being stuck.
      </h2>
      {showPlaceholders && (
        <p className="mb-0 mt-2.5 text-center text-[11.5px] text-(--mkt-faint) sm:mt-4 sm:text-sm">
          sample quotes — swapped for real ones when beta cohort 3 wraps.
        </p>
      )}

      {/* desktop: three columns */}
      <div
        className="mt-12 hidden h-[520px] w-full max-w-[1080px] grid-cols-3 gap-[18px] overflow-hidden sm:grid"
        style={{ WebkitMaskImage: MASK, maskImage: MASK }}
      >
        {DESKTOP_COLUMNS.map((column, index) => (
          <MarqueeColumn
            key={index}
            quotes={column.quotes}
            duration={column.duration}
            showPlaceholders={showPlaceholders}
          />
        ))}
      </div>

      {/* mobile: one column */}
      <div
        className="mt-[18px] h-[380px] w-full overflow-hidden sm:hidden"
        style={{ WebkitMaskImage: 'linear-gradient(180deg, transparent, #000 10%, #000 90%, transparent)', maskImage: 'linear-gradient(180deg, transparent, #000 10%, #000 90%, transparent)' }}
      >
        <MarqueeColumn quotes={MOBILE_COLUMN} duration="24s" showPlaceholders={showPlaceholders} />
      </div>
    </section>
  )
}
