import { Button } from '@/components/ui/button'
import { Section } from '@/components/marketing/Section'
import { cn } from '@/lib/utils'

// Pricing numbers come from PLAN.md §2.8 verbatim — no invented tiers, no
// "contact us." FREE_SESSION_LIMIT lives server-side at
// web/lib/tier/session-gate.ts (Sprint 16 / Task 4 retune: 10 -> 20, see
// that file's comment for the reasoning); that module pulls in
// @supabase/supabase-js and is written for server routes, not a marketing
// page, so this file keeps its own literal rather than importing it —
// pricing.test.ts binds the two constants so they cannot drift silently.
// Exported so Hero.tsx and FinalCta.tsx (which both echo this same number in
// their own tagline) share this ONE marketing-side literal instead of each
// hardcoding it — found already drifted (still "10") while retuning this
// value for Task 4, exactly the failure mode this sync exists to prevent.
export const FREE_SESSIONS_PER_MONTH = 20
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
      sub={`Free — ${FREE_SESSIONS_PER_MONTH} tutoring sessions a month. Pro — $${PRO_PRICE_PER_MONTH}/mo for unlimited sessions.`}
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
