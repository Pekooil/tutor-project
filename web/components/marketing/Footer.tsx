import Link from 'next/link'
import { CalyxaMark } from '@calyxa/ui'

// Landing v5 footer: logo block + tagline, three link columns, baseline row.
// The design's dead links (beta notes / changelog / about / contact) are
// dropped until those pages exist (Darcy 2026-07-19); the company column
// becomes the account column so every link has a real target.

const COLUMNS: Array<{ heading: string; links: Array<{ label: string; href: string }> }> = [
  {
    heading: 'product',
    links: [
      { label: 'how it works', href: '#how-it-works' },
      { label: 'pricing', href: '#pricing' },
    ],
  },
  {
    heading: 'account',
    links: [
      { label: 'log in', href: '/login' },
      { label: 'sign up', href: '/signup' },
    ],
  },
  {
    heading: 'legal',
    links: [
      { label: 'terms', href: '/terms' },
      { label: 'privacy', href: '/privacy' },
    ],
  },
]

export function Footer() {
  return (
    <footer className="flex flex-col gap-6 border-t border-(--mkt-hairline-soft) bg-(--calyxa-board-bg) px-[22px] pb-7 pt-9 sm:gap-11 sm:px-[72px] sm:pb-10 sm:pt-14">
      <div className="flex flex-col gap-6 sm:flex-row sm:gap-20">
        <div className="flex flex-col gap-2 sm:mr-auto sm:gap-3">
          <span className="flex items-center gap-2 sm:gap-[9px]">
            <CalyxaMark className="h-[19px] w-[19px] sm:h-[22px] sm:w-[22px]" />
            <span className="text-sm font-semibold tracking-[-0.01em] text-foreground sm:text-base">calyxa</span>
          </span>
          <span className="text-[11.5px] text-(--mkt-faint) sm:text-[13px]">
            the tutor that&apos;s already on the page.
          </span>
        </div>
        <div className="grid grid-cols-3 gap-4 sm:flex sm:gap-20">
          {COLUMNS.map((column) => (
            <div
              key={column.heading}
              className="flex flex-col gap-[7px] text-[11.5px] text-(--mkt-strip-text) sm:gap-2.5 sm:text-[13px]"
            >
              <span className="text-[10.5px] font-semibold text-foreground sm:text-xs">{column.heading}</span>
              {column.links.map((link) =>
                link.href.startsWith('#') ? (
                  <a key={link.label} href={link.href} className="transition-colors hover:text-foreground">
                    {link.label}
                  </a>
                ) : (
                  <Link key={link.label} href={link.href} className="transition-colors hover:text-foreground">
                    {link.label}
                  </Link>
                )
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="flex justify-between border-t border-(--mkt-hairline-soft) pt-3.5 text-[10.5px] text-(--mkt-faint) sm:pt-5 sm:text-[12.5px]">
        <span>© {new Date().getFullYear()} calyxa</span>
        <span>made for students, not answers.</span>
      </div>
    </footer>
  )
}
