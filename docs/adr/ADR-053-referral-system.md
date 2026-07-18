## ADR-053: Referral system (invite 3 friends → 10 free sessions) + per-network signup cap

**Status:** Accepted (2026-07-18) — Darcy's direct feature request. Additive to
the freemium gate (ADR-041's `FREE_SESSION_LIMIT`, retuned to 10 on
2026-07-17) and to the open-signup flow (public launch, 2026-07-17). Migration
**0024_referral.sql**.

**Context:** With open signup and a 10-sessions/month free cap, two adjacent
needs landed together: (1) a growth loop — a student who runs out of sessions
(or demonstrably likes the product) should be able to earn more by inviting
friends, instead of hitting a paywall-or-nothing; and (2) an abuse gate — a
referral reward makes self-registration farming profitable, so the signup
route needs the per-IP account limit that had never been wired (the Sprint 18
security review's rate-limit infra keys on IP but only throttles bursts; it
does not bound accounts-per-network).

**Decision:**

1. **Reward shape — +10 bonus sessions per 3 referred signups, repeatable.**
   `record_referral` (SECURITY DEFINER, service-role only, row-locked on the
   referrer) inserts the referral exactly once (`referred_user_id` UNIQUE —
   an account can be referred at most once, ever), counts, and pays
   `floor(count/3) - rewards_already_granted` tranches of +10 into
   `users.referral_bonus_sessions`. Granting at signup time (not
   session-completion time) keeps the promise legible — "3 friends join, you
   get 10 sessions" — and the per-network cap below is the abuse bound.

2. **Bonus sessions are a spendable balance consumed AFTER the monthly
   allowance, and they never expire.** `start_session` v3 (same 4-arg
   signature; deployed callers unaffected) tries the monthly
   `free_session_count < p_free_limit` gate first, then decrements
   `referral_bonus_sessions`, and only then declares the session degraded.
   `remaining` = monthly remainder + bonus balance, so every existing
   display (popup counter) shows earned sessions with no client change.
   Pro users are untouched (the tier exemption short-circuits first).

3. **The trigger moments are server-computed; the extension only displays.**
   `GET /api/referral/status` returns the counts plus `outOfSessions`
   (allowance AND bonus both spent) and the completed-sessions milestone
   constant (5). The background worker owns the show-it-now decision with
   suppression state in `chrome.storage.local` (milestone card once ever;
   out-of-sessions card re-arms weekly) and the overlay asks only at session
   close (`performClose`) — the referral card is a new lowest-priority
   `SurfaceKind`, never interrupting a live surface. The popup's free-limit
   upsell gains the referral line alongside the Pro link.

4. **The link is the signup page:** `/signup?ref=CODE`. The code is a
   server-managed 8-char unambiguous-alphabet column (`users.referral_code`,
   unique, allocated idempotently by `POST /api/referral/link` via the
   service role — a client can never choose it). Attribution is best-effort
   at signup (bad/unknown/self codes are ignored, never block account
   creation) and recorded as `users.referred_by` + a `referral` row
   (Shape 2, select-own for the REFERRER; FK-cascade both sides). The
   dashboard `/referral` page (avatar-menu "Invite friends") is the durable
   home of the link + progress; the extension card deep-links to it.

5. **Per-network signup cap: max 2 accounts per HMAC-hashed IP, fail-open.**
   The signup route computes `HMAC-SHA256('signup-ip:' + ip, URL_HASH_SALT)`
   (same server-only salt as the page-domain hash, disjoint input domain;
   the raw IP is NEVER stored — the ADR-036 irreversibility argument) and
   refuses the 3rd account from one hash with a 403. `signup_ip` is Shape 3
   deny-all, one row per account, FK-cascade — deleting an account frees its
   network slot deliberately. Missing header/salt or a query error logs and
   admits (the checkRateLimit/costGuard fail-open contract: infra hiccups
   must never block a legitimate signup). Limit 2, not 1: households/siblings
   behind one NAT are real; farms of three-plus are not.

6. **Privacy surface updated in the same change (ADR-046's load-bearing
   rule):** `/privacy` and `docs/data-safety-disclosure.md` now disclose the
   hashed signup network identifier (abuse prevention, one-way, never
   location) and the referral data; `signup_ip` joins the export via the
   service-role path (the telemetry_event pattern — deny-all but still the
   user's data) and `referral` joins `RLS_SCOPED_TABLES`; both erase via FK
   cascade (ADR-035 invariant held).

**Consequences:** A deleted referred account keeps any already-paid reward
(the tranche math never claws back — acceptable; the IP cap bounds farming).
The IP cap depends on `URL_HASH_SALT` being set in prod (it fail-opens
without it, and its absence already 500s session starts — see the 2026-07-15
outage note). The CWS data-safety form must be re-transcribed from the
updated disclosure before the next store submission. Known residual: a
determined attacker with many IPs (VPN) can still farm referrals — the cap
raises the cost, it does not make farming impossible; revisit with a
completed-session qualification if real abuse appears.
