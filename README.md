# Calyxa

**A patient AI math tutor for any web page.** Calyxa is a Chromium extension that
sits alongside sites like Khan Academy and guides students through problems step
by step — asking questions, pointing at what matters on screen, and adapting to
what the student actually understands — instead of just handing over the answer.

- Website: [calyxa.app](https://calyxa.app)
- Extension: Chrome / Edge / Brave (Manifest V3)
- Status: **beta**, extension version `0.1.4`

> **This repository is source-available, not open source.** The code is public so
> it can be read, studied, and security-reviewed. It is **not** licensed for
> reuse, redistribution, deployment, or commercial use, and the prompts and
> curriculum data are explicitly not licensed for reuse in other software or as
> training data. See [LICENSE](LICENSE).

---

## How it works

1. A content script reads the current page — text, LaTeX, and equations — and
   **never mutates the host page's DOM**. All UI lives in a shadow-DOM overlay.
2. A background service worker relays that context to the Next.js backend.
3. The backend builds a system prompt from the student's mastery profile and the
   page context, and calls the model through a **forced-tool envelope** so every
   turn returns structured output (what to say, what to annotate, what signals
   the turn produced) rather than free text.
4. Responses drive the overlay: a morphing pill, spoken or typed replies,
   non-destructive annotations drawn over the page, and answer chips.
5. Each turn updates a per-concept mastery model with spaced-repetition decay,
   which feeds the post-login dashboard and generated study materials.

**No API key ever reaches the extension bundle.** Every model, STT, and TTS call
is proxied server-side; a CI job (`scripts/check-no-secrets.mjs`) greps the
*built* extension artifact for real key values on every push to prove it.

## Repository layout

```
extension/    WXT + React + TypeScript Chrome extension (MV3)
web/          Next.js app — marketing site, auth, dashboard, and all API routes
packages/     Shared workspaces:
                curriculum/       concept graph (algebra 1/2, geometry, calculus…)
                learning-model/   mastery, decay, and reinforcement scheduling
                ui/              design tokens + shared primitives
supabase/     29 SQL migrations + RLS policies
docs/         Architecture, 57 ADRs, and sprint plans
scripts/      CI guards (no-secret-in-bundle)
```

`docs/` is the real history of the project: every significant decision is written
up as a numbered ADR in [`docs/adr/`](docs/adr), and
[`docs/architecture.md`](docs/architecture.md) is the best single entry point.

## Stack

| Layer     | Choice                                                    |
| --------- | --------------------------------------------------------- |
| Extension | WXT + React + TypeScript, Manifest V3, shadow-DOM overlay  |
| Backend   | Next.js App Router API routes, deployed on Vercel          |
| Data      | Supabase — Postgres + Auth, RLS on every table             |
| Tutor     | OpenAI GPT-4o-mini (default); Anthropic Claude Haiku retained as an env-flag backup (ADR-052) |
| Voice     | OpenAI Whisper (STT) + ElevenLabs (TTS), both server-proxied |
| Billing   | Stripe Checkout + idempotent webhooks (ADR-050/051)        |
| Tooling   | Turborepo, Vitest, ESLint, Prettier, GitHub Actions        |

## Running it locally

Requires **Node 22+** (Node 24 matches CI and production). The live-integration
tests hit a real Supabase project and spend real provider budget, so point them
at a *dedicated test project*, never production.

```bash
npm ci
```

Copy the env template and fill it in — every variable is documented inline,
including which are server-only and must never be prefixed `NEXT_PUBLIC_`:

```bash
cp web/.env.local.example web/.env.local
```

Run the web app:

```bash
npm run dev
```

Build the extension, then load `extension/dist/chrome-mv3` unpacked in Chrome
(`chrome://extensions` → Developer mode → Load unpacked):

```bash
npm --prefix extension run build
```

> `dist/chrome-mv3` is a frozen production snapshot and does **not** hot-reload.
> Re-run the build after any extension source change. Use `wxt dev` if you want
> the auto-updating `dist/chrome-mv3-dev` build instead.

Run the full gate (what CI runs):

```bash
npx turbo run typecheck lint build test
```

## Security

Security is enforced by design and by CI, not by convention:

- **RLS on every table** before it receives data; bookkeeping tables are deny-all.
- **All secrets are server-side only.** The extension holds no credential; the
  no-secret-in-bundle CI job proves it against the built artifact.
- **Session audio is never persisted** — real-time STT streaming only.
- **Page URLs are stored as salted HMAC hashes**, never plaintext domains.
- Free-tier limits are enforced server-side; the client value is a display hint
  and never an authorization.

A full audit lives in
[`docs/security-review-sprint18.md`](docs/security-review-sprint18.md), and the
data actually collected is enumerated in
[`docs/data-safety-disclosure.md`](docs/data-safety-disclosure.md).

**Found a vulnerability?** Please email **support@calyxa.app** rather than
opening a public issue.

## Contributing

This repository is published for transparency, not as a community project. It
does not accept unsolicited contributions, and pull requests may be closed
without review. Bug reports and security disclosures are welcome by email.

## License

Copyright (c) 2026 Darcy Wang. All rights reserved.
Source-available under the terms in [LICENSE](LICENSE) — viewing and study are
permitted; reuse, redistribution, and deployment are not.
