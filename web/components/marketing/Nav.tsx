'use client'

import Link from 'next/link'
import { useState } from 'react'
import { CalyxaMark } from '@calyxa/ui'

// Landing v5 nav: in-flow bar (not sticky, matching the artboard) — logomark
// + lowercase wordmark, center links, log in + the accent CTA. The design's
// "beta notes" link is dropped (no such page yet — Darcy 2026-07-19); all
// CTAs route to /signup while the Chrome Web Store listing is unpublished.
// Mobile: "Get calyxa" + a hamburger disclosure holding the remaining links.

const LINKS = [
  { label: 'how it works', href: '#how-it-works' },
  { label: 'pricing', href: '#pricing' },
]

export function Nav() {
  const [open, setOpen] = useState(false)

  return (
    <header className="relative border-b border-(--mkt-hairline-soft)">
      <nav className="flex items-center gap-2 px-5 py-4 sm:gap-9 sm:px-14 sm:py-5">
        <Link href="/" className="flex items-center gap-2 sm:gap-[9px]">
          <CalyxaMark className="h-[21px] w-[21px] sm:h-6 sm:w-6" />
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-foreground sm:text-[17px]">calyxa</span>
        </Link>
        <div className="hidden gap-[26px] text-[13.5px] font-medium text-(--mkt-strip-text) sm:flex">
          {LINKS.map((link) => (
            <a key={link.href} href={link.href} className="transition-colors hover:text-foreground">
              {link.label}
            </a>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 sm:gap-[18px]">
          <Link
            href="/login"
            className="hidden text-[13.5px] font-medium text-(--mkt-strip-text) transition-colors hover:text-foreground sm:inline"
          >
            log in
          </Link>
          <a
            href="/signup"
            className="inline-flex items-center rounded-lg bg-accent-fill px-3.5 py-2 text-[12.5px] font-semibold text-accent-fill-foreground transition-colors hover:bg-[#6ee7a0] sm:rounded-[9px] sm:px-[18px] sm:py-[9px] sm:text-[13.5px]"
          >
            <span className="max-sm:hidden">Add to Chrome — free</span>
            <span className="sm:hidden">Get calyxa</span>
          </a>
          <button
            type="button"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((wasOpen) => !wasOpen)}
            className="flex flex-col gap-1 py-1.5 pl-2 pr-0.5 sm:hidden"
          >
            <span className="h-0.5 w-4 rounded-[2px] bg-foreground" />
            <span className="h-0.5 w-4 rounded-[2px] bg-foreground" />
          </button>
        </div>
      </nav>
      {open && (
        <div className="absolute inset-x-0 top-full z-50 flex flex-col gap-4 border-b border-(--mkt-hairline-soft) bg-background px-5 py-5 text-sm font-medium text-(--mkt-strip-text) sm:hidden">
          {LINKS.map((link) => (
            <a key={link.href} href={link.href} onClick={() => setOpen(false)} className="hover:text-foreground">
              {link.label}
            </a>
          ))}
          <Link href="/login" className="hover:text-foreground">
            log in
          </Link>
        </div>
      )}
    </header>
  )
}
