import { CalyxaMark } from '@calyxa/ui'
import { FREE_SESSIONS_PER_MONTH } from '@/components/marketing/Pricing'

// Landing v5 closer: the ⌥ + ⇧ + C keycaps (the real extension shortcut) over
// "Press and start talking." on the white→green-wash gradient, one CTA,
// and the honest fine print (free cap · chrome-only · the windows binding).

export function FinalCta() {
  return (
    <section
      id="final-cta"
      className="flex flex-col items-center px-[22px] pb-[76px] pt-[68px] sm:px-14 sm:pb-32 sm:pt-[120px]"
      style={{ background: 'linear-gradient(180deg, #ffffff 0%, #f0fdf4 100%)' }}
    >
      <div aria-hidden="true" className="flex items-center gap-3 sm:gap-4">
        <span
          className="flex h-16 w-16 items-center justify-center rounded-[15px] border border-(--mkt-hairline) bg-[#f7f7f5] text-[22px] font-medium text-(--mkt-strip-text) sm:h-24 sm:w-24 sm:rounded-[22px] sm:text-[32px]"
          style={{ boxShadow: '0 4px 0 #e5e3de, 0 20px 44px rgba(28,40,30,0.18)' }}
        >
          ⌥
        </span>
        <span className="text-[15px] text-(--mkt-faint) sm:text-xl">+</span>
        <span
          className="flex h-16 w-16 items-center justify-center rounded-[15px] border border-(--mkt-hairline) bg-[#f7f7f5] text-(--mkt-strip-text) sm:h-24 sm:w-24 sm:rounded-[22px]"
          style={{ boxShadow: '0 4px 0 #e5e3de, 0 20px 44px rgba(28,40,30,0.18)' }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="h-[26px] w-[26px] sm:h-[38px] sm:w-[38px]"
            aria-hidden="true"
          >
            <path
              d="M12 5.5 19 12.5M12 5.5 5 12.5M12 5.5 12 18.5"
              stroke="currentColor"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="text-[15px] text-(--mkt-faint) sm:text-xl">+</span>
        <span
          className="mkt-display relative flex h-16 w-16 items-center justify-center rounded-[15px] border border-(--calyxa-sage-border) bg-[#f7f7f5] text-[26px] text-accent-fill-foreground sm:h-24 sm:w-24 sm:rounded-[22px] sm:text-[38px]"
          style={{ boxShadow: '0 0 0 4px rgba(134,239,172,0.18), 0 4px 0 #e5e3de, 0 20px 44px rgba(28,40,30,0.18)' }}
        >
          C
          <CalyxaMark className="absolute right-1.5 top-1.5 h-3.5 w-3.5 sm:right-[9px] sm:top-[9px] sm:h-5 sm:w-5" />
        </span>
      </div>
      <h2 className="mkt-display mkt-h2 mb-0 mt-[30px] max-w-[22ch] text-center text-foreground sm:mt-12">
        Press and start the set.
      </h2>
      <p className="mb-0 mt-3 max-w-[44ch] text-center text-[13.5px] leading-[1.6] text-(--mkt-strip-text) sm:mt-[18px] sm:text-[17px]">
        the page is already open. this just counts what&apos;s on it.
      </p>
      <a
        href="/start"
        className="mt-[22px] inline-flex w-full items-center justify-center rounded-[11px] bg-accent-fill py-3.5 text-[14.5px] font-semibold text-accent-fill-foreground transition-colors hover:bg-[#6ee7a0] sm:mt-8 sm:w-auto sm:rounded-xl sm:px-7 sm:text-base"
        style={{ boxShadow: '0 10px 30px rgba(28,40,30,0.16)' }}
      >
        Add to Chrome — free
      </a>
      <p className="mb-0 mt-[11px] text-center text-xs text-muted-foreground sm:mt-3.5 sm:text-[13.5px]">
        {FREE_SESSIONS_PER_MONTH} free sessions a month · chrome, for now · alt + shift + C on windows
      </p>
    </section>
  )
}
