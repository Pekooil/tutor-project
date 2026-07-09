import 'server-only'
import { createHmac } from 'crypto'

// Sprint 16 / Task 7 (ADR-036): page identifiers hashed at rest. The
// extension's `deriveTabDomain` (extension/src/background/index.ts) already
// sends only the registrable domain, never a full URL — this is the last
// step to the compliant target: hash even that domain with a server-only
// salt before it's ever written to `sessions.page_url_hash`
// (web/app/api/session/start/route.ts). HMAC (not a bare SHA-256) is what
// makes this irreversible without the salt — an unsalted hash would be
// trivially reversible via a rainbow table over the small space of real-
// world domains. URL_HASH_SALT must never be prefixed NEXT_PUBLIC_ and must
// never reach any client bundle.
export function hashPageDomain(domain: string | null): string | null {
  if (!domain) {
    return null
  }

  const salt = process.env.URL_HASH_SALT

  if (!salt) {
    throw new Error('hashPageDomain: URL_HASH_SALT is not set')
  }

  return createHmac('sha256', salt).update(domain).digest('hex')
}
