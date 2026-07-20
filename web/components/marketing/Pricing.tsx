// Pricing numbers come from PLAN.md §2.8 verbatim — no invented tiers, no
// "contact us." FREE_SESSION_LIMIT lives server-side at
// web/lib/tier/session-gate.ts (2026-07-17 public-launch retune: 20 -> 10,
// see that file's comment for the reasoning); that module pulls in
// @supabase/supabase-js and is written for server routes, not a marketing
// page, so this file keeps its own literal rather than importing it —
// pricing.test.ts binds the two constants so they cannot drift silently.
// Exported so Hero/FinalCta copy that echoes the number shares this ONE
// marketing-side literal.
export const FREE_SESSIONS_PER_MONTH = 10
// Monthly-only for now (2026-07-19): annual is disabled at launch. This literal
// must match the live Stripe Price behind STRIPE_PRICE_ID ($10/mo).
const PRO_MONTHLY = 10

const FREE_FEATURES = ['annotations on any page', 'voice tutoring', 'session notes']
const PRO_FEATURES = [
  'unlimited sessions',
  'remembers your misconceptions',
  'study kits after every session',
  'priority support',
]

// Landing v5 pricing: Free card on the board wash, Pro on the green wash with
// the accent ring. Mobile stacks Pro first and trims the checklists. The Pro
// CTA routes to /billing (Stripe Checkout, ADR-050); Free signs up directly.
// Monthly-only for now (2026-07-19) — the annual toggle is disabled at launch.
export function Pricing() {
  return (
    <section
      id="pricing"
      className="flex flex-col items-center border-t border-(--mkt-hairline-soft) bg-background px-[22px] py-14 sm:px-[72px] sm:py-[104px]"
    >
      <p className="mkt-eyebrow m-0">pricing</p>
      <h2 className="mkt-display mkt-h2-sm mb-0 mt-3 text-center text-foreground sm:mt-4">Simple, honest pricing.</h2>

      <div className="mt-6 grid w-full max-w-[880px] items-stretch gap-3.5 sm:mt-9 sm:grid-cols-2 sm:gap-[22px]">
        {/* Free — second on mobile, first on desktop */}
        <div className="flex flex-col gap-4 rounded-2xl border border-(--mkt-hairline) bg-(--calyxa-board-bg) p-6 max-sm:order-2 sm:gap-[22px] sm:rounded-[20px] sm:px-9 sm:py-[34px]">
          <div>
            <p className="mkt-eyebrow m-0 text-(--mkt-faint)">free</p>
            <p className="mkt-display m-0 mt-2.5 text-[38px] leading-none tracking-[-0.02em] text-foreground sm:mt-3.5 sm:text-[52px]">
              $0
              <span className="font-sans text-sm font-normal text-muted-foreground sm:text-base">/mo</span>
            </p>
            <p className="mb-0 mt-2 text-[12.5px] leading-[1.6] text-muted-foreground sm:mt-3 sm:text-[14.5px]">
              {FREE_SESSIONS_PER_MONTH} tutoring sessions a month.
            </p>
          </div>
          <div className="hidden flex-col gap-[9px] text-[13.5px] text-(--mkt-strip-text) sm:flex">
            {FREE_FEATURES.map((feature) => (
              <span key={feature}>✓&nbsp; {feature}</span>
            ))}
          </div>
          <a
            href="/signup"
            className="mt-auto inline-flex items-center justify-center rounded-[9px] border border-[#79766e] bg-transparent px-0 py-[11px] text-[13px] font-semibold text-foreground transition-colors hover:bg-[#f7f7f5] sm:justify-start sm:self-start sm:px-5 sm:py-2.5 sm:text-[13.5px]"
          >
            Start free
          </a>
        </div>

        {/* Pro — first on mobile */}
        <div className="flex flex-col gap-4 rounded-2xl border border-(--calyxa-sage-border) bg-accent-subtle p-6 shadow-[0_0_0_3px_rgba(134,239,172,0.14),0_14px_34px_-14px_rgba(28,40,30,0.18)] max-sm:order-1 sm:gap-[22px] sm:rounded-[20px] sm:px-9 sm:py-[34px] sm:shadow-[0_0_0_4px_rgba(134,239,172,0.14),0_18px_44px_-16px_rgba(28,40,30,0.18)]">
          <div>
            <p className="mkt-eyebrow m-0">pro</p>
            <p className="mkt-display m-0 mt-2.5 text-[38px] leading-none tracking-[-0.02em] text-foreground sm:mt-3.5 sm:text-[52px]">
              {`$${PRO_MONTHLY}`}
              <span className="font-sans text-sm font-normal text-muted-foreground sm:text-base">/mo</span>
            </p>
            <p className="mb-0 mt-1.5 text-[11px] text-(--mkt-faint) sm:mt-2 sm:text-[12.5px]">
              billed monthly
            </p>
            <p className="mb-0 mt-3 hidden text-[14.5px] leading-[1.6] text-muted-foreground sm:block">
              unlimited sessions. everything calyxa learns about you, working for you.
            </p>
          </div>
          <div className="flex flex-col gap-[7px] text-[12.5px] text-(--mkt-strip-text) sm:gap-[9px] sm:text-[13.5px]">
            {PRO_FEATURES.map((feature, index) => (
              <span key={feature} className={index === PRO_FEATURES.length - 1 ? 'max-sm:hidden' : undefined}>
                ✓&nbsp; {feature}
              </span>
            ))}
          </div>
          <a
            href="/billing"
            className="mt-auto inline-flex items-center justify-center rounded-[9px] bg-accent-fill px-0 py-[11px] text-[13px] font-semibold text-accent-fill-foreground transition-colors hover:bg-[#6ee7a0] sm:justify-start sm:self-start sm:px-5 sm:py-2.5 sm:text-[13.5px]"
          >
            Upgrade to Pro
          </a>
        </div>
      </div>

      <p className="mb-0 mt-[18px] text-center text-[11.5px] leading-[1.6] text-(--mkt-faint) sm:mt-6 sm:text-[13.5px]">
        a human tutor is $40–80 an hour. a month of calyxa costs less than 20 minutes of one.
      </p>
    </section>
  )
}
