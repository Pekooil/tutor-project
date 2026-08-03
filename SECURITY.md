# Security Policy

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Email **support@calyxa.app** with:

- what the issue is and where in the code it lives,
- how to reproduce it (a minimal proof of concept is ideal),
- what an attacker could achieve with it.

You should get an acknowledgement within a few days. Please give a reasonable
window to ship a fix before disclosing publicly.

Calyxa is a small beta-stage project with no bug bounty program, but credit in
the fix is offered gladly to anyone who reports responsibly.

## Scope

**In scope**

- The Next.js backend and its API routes (`web/`)
- The Chrome extension (`extension/`)
- Supabase schema, RLS policies, and migrations (`supabase/`)
- Anything that would expose a server-side secret, bypass Row Level Security, or
  let one user reach another user's data

**Out of scope**

- Findings that require a compromised device, browser, or Chrome profile
- Missing hardening headers with no demonstrated impact
- Rate-limit findings on endpoints that already enforce
  `web/lib/rate-limit/limiter.ts`, unless the limit can be bypassed
- Denial of service through raw traffic volume
- Reports from automated scanners with no verified exploit path

## Security design

Several invariants are enforced by CI rather than by review, and breaking one
should be treated as a bug even without a demonstrated exploit:

| Invariant | Enforced by |
| --- | --- |
| No provider key ever reaches the extension bundle | `scripts/check-no-secrets.mjs`, run against the **built** artifact in CI |
| Every table has RLS before receiving data | `web/tests/rls.test.ts` coverage sweep |
| Session audio is never persisted | Streaming-only STT; no storage path exists |
| Page URLs are stored only as salted HMAC hashes | `web/lib/privacy/url-hash.ts` |
| Free-tier limits are authoritative server-side | `start_session` RPC; the client value is a display hint only |

Full audit: [`docs/security-review-sprint18.md`](docs/security-review-sprint18.md).
Data collected: [`docs/data-safety-disclosure.md`](docs/data-safety-disclosure.md).

## Supported versions

Only the latest released extension version (currently `0.1.4`) and the currently
deployed backend receive security fixes.
