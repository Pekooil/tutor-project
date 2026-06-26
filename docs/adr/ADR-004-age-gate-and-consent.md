## ADR-004: COPPA age gate + GDPR consent

**Status:** Decided

**Context:** COPPA (minimum age 13) and GDPR consent are launch requirements,
not optional polish. We must refuse account creation for under-13 signups
while minimising the personal data collected, and capture explicit consent
before any processing of a user's data begins.

**Decision:** Collect birth year only at signup (data minimisation, not a
full date of birth). The age gate is enforced server-side, before the auth
user or profile row is created — under-13 attempts create no `auth.users`
row and no `public.users` row, and retain no email. GDPR consent is a
separate, explicit, non-pre-ticked opt-in checkbox captured on the same
screen; on a passing, consenting signup we store `gdpr_consent_at` and
`gdpr_consent_version`. `birth_year`, `age_verified=true`, and the consent
fields are written only when both the age gate and the consent check pass.

**Rationale:**
- Server-side enforcement matches the locked "limits enforced server-side;
  client is a hint only" mandate.
- Birth-year-only minimises the personal data collected and retained,
  compared to a full date of birth.
- Versioned consent (`gdpr_consent_version`) enables forcing re-consent later
  if the consent text changes.

**Consequences:**
- Enables: a compliant launch posture for COPPA and GDPR from the very first
  signup.
- Requires: signup to route through a server handler — never a raw
  client-side `signUp` call — so the age gate and consent check cannot be
  bypassed.
- Sets up: `gdpr_consent_version` as the trigger for forced re-consent in
  later sprints.
- Forecloses: any later processing endpoint skipping the non-null
  `gdpr_consent_at` check — they must assert it server-side.
