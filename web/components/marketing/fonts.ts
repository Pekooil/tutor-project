import { Bricolage_Grotesque } from 'next/font/google'

// The marketing display face (approved marketing-only exception to brand.md
// §5's Geist lock — see marketing.css's header note). Self-hosted via
// next/font like Geist, so no third-party font request. Scoped: page.tsx
// applies the variable class to the marketing root only; product surfaces,
// the wordmark SVG, and the demo recreation never see this family.
// Pinned to the one weight the display classes use (600) instead of the
// full variable axes — the static instance is a fraction of the variable
// file's size, which is what keeps the hero H1's LCP inside the Lighthouse
// performance budget.
export const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: '600',
  variable: '--font-bricolage',
  display: 'swap',
})
