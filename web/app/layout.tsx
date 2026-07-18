import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Geist } from 'next/font/google'
import './globals.css'

// Sprint 20 Task 9: SEO/unfurl metadata. The production domain is now decided
// (Sprint 19: https://calyxa.app, the custom domain on Vercel) so the fallback
// below is the real origin — og:image/twitter:image resolve to absolute
// calyxa.app URLs in production even if NEXT_PUBLIC_SITE_URL is unset. Setting
// NEXT_PUBLIC_SITE_URL still overrides (e.g. a preview deploy pointing at its
// own URL); a localhost fallback here would have shipped broken unfurls to the
// beta cohort.
const TITLE = 'Calyxa — Stop asking AI for answers. Start learning from it.'
const DESCRIPTION =
  "Calyxa sees the problem you're stuck on, talks you through it out loud, and points at the exact step you're missing — without ever just giving you the answer."

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://calyxa.app'),
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={geistSans.variable}>
      <body className="font-[family-name:var(--font-geist-sans)]">{children}</body>
    </html>
  )
}
