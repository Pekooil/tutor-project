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
    name: 'free',
    price: '$0',
    tagline: `${FREE_SESSIONS_PER_MONTH} tutoring sessions a month.`,
    accented: false,
  },
  {
    name: 'pro',
    price: `$${PRO_PRICE_PER_MONTH}`,
    tagline: 'unlimited sessions. everything calyxa learns about you, working for you.',
    accented: true,
  },
] as const

// Landing v3 restyle (numbers unchanged): Free on the card wash, Pro on
// white with the sage border + ring; the honest cost comparison closes it.
export function Pricing() {
  return (
    <Section id="pricing" align="center" kicker="pricing" heading="simple, honest pricing.">
      <div className="mx-auto grid w-full max-w-[880px] gap-6 sm:grid-cols-2">
        {PLANS.map((plan) => (
          <div
            key={plan.name}
            className={cn(
              'flex flex-col gap-7 rounded-2xl px-[38px] py-9 text-left',
              plan.accented
                ? 'border border-(--color-accent-fill) bg-background shadow-[0_0_0_4px_rgba(134,239,172,0.16),0_18px_44px_-16px_rgba(28,40,30,0.18)]'
                : 'border border-(--mkt-hairline-soft) bg-(--calyxa-board-bg)'
            )}
          >
            <div>
              <p className={cn('mkt-kicker m-0', !plan.accented && 'text-(--mkt-faint)')}>{plan.name}</p>
              <p className="mkt-display mt-3.5 text-[52px] leading-none text-foreground">
                {plan.price}
                <span className="font-sans text-[17px] font-normal text-muted-foreground">/mo</span>
              </p>
              <p className="mb-0 mt-3.5 text-[15px] leading-[1.6] text-muted-foreground">{plan.tagline}</p>
            </div>
            <Button asChild className="mt-auto" variant={plan.accented ? 'default' : 'outline'}>
              <a href="#final-cta">Join the waitlist</a>
            </Button>
          </div>
        ))}
      </div>
      <p className="mb-0 mt-[22px] text-center text-[13.5px] text-(--mkt-faint)">
        a human tutor is $40–80 an hour. a month of calyxa costs less than 20 minutes of one.
      </p>
    </Section>
  )
}
