import type { Metadata } from 'next'
import { LandingFooter } from '@/components/marketing/LandingFooter'
import { LandingNav } from '@/components/marketing/LandingNav'
import { Pricing } from '@/components/marketing/Pricing'
import '@/components/marketing/marketing.css'

// Pricing lives on its own page as of Landing v6 (Darcy, 2026-07-24): the
// landing no longer renders a pricing section, so the plans are reachable only
// from the nav and the footer, which both point here. The section component
// itself is unchanged — same $0 / $10 cards, same FREE_SESSIONS_PER_MONTH.

export const metadata: Metadata = {
  title: 'Pricing — Calyxa',
  description: 'Calyxa pricing: 10 free tutoring sessions a month, or unlimited sessions on Pro for $10/month.',
}

export default function PricingPage() {
  return (
    <div className="mkt">
      <LandingNav />
      <main>
        <Pricing />
      </main>
      <LandingFooter />
    </div>
  )
}
