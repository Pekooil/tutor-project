'use client'

import Link from 'next/link'
import { useState } from 'react'
import { CalyxaMark } from '@calyxa/ui'

// Landing v6 nav (design_handoff_landing_v6 §1): transparent and non-sticky,
// riding the page's green wash — 36px logomark + a 30px lowercase wordmark on
// the left, text links and one white pill CTA on the right.
//
// Two deliberate deviations from the design file, both because the design's
// hrefs point at anchors that no longer exist on this page:
//  - "Privacy" goes to /privacy (the design anchored it to the "Private by
//    design" card, which Darcy removed from the "there's more" section).
//  - "Pricing" is added, routing to /pricing. The landing itself no longer
//    renders a pricing section (Darcy, 2026-07-24): pricing is reachable only
//    from this nav and the footer.
//
// Mobile keeps the same bar at a smaller scale with the links behind a
// hamburger disclosure, mirroring the Landing v5 Nav it replaces.

const LINKS = [
  // Root-relative so the anchor still resolves from /pricing, which reuses
  // this nav. #how-it-works is the before/after section — the study-material
  // section it used to point at stopped being the how-it-works answer when it
  // switched to showing the notes surfaces (2026-07-24).
  { label: 'How it works', href: '/#how-it-works' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Privacy', href: '/privacy' },
]

export function LandingNav() {
  const [open, setOpen] = useState(false)

  return (
    <header className="relative mx-auto flex w-full max-w-[1400px] items-center gap-6 px-5 py-4 sm:gap-10 sm:px-11 sm:py-[26px]">
      <Link href="/" className="flex items-center gap-2 text-foreground sm:gap-3">
        <CalyxaMark className="h-7 w-7 sm:h-9 sm:w-9" />
        <span className="mkt-display text-[22px] font-bold tracking-[-0.02em] sm:text-[30px]">calyxa</span>
      </Link>

      <div className="ml-auto flex items-center gap-3 sm:gap-[34px]">
        <div className="hidden items-center gap-[34px] sm:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-lg font-medium text-foreground transition-colors hover:text-muted-foreground"
            >
              {link.label}
            </Link>
          ))}
        </div>
        <Link
          href="/dashboard"
          className="inline-flex items-center rounded-full bg-background px-4 py-2.5 text-[13.5px] font-semibold text-foreground transition-colors hover:bg-[#f7f7f5] sm:px-[30px] sm:py-3.5 sm:text-lg"
          style={{ boxShadow: '0 2px 10px rgba(28,28,26,0.08)' }}
        >
          Dashboard
        </Link>
        <button
          type="button"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((wasOpen) => !wasOpen)}
          className="flex flex-col gap-1 py-1.5 pl-1 sm:hidden"
        >
          <span className="h-0.5 w-4 rounded-[2px] bg-foreground" />
          <span className="h-0.5 w-4 rounded-[2px] bg-foreground" />
        </button>
      </div>

      {open && (
        <div className="absolute inset-x-0 top-full z-50 flex flex-col gap-4 border-b border-(--mkt-hairline-soft) bg-background px-5 py-5 text-sm font-medium text-(--mkt-strip-text) sm:hidden">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} onClick={() => setOpen(false)} className="hover:text-foreground">
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </header>
  )
}
