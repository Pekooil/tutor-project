# Chrome Web Store data-safety disclosure — source of truth

This is the exact source Darcy transcribes into the Chrome Web Store **Privacy
practices** tab when submitting Calyxa (Sprint 19, Task 7). It maps **1:1** to what the
product actually collects (Sprints 03/16/17), and to the human-readable
[`/privacy`](../web/app/privacy/page.tsx) page. See **ADR-046**.

> **Load-bearing rule:** if a future sprint changes what is collected (Sprint 21
> study-materials artifacts, Sprint 23 billing/Stripe customer data), this doc **and**
> `/privacy` **and** the live CWS form must all be updated **before** it ships to beta
> users. Nothing here may be declared that isn't collected; nothing collected may be
> omitted.

---

## The actual collection surface (verified against the schema)

Every row is a real table/column, cross-checked for this disclosure — not recalled.

| Data | Where it lives | Notes |
|---|---|---|
| Email + password | Supabase Auth; `waitlist.email` (pre-signup) | Auth-managed; raw password not stored by us |
| Birth year + `age_verified` | `users.birth_year` | Year only (not full DOB), for the age gate |
| GDPR consent stamp | `users.gdpr_consent_at`, `gdpr_consent_version` | Timestamp + version of consent given |
| Learning profile | `knowledge_nodes`, `misconceptions`, `reinforcement_schedule` | Mastery/misconceptions/review schedule — derived from your interactions |
| Session transcripts (**text only**) | `session_interactions` | Student turns + tutor replies. **No audio** (ADR-011) |
| Hashed page identifier | `sessions.page_url_hash` | HMAC-SHA256(domain, server-only salt). **Not the URL, not the title, not the contents; one-way** (ADR-036) |
| Product telemetry | `telemetry_event` | Closed **typed** union — counts/timings/kinds only. **No free text, no transcript, no URL, no audio** (ADR-043) |
| Feedback | `feedback` | The one user-authored free-text field, submitted on purpose (ADR-039) |
| _(operational, not user-identity data)_ | `cost_ledger` (day-keyed), `waitlist` invite columns | Anonymous; deny-all; not tied to a user |

**Never collected:** microphone audio (real-time STT only, discarded — ADR-011); page
URLs/titles/contents (only the one-way domain hash); any AI/STT/TTS key in the extension
(server-side only — ADR-044).

---

## CWS "Data collection and use" — per data type

For each Chrome Web Store data-type category: whether Calyxa collects it, the
**purpose(s)**, and the mapping. (CWS purpose vocabulary: *App functionality*,
*Analytics*, *Developer communications*, *Personalization*, *Account management*,
*Fraud prevention, security, and compliance*. Calyxa uses **no** *Advertising or
marketing* purpose.)

| CWS data type | Collected? | Maps to | Purposes |
|---|---|---|---|
| **Personally identifiable information** | **Yes** | Email; birth **year** (age) | Account management; App functionality; Security & compliance (age gate) |
| **Authentication information** | **Yes** | Email + password (via Supabase Auth) | Account management; Security |
| Health information | No | — | — |
| Financial and payment information | No | — (beta is free; no billing until Sprint 23) | — |
| **Personal communications** | **Disclose: Yes** | Session transcripts + feedback are user-entered text | App functionality; Personalization; Developer communications (feedback) |
| Location | No | We do **not** collect GPS/region/IP-as-location | — |
| **Web history** | **Disclose: Yes (minimal)** | The **hashed** page-domain identifier only | App functionality (session continuity) — see caveat below |
| **User activity** | **Yes** | Learning-profile signals + typed telemetry | App functionality; Personalization; **Analytics** (telemetry) |
| **Website content** | **Yes** | The math problem text / conversation content the user works through | App functionality; Personalization |

**Caveats to record verbatim where the form allows a note (or keep on hand for review
questions):**
- **"Web history" is a one-way hash of the domain**, not a browsing history: we store
  `HMAC-SHA256(domain)` for session continuity and **cannot recover** the site, URL, or
  page from it. Disclosed under Web history out of caution, not because we keep a
  browsing log.
- **"Personal communications / Website content" is the tutoring conversation** (the
  student's typed/dictated math turns and the tutor's replies) — **text only, audio is
  never stored.**
- **Telemetry carries no content** — it is a closed typed set of counts and timings; it
  cannot hold a transcript, question, or URL.

---

## CWS required certifications (the three checkboxes)

1. **"I do not sell or transfer user data to third parties, outside of the approved use
   cases."** → **True.** We do not sell data. The AI/STT/TTS/database/hosting providers
   are **processors** acting on our behalf (an approved use case), not independent
   recipients.
2. **"I do not use or transfer user data for purposes unrelated to my item's single
   purpose."** → **True.** Single purpose: an AI math tutor. All data serves the tutor,
   its personalization, beta analytics, or support.
3. **"I do not use or transfer user data to determine creditworthiness or for lending
   purposes."** → **True.**

---

## CWS other required fields

- **Privacy policy URL:** `https://calyxa.app/privacy`
  (public, no auth — verified in `web/proxy.ts`).
- **Data encrypted in transit:** **Yes** — all traffic to our server (Vercel) and
  database (Supabase) is over HTTPS/TLS.
- **Users can request that data be deleted:** **Yes** — from account settings, users can
  **export** all their data (JSON) and **permanently delete** their account and all
  associated data (two-phase erasure with a grace window; ADR-035). Mechanism:
  `/account` → "Export my data" / "Delete account".

---

## Providers named as processors (for the privacy page + any review question)

| Provider | Role | Receives |
|---|---|---|
| Anthropic | AI tutoring replies | Session **text**; never audio |
| OpenAI | Real-time speech-to-text | Audio in the moment; **no recording retained** |
| ElevenLabs | Text-to-speech | The tutor's reply text to speak |
| Supabase | Database + authentication | Account + learning profile (at rest) |
| Vercel | Hosting (site + server) | Request traffic |

No provider receives audio at rest, and **no provider key is ever in the extension
bundle** (ADR-044).
