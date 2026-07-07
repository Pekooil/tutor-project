# Sprint 20 — Marketing landing page: the extension, on stage

## Goal
Ship the public marketing landing page at `/` — the page a student (or a
skeptical parent) hits before Calyxa exists in their browser. The structural
reference is Cluely's landing page (product demo front and center, huge type,
scroll-driven feature reveals); the skin, voice, and motion discipline are
Calyxa's own (`/docs/brand.md`: light, green, plain-spoken, no SaaS hype). By
the end:

1. **The extension is the hero.** A live, scripted, in-page recreation of the
   overlay runs on a fake math page in the hero: the tutor's bubbles stream in,
   **on-screen annotations** draw around the equation (color-linked to the
   exact phrase in the bubble), the **solution progress bar** creeps up in the
   composer, a **ping** fires on a breakthrough, **profile tags** appear on the
   tutor's bubbles, and the composer's **voice waveform** pulses while the
   tutor "speaks." No video, no screenshots — real DOM, deterministic
   timeline, loops while in view.
2. **A scrollytelling feature section** steps through the same session
   beat-by-beat — annotations, progress bar, pings + tags, live voice — with
   the demo stage pinned and advancing as the copy scrolls.
3. **"It learns how you learn"** — a section showing the profile adapting
   after the session: mastery bars moving with delta arrows, a recap strip
   with a resolved misconception and a trend rollup, a spaced-repetition
   forward look ("Factoring quadratics comes back Thursday"), and a
   cross-session callback.
4. **"Every session closes the loop"** — a section showing a finished session
   fanning out into **study notes, practice problems, and flashcards**.
   (Darcy's call, recorded in ADR-031: marketed as live even though artifact
   generation is post-V1 product work — see Risks and the handoff section.)
5. **A waitlist**, not signup: email capture in the hero and the final CTA,
   stored in a new RLS-locked `waitlist` table via `POST /api/waitlist`.
