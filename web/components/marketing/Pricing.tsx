import { Button } from '@/components/ui/button'
import { Section } from '@/components/marketing/Section'
import { cn } from '@/lib/utils'

// Pricing numbers come from PLAN.md §2.8 verbatim — no invented tiers, no
// "contact us." FREE_SESSION_LIMIT lives server-side at
// web/lib/tier/session-gate.ts (currently 10); that module pulls in
// @supabase/supabase-js and is written for server routes, not a marketing
// page, so this file keeps its own literal rather than importing it —
// per the sprint handoff, if Sprint 16's cost work retunes the limit, this
// is the one constant here to update alongside it.
const FREE_SESSIONS_PER_MONTH = 10
const PRO_PRICE_PER_MONTH = 12

const PLANS = [
  {
    name: 'Free',
    price: '$0',
    tagline: `${FREE_SESSIONS_PER_MONTH} tutoring sessions a month.`,
    accented: false,
  },
  {
    name: 'Pro',
    price: `$${PRO_PRICE_PER_MONTH}`,
    tagline: 'Unlimited sessions. Everything Calyxa learns about you, working for you.',
    accented: true,
  },
] as const

export function Pricing() {
  return (
    <Section
      id="pricing"
      tone="wash"
      kicker="Pricing"
      heading="Simple, honest pricing."
      sub="Free — 10 tutoring sessions a month. Pro — $12/mo for unlimited sessions."
    >
      <div className="grid gap-6 sm:grid-cols-2">
        {PLANS.map((plan) => (
          <div
            key={plan.name}
            className={cn('flex flex-col gap-8 p-8 sm:p-10', plan.accented ? 'mkt-card-featured' : 'mkt-card-raised')}
          >
            <div>
              <p className="mkt-kicker">{plan.name}</p>
              <p className="mkt-display mt-4 text-5xl text-foreground sm:text-6xl">
                {plan.price}
                <span className="text-lg text-muted-foreground">/mo</span>
              </p>
              <p className="mt-4 text-base text-muted-foreground">{plan.tagline}</p>
            </div>
            <Button asChild className="mt-auto" variant={plan.accented ? 'default' : 'outline'}>
              <a href="#final-cta">Join the waitlist</a>
            </Button>
          </div>
        ))}
      </div>
    </Section>
  )
}
