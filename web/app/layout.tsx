import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Geist, Schibsted_Grotesk } from 'next/font/google'
import { canonicalizeSiteUrl, CANONICAL_SITE_URL } from '@/lib/site-url'
import './globals.css'

// Sprint 20 Task 9: SEO/unfurl metadata. The production domain is now decided
// (Sprint 19: https://calyxa.app, the custom domain on Vercel) so the fallback
// below is the real origin — og:image/twitter:image resolve to absolute
// calyxa.app URLs in production even if NEXT_PUBLIC_SITE_URL is unset. Setting
// NEXT_PUBLIC_SITE_URL still overrides (e.g. a preview deploy pointing at its
// own URL); a localhost fallback here would have shipped broken unfurls to the
// beta cohort.
// Landing v5 (2026-07-19): title/description track the live H1 + hero sub so
// unfurls match what the page actually says.
const TITLE = 'Calyxa — Turn AI into your tutor, not your shortcut.'
const DESCRIPTION =
  "Calyxa sees the problem on your screen and talks you through it — never the answer, just the step you're missing."

export const metadata: Metadata = {
  metadataBase: new URL(canonicalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL, CANONICAL_SITE_URL)),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: 'website',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/og.png'],
  },
}

// The brand geometric sans (ADR-018, /docs/brand.md §5) — first-party via
// next/font, so it's self-hosted with no third-party font request. The
// extension overlay can't do this (no-host-mutation policy); it stays on
// the --font-sans system-stack token from @calyxa/ui/theme.css instead.
const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

// The Landing v5 display face (design handoff 2026-07-19): Schibsted Grotesk
// 500–700, consumed only through the .mkt token layer's --font-display —
// product surfaces keep Geist.
const schibstedGrotesk = Schibsted_Grotesk({
  variable: '--font-schibsted-grotesk',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
})

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${schibstedGrotesk.variable}`}>
      <body className="font-[family-name:var(--font-geist-sans)]">{children}</body>
    </html>
  )
}