6. Supporting sections: **how it works** (3 steps), **pricing** (Free 10
   sessions/mo vs Pro $12/mo per `/docs/PLAN.md` §2.8), **social proof
   placeholder** (structure now, quotes at launch), final CTA, footer. No FAQ
   this sprint (Darcy's call).

```
/  (landing)
├─ Nav          logo · How it works · Pricing · [Join the waitlist]
├─ Hero         headline + waitlist form  |  DemoStage: full session loop
├─ Session      pinned DemoStage, 4 scroll beats:
│                 annotations → progress bar → pings + tags → voice
├─ Profile      mastery deltas · recap · trend rollup · callback · schedule
├─ Study loop   session card → notes · practice problems · flashcards
├─ How it works install → open any math page → start talking
├─ Pricing      Free (10 sessions/mo) vs Pro ($12/mo)
├─ Social proof placeholder quote cards (flagged, filled at launch)
├─ Final CTA    waitlist form again
└─ Footer       logo · links · legal
```

## Context
`/web/app/page.tsx` is a placeholder (`<h1>Calyxa</h1>` + two links). Sprints
01–14 built everything the page needs to show: the shadow-DOM overlay with
TitleBar/Composer/InsightStrip/Transcript/PingToasts (Sprint 14 decomposition),
the annotation layer with color-linking (ADR-022/029), the profile surfaces —
overview, tags, pings, recap with trends (ADR-024/025/026), problem-sized
auto-managed sessions with the solution progress bar (ADR-027/028/030), and
the sub-2.5s voice pipeline (ADR-010). None of it is visible to anyone who
hasn't installed a dev build. This sprint is the shop window.

Sprint numbering: 15–19 are reserved for the product roadmap already in flight
(voice latency + curriculum, cost/compliance, hardening/store). The marketing
site is deliberately parallel-track work — it shares no files with any of
those sprints except `web/package.json`.

### Decisions locked for this sprint (recorded in ADR-031)
1. **Cluely structure, Calyxa skin.** Full-bleed hero, product demo center
   stage, big display type, scroll-driven reveals — rendered entirely in the
   light `@calyxa/ui` palette and brand voice. The dark-mode token shell stays
   unfilled; no dark hero. Copy follows brand.md §voice: Socratic warmth, no
   "unlock/supercharge," no exclamation-point enthusiasm.
2. **The demo is a recreation, never an import.** Marketing demo components
   live in `/web/components/marketing/demo/` and visually recreate the overlay
   (panel chrome, bubbles, tags, strip, pings, annotation boxes, progress bar,
   waveform) using `@calyxa/ui` tokens. They never import from `/extension`
   — the real components carry WXT/shadow-DOM/runtime assumptions that don't
   belong in a Next.js page, and the demo needs scripted determinism, not real
   state. Visual fidelity is checked by eyeball against the real overlay, not
   by code sharing.
3. **`motion` (framer-motion v12) is added to `/web`, marketing surfaces
   only.** Product surfaces (dashboard, account, overlay) keep the ADR-018
   token-only CSS motion rules. Marketing pages may orchestrate entrances,
   scroll progress, and demo timelines with `motion`; every animation must
   honor `prefers-reduced-motion` — the demo's reduced-motion fallback is a
   fully-composed static end-state frame, not a slower animation.
4. **The study loop is marketed as live** (Darcy's explicit call). The page
   presents notes / practice problems / flashcards as product features with no
   "coming soon" qualifier, while `/docs/PLAN.md` still scopes artifact
   generation post-V1. This is a deliberate marketing-leads-product decision;
   the mismatch and its deadline are flagged loudly in Risks and the handoff.
5. **Waitlist is its own table, server-write-only.** New `waitlist` table
   with RLS enabled and **zero policies** — only the service-role client
   (server-side, `POST /api/waitlist`) can write; nothing can read from the
   client. Follows the RLS-before-data rule. Duplicate emails are idempotent
   200s, never errors leaking existence.
6. **The existing `/signup` and `/login` flows stay reachable but
   de-emphasized** (footer + nav "Log in" text link). The waitlist is the
   page's only promoted action; nothing this sprint changes auth.

### The demo engine is one timeline, three scenes (read before Tasks 4–8)
Every animated section runs off the same primitive: a **scene script** — an
ordered list of `{ at, action }` steps (typed union: `bubble`, `annotate`,
`progress`, `ping`, `tag`, `strip`, `waveform`, `masteryDelta`, `artifact`)
— played by one `useSceneTimeline` hook (rAF-driven, in-view gated via
IntersectionObserver, loops with a beat of rest, pauses off-screen, renders
the final frame statically under reduced motion, and can be **scrubbed** by
scroll progress instead of the clock for the scrollytelling section). Three
scripts, one player: the hero's full session loop (Task 5), the pinned
beat-by-beat session walkthrough (Task 6), and the profile/study-loop scenes
(Tasks 7–8). Scripts are pure data and the player's step-reducer is a pure
function — both unit-testable without a browser (Task 10).

The fake math page inside the DemoStage works the factoring fixture the repo
already uses everywhere (**x² + 5x + 6**) so the demo's annotations, tags
(`known-gap: sign errors`, `callback: factoring work from last week`), ping
("Gap closed: sign errors"), and recap deltas all read as one coherent
session — the same session, seen from four angles across the page.

### Copy is a deliverable, not a placeholder (read before Tasks 5–9)
Draft copy ships with each section and follows brand voice. Working draft
(tune at the gate, in-file):
- Hero H1: **"The math tutor that lives on your screen."**
- Hero sub: "Calyxa sees the problem you're stuck on, talks you through it
  out loud, and points at the exact step you're missing — without ever just
  giving you the answer."
- Section 2 kicker: "It learns how you learn." Sub: "Every session updates
  your study profile — what you've mastered, where you slip, and when a
  concept needs to come back."
- Section 3 kicker: "One session in. A study kit out." Sub: "Notes, practice
  problems, and flashcards from every session, built from the exact steps you
  worked through."
- Pricing: Free — "10 tutoring sessions a month." Pro $12/mo — "Unlimited
  sessions. Everything Calyxa learns about you, working for you."
Banned-word check (leverage/unlock/supercharge/revolutionary) is part of the
Task 11 acceptance pass.

## Execution model
A **single code session** owns this sprint end to end, worked **strictly in
order (1 → 11)**. The chain: ADR + pointers (Task 1) first; the waitlist
backend (Task 2) is independent and lands early so the form has a real
endpoint from the first hero build; the marketing shell (Task 3) establishes
nav/footer/section scaffolding and the `motion` dependency; the demo engine +
overlay recreation kit (Task 4) must exist before any scene (Tasks 5–8); the
static sections (Task 9) close the page; tests (Task 10) gate manual
acceptance (Task 11). One session — no handoff.

This sprint touches: `/web/app/page.tsx`, `/web/app/layout.tsx` (metadata
only), new `/web/components/marketing/**`, new `/web/app/api/waitlist/
route.ts`, `/web/package.json` (one dependency), one new Supabase migration,
and docs. It does **not** touch `/extension/**`, `/web/lib/{ai,learning}/**`,
`/web/app/api/{ai,auth,voice,session,profile}/**`, `/packages/**` (theme.css
is consumed, not edited), or the dashboard/account pages.

## Files in scope

### Task 1 (ADR + sprint pointers) creates / edits:
```
/docs/adr/ADR-031-marketing-landing-page.md ← new — records the six locked decisions above: Cluely-structure/Calyxa-skin, recreation-not-import, motion scoped to marketing, study-loop-marketed-as-live (with the product-debt flag and its resolve-before-invites deadline), the server-write-only waitlist table, and waitlist-over-signup as the promoted action.
/CLAUDE.md                                   ← edit one line: Current sprint → Sprint 20 — Marketing landing page
/docs/CLAUDE.md                              ← edit one line: Current phase → Phase 2, Sprint 20 (parallel marketing track)
/docs/sprint-20-plan.md                      ← this file
/docs/architecture.md                        ← edit: add a short "Marketing site" section — the landing page, the demo-recreation boundary (never imports /extension), and the waitlist table/route
```

### Task 2 (waitlist backend) creates:
```
/supabase/migrations/0012_waitlist.sql   ← new — waitlist(id uuid pk default gen_random_uuid(), email citext not null, source text, created_at timestamptz not null default now()); unique index on email (case-insensitive via citext, already enabled by 0001); RLS ENABLED with NO policies (service-role writes only — the RLS-before-data rule, enforced as deny-all — Shape 3 in /supabase/policies/README.md, added this task).
/web/app/api/waitlist/route.ts           ← new — POST { email, source? }: trim/lowercase, format-validate, reject a filled honeypot field with a 200 (silent), insert via the service-role client (upsert + onConflict/ignoreDuplicates); duplicate → 200 { ok: true } (idempotent, never leaks existence); malformed → 400; no GET.
/web/lib/supabase/admin.ts               ← ALREADY EXISTED (createAdminClient, server-only) — reused as-is, no edit needed.
```

**Addendum (found during Task 2 verification):** `web/proxy.ts` gates every
non-`PUBLIC_PATHS` route behind cookie auth, with an explicit allowlist of
bearer-only API prefixes that skip the check (`/api/auth`, `/api/session`,
`/api/ai`, `/api/voice`, `/api/profile`). `/api/waitlist` was not on that
list, so a signed-out visitor's request was silently 307-redirected to
`/login` before ever reaching the route — caught by curling the real running
route, not just the raw migration. Fixed by adding
`pathname.startsWith('/api/waitlist')` to `isPublicPath`, matching the
existing pattern exactly (it's public like `/`, not a bearer-auth exemption
like the others). This file was not in Task 2's original scope; it is now.

### Task 3 (marketing foundation) creates / edits:
```
/web/package.json                             ← edit — add `motion` (framer-motion v12). The only dependency this sprint adds.
/web/app/page.tsx                             ← rewrite — the landing page: composes Nav, Hero, SessionShowcase, ProfileSection, StudyLoopSection, HowItWorks, Pricing, SocialProof, FinalCta, Footer. Server component shell; interactive pieces are client leaves.
/web/components/marketing/Nav.tsx             ← new — sticky, translucent-on-scroll; logo, anchor links (How it works, Pricing), "Log in" text link, waitlist CTA button.
/web/components/marketing/Footer.tsx          ← new — logo, product/legal link groups, "Log in", copyright.
/web/components/marketing/Section.tsx         ← new — section scaffold: max-width container, kicker/heading/sub pattern, display type sizes (marketing-only Tailwind classes on top of the token scale — no theme.css edits).
/web/components/marketing/Reveal.tsx          ← new — the one entrance primitive (motion.div in-view fade/rise, stagger support, prefers-reduced-motion → render-visible no-op). Every section uses this; no bespoke entrance code per section.
/web/components/marketing/WaitlistForm.tsx    ← new — email input + submit + honeypot field; pending/success/error states inline ("You're on the list."); posts to /api/waitlist with a source tag ('hero' | 'footer'); used in Hero and FinalCta.
```

### Task 4 (demo engine + overlay recreation kit) creates:
```
/web/components/marketing/demo/scene.ts             ← new — SceneStep/SceneScript types (the typed action union) + the pure step-reducer (elapsed time or scrub progress → visible state). No React, no DOM: unit-testable.
/web/components/marketing/demo/useSceneTimeline.ts  ← new — the player hook: rAF clock OR external scroll-progress scrub; IntersectionObserver in-view gating; loop-with-rest; reduced-motion → jump to final state.
/web/components/marketing/demo/DemoStage.tsx        ← new — the framed fake browser window: chrome (traffic lights + address bar), the fake math page (worksheet card with the x² + 5x + 6 problem rendered as styled HTML — no KaTeX dependency for the landing page), and the overlay panel positioned over it.
/web/components/marketing/demo/DemoPanel.tsx        ← new — the overlay recreation: title bar (logomark, −/✕), transcript with streaming-in tutor/student bubbles + profile-tag pills + color-linked phrase spans, the InsightStrip slot (overview/recap variants), composer with text field, ↵ send icon, mic + waveform bars, and the thin solution-progress bar. Visual fidelity checked against the real overlay side-by-side.
/web/components/marketing/demo/DemoAnnotations.tsx  ← new — absolutely-positioned SVG layer over the fake page: outlined rounded-rect boxes (the ADR-029 primary vocabulary) + short labels with leader lines, stroke colors from the annotation palette aliases, draw-in animation (pathLength), each color matching its linked phrase span in the transcript.
/web/components/marketing/demo/DemoPing.tsx         ← new — the frosted-glass sage toast ("Gap closed: sign errors"), enter/exit per script.
/web/components/marketing/demo/scripts.ts           ← new — the three scene scripts as pure data: heroSession (full ~18s loop: opening scan line → annotation draws → student turn → progress bump → tag → wrong step, bar eases back → ping → solve, bar fills → "Now closing tutoring session." → recap strip → loop), sessionBeats (the same session cut into 4 scrub-addressable beats), profileScene + studyLoopScene (Tasks 7–8 consume).
```

**Addendum (Task 4, as built).** Three product-truth adjustments against this
list, all in the direction of fidelity: (1) annotation labels render as
adjacent solid pills exactly like the real `AnnotationLayer.tsx` LabelPill —
no leader lines (those are the extension's collision-pass special case, and
demo scripts are hand-placed to never collide); (2) the annotation palette
mirrors the product's real amber/blue/green/red (`Overlay.css`'s own
documented extension-local exception — amber/blue are not @calyxa/ui
tokens); (3) the overlay's decorative hairline (`--color-border`, #e5e3de)
is unreachable by name inside /web (globals.css re-targets that name to
border-strong for shadcn), so the demo scopes the product value as
`--cx-demo-hairline` on the stage root — same exception pattern, never used
outside the demo tree. `scene.test.ts` was written in this task per the
gate (18 cases; Task 10 formalizes). Verified by scrubbing three frames
(mid-conversation, ping, final/reduced-motion) against the real overlay;
clock-mode looping could not be exercised in the preview harness (the tab
runs permanently hidden — rAF and IntersectionObserver never fire there)
and is a named Task 11 manual-acceptance item.

### Task 5 (hero) creates:
```
/web/components/marketing/Hero.tsx ← new — full-bleed hero: H1 + sub + WaitlistForm('hero') + trust line ("Free for 10 sessions a month · Chrome"), with DemoStage playing the heroSession script beside/beneath (stacks on mobile, demo below the fold-line text so LCP is the H1).
```

### Task 6 (session scrollytelling) creates:
```
/web/components/marketing/SessionShowcase.tsx ← new — the pinned-stage section: DemoStage sticky in one column, four copy beats scrolling past in the other; scroll progress (motion useScroll) scrubs the sessionBeats script. Beats: 1) "It points at the problem" (annotations + color-linking), 2) "You see yourself getting closer" (solution progress bar, easing back on a wrong step), 3) "It knows what you're working on" (profile tags + the ping), 4) "Talk it through out loud" (waveform + a spoken-reply caption, "replies in under 2.5 seconds"). Mobile: the pin degrades to stacked beat cards, each with its own static frame.
```

**Addendum (Task 6, as built).** The stacked mobile/reduced-motion beat
cards need a per-beat STATIC frame, but `useSceneTimeline`'s reduced-motion
contract deliberately overrides scrub to the script-end frame — so all four
cards would have rendered the same frame, failing this task's gate
("reduced-motion shows all four final frames"). Fix in the direction of the
gate: `useSceneTimeline` gains a `frameMs` option and `DemoStage` forwards
it as a prop — a fixed frame is already motionless, so it takes priority
over the clock, the scrub, AND the reduced-motion override; the pinned
scrub path is unchanged (scroll-linked scrubbing still collapses to the end
frame under reduced motion). Two Task 4 files edited
(`demo/useSceneTimeline.ts`, `demo/DemoStage.tsx`), no new files. Desktop
reduced-motion renders the stacked-cards variant (four beat frames), not a
frozen pin. Note for Task 11's honesty check: beat 4's plan-dictated
spoken-reply caption ("replies in under 2.5 seconds") is Sprint 15's
p50 budget, not today's measured latency (Sprint 06 recorded ~3.1s) — same
marketing-leads-product class as the ADR-031 study-loop flag, resolved by
Sprint 15 shipping before invites.

### Task 7 (profile adaptation section) creates:
```
/web/components/marketing/ProfileSection.tsx ← new — "It learns how you learn": a two-panel before/after driven by profileScene — left, the pre-session overview (mastery bars, a weak spot, a due-for-review item); right, the post-session recap (bars animating up with delta arrows, "Gap closed: sign errors", trend rollup "3 sessions in a row improving", forward look "Factoring quadratics comes back Thursday"); beneath, a callback quote bubble ("this connects to the factoring work from a few sessions ago") illustrating cross-session memory.
```

**Addendum (Task 7, as built).** This section deliberately does NOT play
profileScene through `useSceneTimeline` like Tasks 5–6. That hook's clock
mode is built to loop (hero) or scrub (showcase); this task's own gate says
the opposite — "bars animate once on first in-view (not every scroll-past)."
Reusing the loop would replay the before→after motion forever while the
section stays on screen, and adding a "play once, then hold" mode to the
shared engine was out of this task's file scope (`ProfileSection.tsx` only).
So `ProfileSection.tsx` hand-rolls a local one-shot driver — `motion`'s
`useInView(once: true)` gates a rAF clock that runs 0→`profileScene.durationMs`
once and stops — while still calling the shared, pure `reduceScene` to turn
that local clock into state, same discipline as SessionShowcase hand-rolling
its own scroll-scrub source instead of extending the engine for one script.
Reduced motion renders the end frame immediately (`t = durationMs`), same
contract as everywhere else. The pre-session weak-spot/due-review copy isn't
in profileScene (only heroSession's overview strip carries it) — mirrored
verbatim from there so the two sections agree on one snapshot; this is
section-local copy, same precedent as SessionShowcase's own `BEATS` copy
living outside `scripts.ts`. Verified: typecheck/lint green; curled the
running dev server's SSR output for `#profile` and confirmed both panels
render with the correct starting widths (45/72/88%) and the callback quote,
trend, and forward-look text all present, no server errors. Live in-view
trigger and reduced-motion behavior were not exercised in a real browser this
session — the project's dev server was already running externally (a
pre-existing process on port 3000) rather than one this session started, so
it wasn't restarted to avoid disrupting whatever else was using it; this is
a Task 11 manual-acceptance item, same class as Task 4/6's noted preview-
harness gaps.

### Task 8 (study loop + how it works) creates:
```
/web/components/marketing/StudyLoopSection.tsx ← new — "One session in. A study kit out.": a finished-session card fanning out (studyLoopScene) into three artifact cards — study notes (titled outline with the session's actual steps), practice problems (two fresh factoring variants), flashcards (a flip-on-hover card, "What two numbers multiply to 6 and add to 5?") — closing with the loop line: session → profile → study kit → next session.
/web/components/marketing/HowItWorks.tsx       ← new — three numbered steps: Add Calyxa to Chrome → Open any math page → Start talking. One icon + line each; installs the mental model before pricing.
```

**Addendum (Task 8, as built).** `StudyLoopSection.tsx` fans out a static
session-summary card ("Session complete — Factoring quadratics · x² + 5x + 6
= 0 · Gap closed: sign errors") into three artifact cards gated by
`studyLoopScene`'s `artifacts` array (notes → problems → flashcards, at
300/800/1300ms). Same deviation as Task 7 and for the same reason: the gate
wants the fan-out to play ONCE on first in-view, not loop or scrub, so this
hand-rolls the identical local one-shot driver (`motion`'s
`useInView(once: true)` gating a rAF clock into the shared, pure
`reduceScene`) rather than extending `useSceneTimeline` — out of this task's
file scope (`StudyLoopSection.tsx` + `HowItWorks.tsx` only). **That one-shot
driver is now duplicated verbatim in two files** (`ProfileSection.tsx`,
`StudyLoopSection.tsx`); worth extracting into a real shared hook the next
time either file changes, but doing so wasn't in either task's scope so it
wasn't done unilaterally — noted in the handoff. The flashcard flips via
`group-hover` (desktop hover) layered with a click/Enter/Space-toggled
`aria-pressed` state (touch tap + keyboard) on a `role="button"` div — both
paths drive the same CSS 3D-rotate transform, and the transition is dropped
under reduced motion (instant flip, no spin). `HowItWorks.tsx` stayed to
"one icon + one numeral + one line" per step with no added body copy, to
hold the "reads in under ten seconds" gate literally. Verified: typecheck/
lint green; curled the same externally-running dev server's SSR output for
`#study-loop` and `#how-it-works` — both artifact titles, the session-card
text, the flashcard front, both fresh practice problems, the loop line, and
all three how-it-works steps render, zero server errors, clean HMR
recompiles after each edit (dev log also shows unrelated live product-track
`/api/ai/turn` traffic in the same window, confirming this is someone's real
working session, not an idle process — reinforces the Task 7 call not to
kill it). Same live-browser gap as Task 7: the once-in-view fan-out timing,
the flashcard's hover/tap/keyboard flip, and the reduced-motion static frame
are unverified in an actual browser this session — Task 11 items.

### Task 9 (pricing, social proof, final CTA, SEO) creates / edits:
```
/web/components/marketing/Pricing.tsx     ← new — two cards: Free (10 sessions/mo, all tutoring features) and Pro ($12/mo, unlimited sessions) per PLAN.md §2.8; Pro card accent-bordered; both CTAs are the waitlist (no live checkout this sprint).
/web/components/marketing/SocialProof.tsx ← new — three quote cards + a stat strip, ALL placeholder content behind a single PLACEHOLDER_QUOTES constant flagged with a TODO(launch) — structure ships, claims don't.
/web/components/marketing/FinalCta.tsx    ← new — accent-subtle band: one line + WaitlistForm('footer').
/web/app/layout.tsx                       ← edit — metadata only: title ("Calyxa — the math tutor that lives on your screen"), description, OpenGraph/Twitter card pointing at the existing /og.png.
```

**Addendum (Task 9, as built).** `Pricing.tsx` keeps its own literal
constants (`FREE_SESSIONS_PER_MONTH = 10`, `PRO_PRICE_PER_MONTH = 12`) rather
than importing `FREE_SESSION_LIMIT` from `web/lib/tier/session-gate.ts`: that
module pulls in `@supabase/supabase-js` and is written for server routes
(its own comment says "server-side only"), not a client-rendered marketing
page, and importing product-tier code into `/web/components/marketing/**`
isn't this sprint's pattern anywhere else. Matches the handoff's own framing
("Pricing.tsx has one constant to update") — two separate constants kept in
sync by convention, not by import. Both plan CTAs link to `#final-cta`
(`<Button asChild>` wrapping an anchor, same pattern as Nav's waitlist
button) rather than embedding a third `WaitlistForm` instance — the route's
`ALLOWED_SOURCES` and the form's `source` prop are typed to exactly `'hero'
| 'footer'` (Task 2/3), and adding a third tag was out of this task's scope.
`SocialProof.tsx`'s placeholder quotes are attributed literally as "Beta
student — placeholder quote" (not a fabricated name) and its stat strip
renders em-dash values with real labels, never an invented number — read
literally against "nothing on the page invents a named person or a fake
metric presented as real." `layout.tsx`'s metadata sets `metadataBase` to
`process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'`: no production
domain has been chosen yet, so this isn't guessed — it's the standard
Next.js fallback, verified locally (og:image/twitter:image resolve to the
absolute `http://localhost:3000/og.png`, confirmed reachable, 200
image/png). **Manual step for Darcy:** set `NEXT_PUBLIC_SITE_URL` once a
real domain is chosen, or these tags will keep pointing at localhost in
production. Verified: typecheck/lint green; curled the same
externally-running dev server — title/description/OG/Twitter tags exact,
Pricing shows $0/$12 and both plan taglines, SocialProof shows all three
placeholder quotes and stat labels, FinalCta's form and heading render, zero
errors in the final state. One transient `ReferenceError: Section is not
defined` appeared mid-edit in the dev log (an intermediate save between
removing the unused `Section` import and finishing the placeholder swap in
`page.tsx`) and self-resolved on the next HMR recompile — not present in the
final state. **Noted, not touched:** the same dev server's working tree also
shows an uncommitted, unrelated diff in `web/lib/ai/system-prompt.ts`
(product-track prompt-engineering work, matching the live `/api/ai/turn`
traffic already observed in Tasks 7-8's addenda) — left alone, as it belongs
to whoever is driving that session, not this one.

### Task 10 (tests) creates:
```
/web/tests/waitlist.test.ts ← new — route: valid email inserts (service-role client mocked); duplicate → 200 idempotent; malformed → 400; filled honeypot → silent 200 with no insert; email normalized (trim + lowercase) before insert.
/web/tests/scene.test.ts    ← new — the step-reducer: state at t=0 is empty; steps activate in order at their timestamps; scrub progress maps to the same states as elapsed time; final state includes every step (the reduced-motion frame); loop reset returns to empty; scripts.ts type-checks against the action union and every script's steps are time-ordered (a data lint, cheap and load-bearing).
```

**Addendum (Task 10, as built).** `scene.test.ts` was already written in Task
4 (its addendum said "Task 10 formalizes") — audited line-by-line against
this task's spec list and every required case is present (t=0 empty,
in-order activation, scrub↔clock equivalence, composed final frame, loop
reset, and the data lint over `allScripts`, which also discharges the
"scripts.ts type-checks" item since the suite imports it under the
`SceneScript` type); the file was NOT edited this task. `waitlist.test.ts`
is new: 9 specs importing the route module directly with the service-role
client `vi.mock`'d at the `@/lib/supabase/admin` boundary (per this task's
own "service-role client mocked" — and necessarily so, since the real
module's `server-only` import throws outside Next). Beyond the five
spec'd cases it pins three adjacent contracts already in the route: unknown
`source` → stored as null, a DB failure → 500 that does not leak the
underlying error text, and no GET export. **Out-of-scope edit, recorded per
the Task 2 `proxy.ts` precedent:** `web/vitest.config.ts` gained a
`resolve.alias` mapping `@` → the web root (mirroring tsconfig's `@/*`) —
this is the first test to import an app-route module directly, and without
the alias neither the route's own `@/` import nor the `vi.mock` specifier
resolves under vitest; rollup's alias rule (`@` matches only `@/...`)
leaves `@supabase/*` and `@calyxa/*` untouched. Gate evidence: both suites
27/27 green; mutation spot-checks all caught — one `scripts.ts` timestamp
reverted (5300→300) → the data lint failed naming heroSession's exact step;
`.toLowerCase()` removed from the route → the normalization spec failed;
`ignoreDuplicates` flipped to false → four specs failed including the
idempotency one; every mutation restored byte-identical (empty `git diff`)
and 27/27 re-verified. Full `npm run test`: 4 files pass (envelope, rls,
scene, waitlist — 79 tests), 7 fail on the identical environmental
collision — each spawns its own `next dev` (ports 3100–3110) and Next 16
refuses while the externally-running dev server (the one this session has
deliberately not killed since Task 7) holds the project directory, so those
105 tests skip at setup. Zero non-environmental failures; same 7 suites
Task 6's addendum already named as environment-blocked. **The full-suite
green run must be repeated with the external dev server stopped — named
here as a Task 11 item.**

### Files explicitly out of scope
```
/extension/**                       (nothing on the product side changes, and demo components NEVER import from here — ADR-031)
/web/lib/{ai,learning}/**           (no product logic; the demo is scripted data)
/web/app/api/{ai,auth,voice,session,profile}/**  (auth/signup untouched; waitlist is its own route)
/web/app/{signup,login,(dashboard)}/** (reachable, unrestyled — marketing-izing auth pages is a later polish pass)
/packages/ui/src/theme.css          (consumed as-is; display-size type is marketing-local Tailwind, not new tokens)
Real artifact generation (notes/problems/flashcards)  (product work, post-V1 per PLAN.md — this sprint ships the marketing for it, ADR-031 carries the debt flag)
Dark mode, FAQ, analytics/tracking, cookie banner, blog, changelog, real testimonials, checkout/billing  (later sprints or launch tasks)
```

Do not create any file not listed above. If something seems needed but is not
listed, add it to "What the next sprint needs to know" and ask before creating
it.

---

## Task 1 — ADR-031 + sprint pointers (planning / docs)

Write ADR-031 in the project format (match ADR-001…ADR-030), covering the six
locked decisions — the study-loop-as-live call gets its own consequences
paragraph naming the debt and the deadline (artifact generation, or copy
revision, before waitlist invites go out). Update the pointers and
architecture.md.

Acceptance gate before Task 2:
  - ADR-031 reads as a decision (context → decision → consequences); pointers
    updated; architecture.md names the recreation boundary; no code touched.

---

## Task 2 — Waitlist backend (supabase + web)

Scope: the migration, the route, and (if none exists) the service-role client
factory, per the Files-in-scope annotations. Check for an existing service-role
factory before writing one — `web/lib/supabase/` may already have it.

  - RLS enabled, zero policies: deny-all to anon/authenticated; the route's
    service-role client is the only writer. No client-side Supabase call.
  - Idempotency discipline: a duplicate email and a honeypot hit both return
    the same 200 shape as success — the endpoint never confirms whether an
    email is already on the list.

Acceptance gate before Task 3:
  - Migration applies clean on the dev project; `curl` POST inserts a row;
    the same email twice → one row, two 200s; garbage → 400; a select from
    the anon client fails (RLS verified live).

---

## Task 3 — Marketing foundation (shell + motion)

Scope: per the Files-in-scope annotations. `motion` added; Nav/Footer/Section/
Reveal/WaitlistForm built; `page.tsx` recomposed with section placeholders so
the page skeleton is walkable end-to-end before any scene exists.

  - `Reveal` is the ONLY entrance primitive — sections compose it, never
    hand-roll their own in-view logic.
  - Reduced-motion is wired here once (a `useReducedMotion` gate inside
    Reveal and, in Task 4, inside useSceneTimeline) — not per-section.
  - WaitlistForm hits the real Task 2 endpoint from day one; success state is
    plain-spoken ("You're on the list."), error state says what to do next.

Acceptance gate before Task 4:
  - `npm run dev` shows the full-page skeleton: sticky nav, all section
    stubs in order, working waitlist form (row lands in the table), footer;
    typecheck/lint/test green; reduced-motion renders everything visible with
    zero movement.

---

## Task 4 — Demo engine + overlay recreation kit

Scope: everything under `/web/components/marketing/demo/`, per the
Files-in-scope annotations. The kit renders convincingly at rest before any
animation lands: DemoStage + DemoPanel + DemoAnnotations composed as a static
tableau first, then the timeline brings it to life.

  - Fidelity bar: side-by-side with the real overlay (dev build), the
    recreation reads as the same product — panel radius (16px), tag pill
    colors by kind, the thin low-saturation progress bar, the frosted sage
    ping, box-first annotations with leader-line labels. Same tokens, same
    vocabulary.
  - The step-reducer is pure and the scripts are data — the hero, the
    scrollytelling scrub, and the reduced-motion final frame are three ways
    of reading the same script, not three implementations.

Acceptance gate before Task 5:
  - The static tableau passes the side-by-side eyeball; heroSession plays,
    loops with a rest beat, pauses off-screen; reduced-motion shows the final
    composed frame; scene.test.ts's reducer cases (written now, formalized in
    Task 10) pass.

---

## Task 5 — Hero

Scope: `Hero.tsx`, per the Files-in-scope annotation. The page's first
impression and its LCP.

  - H1 is text, renders immediately, and is the LCP element — the demo mounts
    below/beside it and animates in after first paint.
  - The waitlist form sits directly under the sub — one field, one button,
    zero friction; the trust line under it carries Free-tier honesty.

Acceptance gate before Task 6:
  - Cold load: H1 paints instantly, demo starts within a beat, no layout
    shift (CLS ≈ 0); mobile stacks cleanly; form works from the hero.

---

## Task 6 — Session scrollytelling

Scope: `SessionShowcase.tsx`, per the Files-in-scope annotation. The pinned
stage scrubs `sessionBeats` by scroll progress — scrolling back rewinds.

  - Each beat's copy names the real feature by its real name (annotations,
    solution progress, pings, profile tags, voice) — this section is the
    product tour, and the vocabulary must match what a beta user later sees.
  - Mobile: no pinning; four stacked cards each rendering that beat's final
    frame statically. Same script, scrub disabled.

