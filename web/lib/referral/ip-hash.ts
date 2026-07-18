import 'server-only'
import { createHmac } from 'crypto'

// ADR-053: the signup per-network account cap stores an HMAC of the client IP,
// never the raw address — the same irreversibility argument as
// sessions.page_url_hash (ADR-036, lib/privacy/url-hash.ts). The salt is the
// existing server-only URL_HASH_SALT; the `signup-ip:` domain prefix keeps the
// two uses of that salt in disjoint input spaces, so a page-domain hash can
// never collide with an IP hash.
//
// Unlike hashPageDomain this does NOT throw on a missing salt: it returns null
// and the signup route logs + skips the cap (fail-open, the same contract as
// checkRateLimit/costGuard — an env hiccup must never block a legitimate
// signup; see the 2026-07-15 URL_HASH_SALT outage post-mortem).
export function hashSignupIp(ip: string | null): string | null {
  if (!ip) {
    return null
  }

  const salt = process.env.URL_HASH_SALT

  if (!salt) {
    return null
  }

  return createHmac('sha256', salt).update(`signup-ip:${ip}`).digest('hex')
}

// The client IP from Vercel's forwarded headers, same extraction order as
// rate-limit/limiter.ts's clientBucket: first x-forwarded-for entry, then
// x-real-ip, else null (null -> hashSignupIp(null) -> the cap is skipped
// rather than lumping unknown clients into one shared bucket that would lock
// out legitimate signups).
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || request.headers.get('x-real-ip')?.trim() || null
}
