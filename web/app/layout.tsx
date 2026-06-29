import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Geist } from 'next/font/google'
import './globals.css'

export const metadata: Metadata = {
  title: 'Calyxa',
  description: 'Calyxa — AI math tutor',
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