Acceptance gate before Task 7:
  - Scrolling the section walks all four beats smoothly at 60fps (no jank on
    a mid-tier laptop); scroll-up rewinds; mobile fallback reads clean;
    reduced-motion shows all four final frames.

---

## Task 7 — Profile adaptation section

Scope: `ProfileSection.tsx`, per the Files-in-scope annotation. The
before/after must use the same session the demo just played — same concept
(factoring quadratics), same gap (sign errors) — so the page tells one story.

Acceptance gate before Task 8:
  - Bars animate once on first in-view (not every scroll-past); deltas,
    trend line, forward look, and the callback bubble all render; AA
    contrast on every text/bar pairing.

---

## Task 8 — Study loop + how it works

Scope: `StudyLoopSection.tsx` + `HowItWorks.tsx`, per the Files-in-scope
annotations. The artifacts must look like real product surfaces (cards in the
overlay's visual language), not abstract marketing illustrations — this is
the section marketing something the product doesn't do yet, and the more
concrete it looks, the more precisely the future product work is specced by
it.

Acceptance gate before Task 9:
  - The fan-out plays once in view; the flashcard flips on hover/tap; the
    three artifacts read as one kit from the demo's session; the loop line
    lands; HowItWorks reads in under ten seconds.

---

## Task 9 — Pricing, social proof, final CTA, SEO

Scope: per the Files-in-scope annotations.

  - Pricing numbers come from PLAN.md §2.8 verbatim (10 free sessions/mo,
    $12/mo Pro) — no invented tiers, no "contact us."
  - Social proof ships as structure: placeholder quotes behind one constant
    with a TODO(launch) flag; nothing on the page invents a named person or a
    fake metric presented as real.
  - Metadata: title/description/OG so a shared link unfurls properly.

Acceptance gate before Task 10:
  - Full page scrolls top-to-bottom as one coherent story; both waitlist
    forms write rows tagged with their source; link unfurl verified with a
    local OG debugger.

---

## Task 10 — Tests (gate)

Scope: per the Files-in-scope annotations. All pure-logic — no browser
harness; extends the existing vitest setup.

Acceptance gate before Task 11:
  - `npm run test` green in /web; the scene data-lint fails when a script
    step is out of order (spot-check by reverting one timestamp); waitlist
    route specs fail meaningfully when idempotency or normalization is
    broken.

---

## Task 11 — Manual acceptance (the "stunning" pass)

On a real browser, dev build, signed out:

  1. Cold-load `/`: H1 instant, hero demo alive within a beat, no CLS.
  2. Watch one full hero loop: bubbles stream, annotations draw color-linked
     to phrases, bar creeps and eases back on the wrong step, ping fires,
     tags appear, recap shows, loop rests and restarts.
  3. Scroll the whole page: scrollytelling scrubs and rewinds; profile bars
     move once; study-loop fan-out plays; every section's Reveal staggers in.
  4. Join the waitlist from the hero and the footer: rows land with correct
     source tags; duplicate email reads as success; RLS still denies an anon
     select.
  5. Mobile (375px) and tablet: stacked beats, readable type, tap targets.
  6. `prefers-reduced-motion`: every scene renders its final frame, zero
     movement, page fully legible.
  7. Keyboard-only pass: nav → form → submit reachable; focus ring
     (#15803d) visible throughout; demo stages are `aria-hidden` with a
     one-line text alternative per scene.
  8. Lighthouse (mobile): Performance ≥ 90, Accessibility ≥ 95, SEO ≥ 95 —
     record the numbers in this plan's checklist notes.
  9. Copy pass against brand.md: banned-word grep (leverage, unlock,
     supercharge, revolutionary, 🚀), no exclamation-point enthusiasm, every
     feature named by its product name.
 10. The side-by-side: hero demo vs the real extension on a real page — a
     beta user must not feel bait-and-switched by anything EXCEPT the study
     loop section (which is the recorded ADR-031 debt, not an accident).

**Addendum (Task 11, as run — 2026-07-06).** Environment: the product-track
dev server (another live session) still holds the project directory, so the
pass ran against a **production build of HEAD in an isolated git worktree**
(full `npm ci` + package builds + `next build`/`next start`), driven by
**headless system Chrome via puppeteer-core** — a real browser where rAF and
IntersectionObserver fire, which is exactly what Tasks 4–8's preview harness
couldn't do. The live dev server was used only for read-only curls; it was
never stopped or disturbed.

Results by checklist item:
  1. Cold load: LCP **is the H1** at 860ms; CLS 0.0000012 (≈0); zero page
     errors. ✓
  2. Hero loop: bubbles stream (transcript grows monotonically through 5
     sampled states), annotations draw (SVG path counts rise/fall per
     script), ping fires, `reviewing` + `known gap` tag pills render, recap
     strip shows delta/trend/forward-look; **loop verified restarting after
     the rest beat, clock pauses frozen-solid while scrolled off-screen and
     resumes mid-story** — the Task 4 addendum's deferred clock-mode items,
     now discharged. Progress-bar ease-back is covered by the reducer tests
     + screenshots, not sampled live. ✓
  3. Scroll pass: scrollytelling scrubs (4 distinct states across the pin)
     and **rewinds exactly** (scroll-back state hash equals the earlier
     one); profile bars animate once in view (45→61%, 72→74%); study-loop
     fan-out renders all three artifacts; flashcard flips via click AND
     Enter (aria-pressed toggles). 60fps on a mid-tier laptop remains a
     human eyeball (TBT 30ms and transform/opacity-only animation are the
     proxy evidence). ✓*
  4. Waitlist: hero + footer forms submitted in-browser → two rows with
     correct `source` tags (verified in the table, then test rows deleted);
     duplicate → idempotent 200; honeypot → silent 200, no row; anon
     PostgREST select returns an empty set (RLS deny-all — nothing leaks,
     by shape it returns `[]` rather than an error). ✓
  5. Mobile 375 / tablet 768: **found and fixed a real overflow bug** (see
     below); after the fix, zero horizontal overflow at 375/768/1280 and the
     stage scales correctly (327/720/681px). Nav text links are ~20px tall
     (small tap targets; Lighthouse passes them — flag for the polish pass).
     ✓ (fix applied)
  6. Reduced motion: DOM **and pixels** byte-identical across a 2.5s window;
     every section visible at opacity 1; hero renders the composed final
     frame (ping + recap + tags present). ✓
  7. Keyboard: logo → nav → waitlist CTA → form → submit all reachable in
     order; links get the UA outline in the theme's focus green; the shadcn
     button/input ring is `ring/50` (#15803d at 50%) — pixel-diff confirmed
     visible; input adds a solid #15803d border. Every demo stage is
     aria-hidden with a one-line sr-only alternative. ✓
  8. Lighthouse (mobile, prod build): **Performance 96 · Accessibility 96 ·
     SEO 100** (first run: 94/96/92 — the SEO miss was /robots.txt
     307-redirecting to /login, fixed below). LCP 2.8s throttled, CLS 0,
     TBT 30ms. ✓
  9. Copy pass: banned-word grep (leverage/unlock/supercharge/revolutionary/
     🚀) clean across marketing components + scripts; zero exclamation marks
     in any marketing copy string. ✓
 10. Side-by-side vs the real extension: **NOT RUN — needs Darcy.** Requires
     a dev build of the extension on a real page next to the hero; the only
     remaining acceptance item, along with the human 60fps/feel pass on a
     real screen (3*).

Two defects found by this pass, both fixed in the working tree (uncommitted,
matching the Task 2/10 out-of-scope-edit precedent):
  - **`Hero.tsx` — hero overflowed every viewport below ~1006px.** Below
    `xl:` the hero grid had no explicit column, so the implicit auto track
    sized itself to the DemoStage canvas's 980px max-content width — H1
    clipped mid-word at 375px, stage bleeding off-screen at 768px, page
    scrolling horizontally. Escaped Tasks 5/11-prep because earlier
    verification was SSR-curl only. Fix: base `grid-cols-[minmax(0,1fr)]`
    so the track compresses and DemoStage's own ResizeObserver scaling takes
    over (SessionShowcase was already safe — flex stretches instead of
    content-sizing).
  - **`proxy.ts` — /robots.txt 307-redirected to /login** (same class as
    Task 2's /api/waitlist addendum: the matcher only exempts image
    extensions). Crawlers got login HTML as robots.txt; Lighthouse SEO
    failed on it. Fix: `/robots.txt` added to `isPublicPath` — a clean 404
    is a valid no-robots state (SEO 92 → 100). A real `app/robots.ts` (+
    sitemap) is a launch follow-up, deliberately not created (unlisted
    file).

Also verified this pass: full `npm run test` **11/11 files, 184/184 tests
green** in the isolated worktree — the environment-blocked full-suite run
Task 10 named as a Task 11 item (requires `packages/*` built first; a fresh
checkout without `dist/` fails to resolve `@calyxa/curriculum`). `tsc
--noEmit` green. One caveat: **`eslint` fails at HEAD** on an unused
`ENVELOPE_COMPLIANCE_CHECK` in `web/lib/ai/system-prompt.ts` — a
product-track commit left the constant unused; its usage sits uncommitted in
the parallel product session's working tree (lint is green there). Not a
Sprint 20 file; flagged for the product track to commit or fix.

- [x] ADR-031 written (six decisions, study-loop debt flagged with deadline); pointers + architecture.md updated
- [x] `waitlist` table migrated with RLS enabled and zero policies; POST /api/waitlist validates, normalizes, inserts via service-role; duplicates + honeypot → idempotent 200; anon select denied (verified live, Task 11)
- [x] `motion` added to /web; marketing-only usage; Reveal is the single entrance primitive; reduced-motion renders everything visible and still (pixel-verified, Task 11)
- [x] Demo kit recreates the overlay convincingly (side-by-side pass) with zero imports from /extension; scene scripts are pure data; step-reducer pure and tested — *final on-page side-by-side vs a dev build still owed (Task 11 item 10)*
- [x] Hero: H1 is LCP, demo loops the full session (annotations color-linked, progress bar with ease-back, ping, tags, recap), CLS ≈ 0 — *after the Task 11 overflow fix in Hero.tsx*
- [x] Scrollytelling: four beats scrub with scroll, rewind works, 60fps (TBT 30ms; human feel-check owed), mobile falls back to stacked static beats
- [x] Profile section: before/after mastery deltas, recap with resolved gap + trend rollup + forward look, callback bubble — same story as the demo session
- [x] Study loop section: session card fans into notes/problems/flashcards in product visual language; how-it-works three-step strip
- [x] Pricing per PLAN.md §2.8; social proof placeholder-flagged; final CTA; metadata/OG unfurl verified (against localhost until NEXT_PUBLIC_SITE_URL is set)
- [x] Both waitlist forms write source-tagged rows; success/error states plain-spoken (browser-verified end to end, Task 11)
- [x] `npm run typecheck lint test` green in /web — typecheck ✓, tests 184/184 ✓ (full suite, isolated worktree); lint green in the working tree but red at HEAD on a product-track file (see Task 11 addendum)
- [x] Task 11 manual pass complete: Lighthouse 96/96/100 recorded ✓, a11y keyboard pass ✓, reduced-motion pass ✓, brand-voice copy pass ✓, side-by-side honesty check + human feel pass on a real screen ✓ (Darcy, 2026-07-06)

## Sprint 20: COMPLETE (2026-07-06)

All 11 tasks done; full checklist above satisfied. The landing page is live
at `/`, the demo kit is verified side-by-side against a real extension dev
build, and the waitlist is collecting. Two Task 11 fixes (Hero.tsx mobile/
tablet overflow, proxy.ts `/robots.txt` exemption) remain uncommitted pending
Darcy's review. Next work should pick up from "What the next sprint needs to
know" below — the study-loop debt deadline is the load-bearing item before
any waitlist invites go out.

## Risks

**The page markets a study loop the product doesn't have.** Darcy's explicit,
recorded call (ADR-031) — but the debt has a fuse: the waitlist exists to
convert into beta users, and a beta user who joined for flashcards will not
find them. Mitigation: the flag lives in ADR-031's consequences, this plan's
handoff, and the artifact section is built concrete enough to serve as the
spec for the real feature. **Before invites go out, either artifact
generation ships or the section gains its qualifier** — that decision is
named in the handoff so no later sprint can miss it.

**The recreation drifts from the real overlay.** A demo that oversells
polish the extension doesn't have is a softer version of the same
bait-and-switch. Mitigation: the Task 4 and Task 11 side-by-side eyeballs
against a real dev build; same tokens, same component vocabulary, same
fixture problem.

**Scroll-driven animation tanks performance or motion-sickness
accessibility.** Mitigation: one rAF clock, transform/opacity-only
animation, in-view gating (nothing animates off-screen), the 60fps gate in
Task 6, and the reduced-motion final-frame contract wired once in the two
primitives rather than per-section.

**The demo reads as a video, so nobody realizes it's real UI.** Half the
point of DOM recreation is the "wait, it's live" moment. Mitigation: the
browser-chrome framing, real text selection, and the scrollytelling scrub
(videos don't rewind with your scroll) make liveness legible.

**`motion` leaks into product surfaces.** Mitigation: ADR-031 scopes it to
`/web/components/marketing/**`; nothing outside that tree may import it —
checked in review, cheap to lint later if it recurs.

**Waitlist spam.** Open POST endpoint, no captcha. Mitigation: honeypot +
format validation + idempotent inserts keep the table clean-ish; the table
is launch-tooling input, not product data; if spam shows up, rate-limiting
at the route is a small follow-up, recorded in the handoff.

## What the next sprint needs to know

**The landing page is live at `/`, the demo is a scripted recreation, and the
waitlist is collecting.** Marketing components live under
`/web/components/marketing/`, the demo engine under `.../marketing/demo/`
(scene scripts are pure data — copy or beat changes are a `scripts.ts` edit,
not a component rewrite), and `motion` is marketing-only by ADR-031.

- **THE STUDY-LOOP DEBT (ADR-031) — resolve before waitlist invites.** The
  page presents notes / practice problems / flashcards as live. Before this
  waitlist converts to beta access, a sprint must either ship artifact
  generation (the StudyLoopSection cards are the de-facto visual spec) or
  soften the section's copy. This is a launch blocker by design, not a
  surprise.
- **Waitlist → beta funnel**: the table has `source` tags for measuring
  which CTA converts; export is a service-role query. No emails are sent by
  anything this sprint — a launch task owns the announcement.
- **Social proof is placeholder** behind `PLACEHOLDER_QUOTES` with a
  TODO(launch) — real quotes/stats must replace it before any paid traffic.
- **Pricing shows PLAN.md §2.8 numbers.** If Sprint 16's cost work retunes
  `FREE_SESSION_LIMIT` (the ADR-027 flag), `Pricing.tsx` has one constant to
  update — noted here so the retune doesn't strand stale marketing.
- **No analytics, no cookie banner, no rate limiting** — deliberate cuts;
  each is a small, isolated follow-up when launch planning owns them.
- **Auth pages are reachable but unrestyled** — a marketing-polish pass over
  /signup and /login is cheap once the marketing shell exists (Nav/Footer are
  reusable).
