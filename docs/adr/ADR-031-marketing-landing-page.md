## ADR-031: Marketing landing page — Cluely structure in Calyxa's skin, a demo recreation that never imports the extension, a server-write-only waitlist, and the study-loop marketing-ahead-of-product call

**Status:** Decided

**Context:** Through Sprint 19, `/web/app/page.tsx` is a placeholder (`<h1>Calyxa</h1>`
plus links to `/signup` and `/login`) — nothing public shows what Sprints 01–14 built:
the shadow-DOM overlay with color-linked annotations (ADR-022/029), profile
visibility (overview/tags/recap with trends, ADR-024/025/026), problem-sized
auto-managed sessions with a solution-progress bar (ADR-027/028/030), and the
sub-2.5s voice pipeline (ADR-010). Darcy asked for a landing page structurally
similar to Cluely's (product demo front and center, large type, scroll-driven
feature reveals) that showcases the tutoring session, the adaptive profile, and
a "study loop" of notes/practice problems/flashcards generated per session —
the last of which does not exist as a product feature (`/docs/PLAN.md` scopes
study artifacts post-V1; Sprint 15 covers only the mastery dashboard). This ADR
records the decisions needed to build that page without silently drifting from
either the brand system (ADR-018, `/docs/brand.md`) or the product's actual
scope, and without the marketing surface becoming a second, divergent
implementation of the overlay.

**Decision:**
1. **Cluely's structure, Calyxa's skin.** The page borrows Cluely's layout DNA —
   full-bleed hero with the product demo center stage, large display type,
   scroll-driven feature reveals — but renders entirely in the existing light
   `@calyxa/ui` palette and the brand's plain-spoken, Socratic voice
   (`/docs/brand.md`: no "unlock/supercharge," no exclamation-point
   enthusiasm). The dark-mode token shell (declared, unwired since ADR-018)
   stays unwired; there is no dark hero.
2. **The demo is a recreation, never an import.** Marketing demo components
   live under `/web/components/marketing/demo/` and visually recreate the
   overlay (panel chrome, transcript bubbles, profile tags, the insight strip,
   pings, annotation boxes, the solution-progress bar, the voice waveform)
   using `@calyxa/ui` tokens. They **never** import from `/extension` — the
   real components carry WXT bundling, shadow-DOM injection, and live
   background-worker/content-script state that has no meaning inside a
   server-rendered Next.js page, and the demo needs scripted, loopable
   determinism rather than real session state. Visual fidelity is enforced by
   a side-by-side eyeball against a real dev build, not by sharing code.
3. **`motion` (framer-motion) is added to `/web`, scoped to marketing
   surfaces only.** Product surfaces (dashboard, account, the overlay) keep
   ADR-018's token-only CSS-transition discipline unchanged. Only
   `/web/components/marketing/**` may import `motion`, for scroll-driven
   scrubbing and entrance choreography that CSS transitions alone cannot
   express. Every marketing animation must honor `prefers-reduced-motion`,
   with the reduced-motion fallback rendering the scene's final composed
   frame — never a slower version of the same motion.
4. **The study loop is marketed as live.** Darcy's explicit call: the page
   presents study notes, practice problems, and flashcards generated per
   session as a shipped feature, with no "coming soon" qualifier in the copy —
   even though `/docs/PLAN.md` still scopes artifact generation post-V1 and no
   sprint has built it. This is a deliberate marketing-ahead-of-product
   decision, not an oversight, and it creates a fuse: **before the waitlist
   converts to beta invitations, either artifact generation ships as a real
   feature, or this section's copy gains a qualifier.** The debt is recorded
   here and repeated in the Sprint 20 plan's risks and handoff so no later
   sprint can miss it.
5. **The waitlist is its own table, written only by the server.** A new
   `waitlist` table gets RLS **enabled with zero policies** — deny-all to the
   `anon`/`authenticated` roles; only a service-role client inside
   `POST /api/waitlist` may write. This is the RLS-before-data rule
   (`/CLAUDE.md`) applied as a deny-all rather than a scoped policy, since
   nothing should ever read this table from the client. Duplicate emails and
   a filled honeypot both return the same idempotent success response — the
   endpoint never confirms or denies whether a given email already exists.
6. **The waitlist, not account signup, is the page's promoted action.**
   `/signup` and `/login` remain reachable (footer and nav as plain text
   links) and untouched by this work, but the landing page's only call to
   action is joining the waitlist. This sprint changes no auth behavior.

**Rationale:**
- Borrowing Cluely's structure while keeping Calyxa's palette and voice gets
  the "stunning, product-forward" layout Darcy asked for without contradicting
  `/docs/brand.md`'s explicit stance against SaaS-hype visual language — the
  two are separable (layout DNA vs. skin), and separating them is cheaper than
  either re-litigating brand.md or building an off-brand page.
- A recreation instead of a shared import keeps the overlay's real constraints
  (shadow-DOM injection, WXT bundling, live runtime state) out of a page that
  needs the opposite: deterministic, loopable, server-renderable UI. Sharing
  components across those two environments would mean designing the real
  overlay around marketing's needs, or forking it quietly — both worse than an
  explicit, tokens-shared recreation checked by eyeball.
- Scoping `motion` to marketing avoids relitigating ADR-018's CSS-only motion
  discipline for the entire web app over a landing-page-specific need; product
  surfaces keep their existing, already-audited motion contract untouched.
- Marketing the study loop as live is Darcy's call, made with the tradeoff
  named explicitly rather than discovered later: a landing page that hedges
  every unbuilt feature reads weaker, but an unhedged claim with no recorded
  deadline is how marketing debt becomes silent product debt. Recording the
  fuse here is what keeps it a decision instead of a surprise.
- A deny-all RLS table for a public-write endpoint is simpler and safer than a
  scoped INSERT policy: there is no legitimate client-side read of this table,
  so there is no policy to get subtly wrong. The service-role write path is the
  same reviewed pattern already used by `/api/auth/signup`.

**Consequences:**
- Enables: a landing page that can be built and reviewed against a named,
  bounded set of decisions instead of ad hoc calls made mid-sprint; a demo that
  can evolve its script (copy, beats, timing) as pure data in `scripts.ts`
  without touching the real overlay; a waitlist funnel with source-tagged
  conversion tracking before any beta-invite tooling exists.
- Requires: every future marketing component to stay under
  `/web/components/marketing/` and out of `/extension`; any new marketing
  color to already exist as an `@calyxa/ui` token (no new palette values, same
  ADR-018 discipline); the Task 4 and Task 11 side-by-side fidelity checks
  against a real dev build to be run, not skipped, since nothing else enforces
  that the recreation stays honest; a decision — before waitlist invites go
  out — on shipping real artifact generation or softening the study-loop copy.
- Forecloses: importing `/extension` components into `/web` for any reason;
  `motion` usage outside the marketing tree without a new ADR entry; any
  client-side Supabase read of the `waitlist` table; treating the study-loop
  section's "live" framing as settled product scope rather than a named,
  fused liability.
