// Single source of truth for the site's own absolute origin, used to build
// user-facing absolute URLs: Stripe checkout/portal redirects
// (lib/billing/stripe.ts), referral share links (lib/referral/referral.ts),
// and OG/canonical metadata (app/layout.tsx).
//
// Why this exists: the production custom domain is https://calyxa.app, but the
// retired Vercel deployment origins (tutor-project-web-*.vercel.app) are still
// reachable, and a STALE `NEXT_PUBLIC_SITE_URL` pointing at one of them silently
// sent real paying users off to the abandoned app — most visibly, Stripe's
// "Manage subscription" return_url landed them back on the old host. A missing
// env var was handled (localhost/calyxa fallbacks); a WRONG env var was not.
//
// canonicalizeSiteUrl() closes that hole: ANY *.vercel.app value is treated as
// non-canonical and replaced with the custom domain, so no user is ever
// redirected to a vercel.app origin regardless of how the env is configured.
// An explicit localhost value still passes through for local dev. Each caller
// supplies its own fallback for the unset case (Stripe wants localhost in dev;
// metadata/referral want calyxa.app so unfurls/links never break).
//
// The proper fix remains setting NEXT_PUBLIC_SITE_URL=https://calyxa.app in
// Vercel prod — this guard is the durable safety net so a future drift can't
// leak the old host again.
export const CANONICAL_SITE_URL = 'https://calyxa.app'

export function canonicalizeSiteUrl(value: string | undefined, fallback: string): string {
  const raw = value?.trim().replace(/\/+$/, '')
  if (!raw) return fallback
  let host: string
  try {
    host = new URL(raw).host
  } catch {
    // Malformed value — don't risk emitting garbage; use the caller's fallback.
    return fallback
  }
  // Local dev origins are legitimate and must keep working.
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) return raw
  // Any Vercel deployment origin (old alias OR a preview URL) is never the
  // canonical user-facing domain — force the custom domain.
  if (/\.vercel\.app$/i.test(host)) return CANONICAL_SITE_URL
  return raw
}
