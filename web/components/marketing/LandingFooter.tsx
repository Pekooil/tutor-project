import Link from 'next/link'
import { CalyxaMark } from '@calyxa/ui'

// Landing v6 §9: logomark + wordmark, tagline, right-aligned links, and the
// baseline rule.
//
// 2026-07-30 (Darcy: "the super dark green color, ugly right now"): the
// footer was bg-accent-fill-foreground — #14532d, a near-black green — with
// white/mint text on it. Replaced with the same light ambient wash the hero
// opens on (page.tsx's AMBIENT: a soft green tint fading to white, radial glow
// anchored above), so the page reads as one continuous surface rather than
// ending on a hard dark band. Everything on it is now dark-on-light like the
// rest of the page instead of light-on-dark.
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

// The same soft green wash the hero opens on (page.tsx's AMBIENT), mirrored
// for the bottom of the page: a radial glow anchored just above the footer
// band, fading out, over a faint vertical tint rather than solid white. Picks
// up where FinalCta's own gradient (white → #f0fdf4) leaves off, so the page
// reads as one continuous surface instead of ending on a hard dark band.
const FOOTER_AMBIENT = {
  backgroundColor: '#ffffff',
  backgroundImage: [
    'radial-gradient(60rem 26rem at 50% -4rem, rgba(134,239,172,0.24), transparent 70%)',
    'linear-gradient(180deg, rgba(134,239,172,0.12) 0%, rgba(134,239,172,0.04) 60%, rgba(134,239,172,0) 100%)',
  ].join(', '),
  backgroundRepeat: 'no-repeat' as const,
}

export function LandingFooter() {
  return (
    <footer className="px-[22px] py-10 text-foreground sm:px-11 sm:py-14" style={FOOTER_AMBIENT}>
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-5 sm:gap-7">
        <div className="flex items-center gap-3">
          <CalyxaMark className="h-[26px] w-[26px] sm:h-[30px] sm:w-[30px]" />
          <span className="mkt-display text-lg font-bold text-foreground sm:text-[22px]">calyxa</span>
        </div>
        <span className="text-[15px] text-muted-foreground sm:text-lg">Growth through learning.</span>
        <div className="flex flex-wrap items-center gap-5 sm:ml-auto sm:gap-7">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-[15px] text-(--mkt-strip-text) hover:text-accent-emphasis sm:text-[17px]"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
      <p
        className="mx-auto mb-0 mt-7 max-w-[1240px] border-t border-(--mkt-hairline) pt-6 text-[13px] text-muted-foreground sm:mt-[34px] sm:pt-[26px] sm:text-[15px]"
      >
        © {new Date().getFullYear()} Calyxa. All rights reserved.
      </p>
    </footer>
  )
}
