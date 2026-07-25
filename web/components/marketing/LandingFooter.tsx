import Link from 'next/link'
import { CalyxaMark } from '@calyxa/ui'

// Landing v6 §9: the dark accent-foreground footer — logomark + wordmark,
// tagline, right-aligned links, and the baseline rule.
//
// The design's "Support" link is swapped for "Pricing" (/pricing): there is no
// support page, and pricing is now reachable only from the nav and this footer
// (Darcy, 2026-07-24). "How it works" anchors the session section, "Privacy"
// and "Terms" hit the real pages.

const LINKS = [
  { label: 'Privacy', href: '/privacy' },
  { label: 'Terms', href: '/terms' },
  { label: 'Pricing', href: '/pricing' },
  // Root-relative so the anchor still resolves from /pricing, which reuses
  // this footer.
  { label: 'How it works', href: '/#how-it-works' },
]

export function LandingFooter() {
  return (
    <footer className="bg-accent-fill-foreground px-[22px] py-10 text-[#dcfce7] sm:px-11 sm:py-14">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-5 sm:gap-7">
        <div className="flex items-center gap-3">
          <CalyxaMark className="h-[26px] w-[26px] sm:h-[30px] sm:w-[30px]" />
          <span className="mkt-display text-lg font-bold text-white sm:text-[22px]">calyxa</span>
        </div>
        <span className="text-[15px] text-(--color-accent-glow) sm:text-lg">Growth through learning.</span>
        <div className="flex flex-wrap items-center gap-5 sm:ml-auto sm:gap-7">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="text-[15px] text-[#dcfce7] hover:text-white sm:text-[17px]">
              {link.label}
            </Link>
          ))}
        </div>
      </div>
      <p
        className="mx-auto mb-0 mt-7 max-w-[1240px] pt-6 text-[13px] text-(--color-accent) sm:mt-[34px] sm:pt-[26px] sm:text-[15px]"
        style={{ borderTop: '1px solid rgba(220,252,231,0.2)' }}
      >
        © {new Date().getFullYear()} Calyxa. All rights reserved.
      </p>
    </footer>
  )
}
