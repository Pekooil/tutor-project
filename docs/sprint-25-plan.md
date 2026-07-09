# Sprint 25 — Landing page v2: the redesigned extension, back on stage

> **Parallel-track sprint** (the Sprint 20 pattern): marketing-surface work
> sharing no files with the product roadmap sprints (15–19, 22–24) except the
> marketing tree under `/web/components/marketing` + `/web/app/page.tsx`.
> The ADR number below is **provisional** (written as ADR-040 — Sprint 17
> already claims 039): assign the next free number at execution and fix the
> references in one pass.

## Goal
Sprint 20's landing page recreates the **Sprint 14-era overlay**. The
extension has since shipped its full redesign (the Claude Design handoffs:
overlay glass shell, tutor modes, the ping system, milestone markers, the
check-in/recap cards, the Meadow annotation system) — so the page now
advertises **four retired features** (solution progress bar, per-bubble
profile tags, insight strips, the old annotation palette) and shows none of
the flagship new ones. This sprint makes the page a correct — and better —
representation. By the end:

1. **The hero demo is the current extension.** The live recreation plays the
   full session arc — opening scan → AI-prediction check-in → tutoring with
   pings, live tutor-mode switches, board strip, milestone markers, answer
   chips, Meadow annotations → recap card — on the same glass panel anatomy
   the product ships (Darcy's call: full arc, ~25s loop).
2. **The headline is annotated.** Meadow-style marks draw onto the H1 itself
   (draw-on motion, label pill, one why-note), and quiet ambient elements —
   a cycling ping toast and the tutor-mode capsule — put pings and modes
   above the fold.
3. **"See it work" tells the current story**: the two beats about retired
   features (progress bar, tag pills) are replaced with the milestone/stage
   story and the prediction/ping story; the annotation beat gains pills,
   why-notes, and echo chips.
4. **A new adaptive-features section** ("It adapts while you work"): four
   live vignettes — misconception prediction, tutor modes, annotation
   anatomy, and an interactive ping catalog.
5. **"It learns how you learn" is rebuilt** around the real bookends: the
   check-in (scanning orb → prediction card) before, the recap card (What
   improved / Still needs practicing) after — the mastery-bar strips it
   currently shows no longer exist in the product.
6. **The study-loop section is reframed as roadmap** ("on the way", no beta
   promise — Darcy's call, reversing ADR-031 §4's marketed-as-live decision):
   visually tied to the recap card's "Generated for you" slot.

```
/  (landing)
├─ Nav          unchanged
├─ Hero         annotated H1 · ambient ping + mode capsule · waitlist
│               DemoStage v2: full arc (scan → check-in → session → recap)
├─ Session      pinned DemoStage, 4 rewritten beats:
│                 annotations v2 → milestones + stages → prediction + pings → voice
├─ Adaptive     NEW — "It adapts while you work": prediction · modes ·
│               annotation anatomy · interactive ping catalog
├─ Profile      REBUILT — check-in card (before) → recap card (after) · callback quote
├─ Study loop   REFRAMED — "on the way", tied to the recap's Generated-for-you slot
├─ How it works / Pricing / Social proof / Final CTA / Footer   unchanged
```

## Context
Ground truth for "what the extension looks like" is the shipped overlay
(`extension/src/overlay/*`) plus the three design handoffs (Calyxa Overlay,
Calyxa Extension/session redesign, Calyxa Annotations). What changed since
the Sprint 20 recreation was built:

- **Panel**: glass material (`bg-background/85` + `backdrop-blur(18px)
  saturate(1.5)`), idle pill, full teardown. The demo panel is solid white.
- **Session header**: the live **tutor mode** takes the logo's place
  (8 modes, typographic glyphs, `--calyxa-mode-*` tokens; `tutor-modes.ts`),
  plus a **stage subtitle** ("Stage 1 of 3") and a live clock. The demo shows
  logo + wordmark only.
- **Progress bar: RETIRED** (ADR-034 — "pings + milestone markers ARE the
  progress"). The demo still renders it in the composer, and an entire
  showcase beat is about it.
- **Per-bubble profile tags: RETIRED** (Sprint 15) — their content moved to
  the title card, pings, and milestone markers. The demo still renders them,
  and a showcase beat is about them.
- **Insight strips (pre/post mastery-bar windows): GONE** — replaced by the
  check-in card (scanning orb → one glow-haloed AI-prediction card + the 5b
  reframe tool) and the terminal recap card (Concept / What improved /
  Still needs practicing / Generated for you). ProfileSection recreates the
  old strips.
- **Ping system**: 19 kinds × 3 tones (positive/adjust/watch, `pings.ts`),
  glyphs never emoji, one-at-a-time, 3s. The demo fires one generic ping.
- **Milestone markers**: hairline-rule rows that persist in the transcript.
  Absent from the demo.
- **Board strip**: pinned current equation under the header, updating as the
  problem transforms. Absent from the demo.
- **Answer chips** under tutor turns; tutor turns un-bubbled (mark + open
  text); student turns sage bubbles. The demo bubbles both roles.
- **Annotations**: the Meadow ordinal system (`--calyxa-annot-1..4` triples:
  stroke/tint/deep), label pills (tint bg + deep text — dark-on-light,
  replacing white-on-color), why-note cards, step badges, leader lines,
  draw-on motion (480ms), transcript echo chips. The demo draws the old
  amber/blue/green boxes with white-on-color pills and underline color-links.

What does NOT change: the waitlist, pricing, social proof, nav/footer, the
`motion` + reduced-motion discipline, the scene-script/one-player engine
(ADR-031 §the-demo-engine) — the engine is extended, not replaced.

### Decisions locked for this sprint (recorded in ADR-040, provisional)
1. **The demo recreates the CURRENT overlay, still never imports it**
   (ADR-031 §2 carried forward). Fidelity target is the shipped components
   (`Overlay.tsx`, `TitleBar.tsx`, `Transcript.tsx`, `Composer.tsx`,
   `CheckinCard.tsx`, `RecapCard.tsx`, `PingToast.tsx`,
   `AnnotationLayer.tsx`) — eyeball-checked against a production build, not
   code-shared.
2. **The hero plays the full arc** (scan → check-in → session → recap card,
   ~25s + rest), so misconception prediction is visible without scrolling.
3. **The headline annotation is marketing chrome, not product recreation** —
   same Meadow vocabulary (ordinal 1 circle + label pill, ordinal 2
   underline + why-note), draw-on once on load, `aria-hidden`, reduced-motion
   → composed static frame. It decorates the H1; it never blocks selection
   or reflows the text (SVG overlay, absolute).
4. **Adaptive features get their own section** between "See it work" and the
   profile section. The scroll-scrubbed showcase stays a narrative; the four
   adaptive systems (prediction, modes, annotations, pings) read as parallel
   machinery in a 2×2 vignette grid. The ping catalog vignette is
   tap-to-fire (the design board's 8b interaction) — the page's second
   interactive element after the flashcard.
5. **The study loop is reframed as roadmap** — reversing ADR-031 §4
   (marketed-as-live). Copy says it's on the way WITHOUT promising beta
   (generation is deferred post-beta and won't be in the beta build); the
   section visually chains off the recap card's "Generated for you"
   placeholder tiles so the page and the product tell the same story.
6. **Colors come from `@calyxa/ui` tokens where they exist**
   (`--calyxa-annot-*`, `--calyxa-mode-*`, `--calyxa-ping-*` shipped with the
   extension redesign). Where a product value is unreachable inside /web
   (the `globals.css` shadcn re-targeting), the demo extends the existing
   DemoStage-scoped `--cx-demo-*` mirror pattern — file-local, documented,
   never a new marketing palette.

### One engine, richer vocabulary (read before Tasks 2–4)
The scene engine (`scene.ts` + `useSceneTimeline`) stays. The step union
grows: `mode` (tutor-mode switch), `stage` (subtitle), `board` (equation),
`milestone` (tone + line, persists), `chips` (answer chips show/pick),
`checkin` (scan phase → prediction card), `recap` (the card model), and
`annotate` upgrades to the Meadow shape (`ordinal`, `shape`, `label`,
`note?`, `step?`). `progress`, `tag`, and `strip` steps are **deleted** with
their renderers — nothing on the page may render a retired feature. The
reducer stays pure; existing tests extend.

## Execution model
A **single code session** owns this sprint end to end, worked **strictly in
order (1 → 10)**. The chain: ADR + pointers (1); engine vocabulary (2) before
the renderers (3) before the scripts (4) before any section consumes them
(5–9); tests (10) gate manual acceptance. Plan-only until Darcy approves this
document.

## Files in scope

### Task 1 (ADR + sprint pointers) creates or edits:
```
/docs/adr/ADR-040-landing-demo-v2.md ← new (PROVISIONAL number) — decisions 1–6 above; explicitly amends ADR-031 §4 (study loop no longer marketed as live).
/CLAUDE.md                           ← edit one line: note Sprint 25 (parallel track) alongside the current product sprint.
/docs/sprint-25-plan.md              ← this file
/docs/architecture.md                ← edit the marketing/landing section: demo v2 anatomy, the new adaptive section, the study-loop reframe.
```

### Task 2 (demo engine vocabulary) edits:
```
/web/components/marketing/demo/scene.ts ← extend the step union (mode/stage/board/milestone/chips/checkin/recap, annotate v2) + reducer; DELETE progress/tag/strip actions and their state.
/web/tests/* (existing scene tests)     ← extend for the new reducer branches.
```

### Task 3 (renderers) edits / creates:
```
/web/components/marketing/demo/DemoPanel.tsx       ← rebuild: glass material, mode-identity header + stage subtitle + clock, board strip, un-bubbled tutor turns, milestone rows, answer chips, check-in + recap card states, 3-tone ping. Progress bar + tag pills + StripCard DELETED.
/web/components/marketing/demo/DemoAnnotations.tsx ← rebuild: Meadow ordinal triples, label pills (tint/deep), why-note cards, step badges, leaders, draw-on motion (pathLength dash), 240ms exit fade, reduced-motion instant.
/web/components/marketing/demo/DemoPing.tsx        ← tones + glyphs per pings.ts's catalog.
/web/components/marketing/demo/DemoStage.tsx       ← scoped token mirrors for annot/mode/ping values unreachable in /web; drop the progress-knob styles.
```

### Task 4 (scripts) edits:
```
/web/components/marketing/demo/scripts.ts ← rewrite all scripts on the new vocabulary: heroSession (full arc ~25s), sessionBeats (4 new beats), checkinRecapScene (replaces profileScene), adaptive vignette scripts. Same fixture problem (x² + 5x + 6 = 0) so the page still reads as one session from many angles.
```

### Task 5 (hero top-of-fold) edits / creates:
```
/web/components/marketing/Hero.tsx              ← annotated H1 + ambient ping/mode elements + updated alt text; copy check.
/web/components/marketing/HeadlineAnnotations.tsx ← new — the H1 SVG mark layer (decision 3).
```

### Task 6 (See it work) edits:
```
/web/components/marketing/SessionShowcase.tsx ← rewrite beats 1–3 copy + alts (annotations v2 / milestones + stages / prediction + pings); beat 4 copy check.
```

### Task 7 (adaptive section) creates / edits:
```
/web/components/marketing/AdaptiveSection.tsx ← new — the 2×2 vignette grid (decision 4).
/web/app/page.tsx                             ← mount it between SessionShowcase and ProfileSection.
```

### Task 8 (profile section) edits:
```
/web/components/marketing/ProfileSection.tsx ← rebuild: check-in card (before) / recap card (after), reusing Task 3's renderers; keep the once-in-view driver + the callback quote.
```

### Task 9 (study loop + sweep) edits:
```
/web/components/marketing/StudyLoopSection.tsx ← reframe copy ("on the way", no beta promise); chain visually off the recap card's Generated-for-you slot.
All marketing components                        ← alt-text/copy sweep: no mention of progress bars, tags, or strips survives anywhere on the page.
```

### Task 10 (tests) edits / creates:
```
/web/tests/* ← reducer branches for the new vocabulary; a grep-style assertion that no marketing component references the deleted actions (progress/tag/strip) or renders a white-on-color annotation pill; render tests for AdaptiveSection + rebuilt ProfileSection.
```

### Files explicitly out of scope
```
/extension/**                    (ground truth, read-only)
/packages/ui/src/theme.css       (tokens exist from the extension redesign; read-only — a missing token is a stop-and-ask, not an add)
/web/app/api/**, /supabase/**    (no data/backend surface changes)
Pricing / SocialProof / FinalCta / Nav / Footer / WaitlistForm (copy-check only, no redesign)
```
Do not create any file not listed above. If something seems needed but is not
listed, add it to "What the next sprint needs to know" and ask before creating it.

---

## Task 1 — ADR + sprint pointers (planning / docs)
Write ADR-040 (provisional — assign the next free number at execution; note
the ADR-031 §4 amendment inside it). Update pointers + architecture.md.

Acceptance gate before Task 2:
  - The ADR reads as decisions; the ADR-031 §4 reversal is explicit; the
    provisional number is flagged; no code touched.

## Task 2 — Demo engine vocabulary
Scope: `scene.ts` union + reducer + test extension. Retired actions deleted.

Acceptance gate before Task 3:
  - Reducer handles every new step kind; `progress`/`tag`/`strip` no longer
    compile; existing tests green.

## Task 3 — Renderers
Scope: DemoPanel/DemoAnnotations/DemoPing/DemoStage rebuilds.

Acceptance gate before Task 4:
  - Side-by-side with a production extension build, the panel and marks are
    visually faithful (glass, mode header, board strip, milestones, chips,
    Meadow pills/notes); nothing renders a retired feature; reduced motion
    yields composed static frames.

## Task 4 — Scripts
Scope: `scripts.ts` rewrite on the new vocabulary.

Acceptance gate before Task 5:
  - heroSession plays the full arc in ~25s + rest; every script still tells
    the one x² + 5x + 6 = 0 story; alt strings drafted for every consumer.

## Task 5 — Hero top-of-fold
Scope: annotated H1, ambient ping/mode elements, alt/copy.

Acceptance gate before Task 6:
  - Marks draw onto the H1 once on load and never reflow or block selection;
    ping + mode elements are visible without scrolling, one at a time, calm;
    LCP stays the static H1 (annotation layer mounts after paint).

## Task 6 — See it work
Acceptance gate before Task 7:
  - No beat describes a retired feature; scrub + stacked fallbacks both play
    the new beats.

## Task 7 — Adaptive section
Acceptance gate before Task 8:
  - Four vignettes render; the ping catalog fires on tap with the three
    tones; keyboard + reduced-motion clean.

## Task 8 — Profile section
Acceptance gate before Task 9:
  - Before/after reads as check-in card → recap card; plays once in view;
    the callback quote survives.

## Task 9 — Study loop + sweep
Acceptance gate before Task 10:
  - Roadmap framing, no beta promise; a page-wide grep finds no surviving
    progress-bar/tag/strip copy or alt text.

## Task 10 — Tests (gate)
Acceptance gate before manual acceptance:
  - `turbo run typecheck lint build test` green; the no-retired-features
    assertion fails if anyone re-adds them.

## Manual acceptance
  1. Hero: full arc loops; check-in prediction + recap card both appear;
     mode switches visibly mid-session; a milestone persists in the
     transcript; the board strip updates to the factored form.
  2. H1 marks draw on; ping/mode ambient elements cycle above the fold.
  3. Showcase beats scrub correctly; below-lg stacked frames match.
  4. Adaptive section: tap-to-fire pings work on touch + keyboard.
  5. Profile section: check-in → recap bookends; plays once.
  6. Study loop reads as roadmap; no beta promise anywhere.
  7. Reduced motion: every scene renders its composed final frame.
  8. Eyeball fidelity check against the real extension on a production build
     (`npm run build` in /extension, loaded unpacked).

## Acceptance criteria (full checklist)
- [ ] ADR-040 written (number assigned at execution); ADR-031 §4 amended; pointers + architecture.md updated
- [ ] Engine vocabulary extended; progress/tag/strip deleted end-to-end
- [ ] DemoPanel/DemoAnnotations/DemoPing rebuilt to current-overlay fidelity
- [ ] heroSession full arc; sessionBeats rewritten; all alts updated
- [ ] Annotated H1 + above-the-fold ping/mode elements
- [ ] AdaptiveSection shipped with interactive ping catalog
- [ ] ProfileSection rebuilt on check-in/recap bookends
- [ ] StudyLoop reframed (roadmap, no beta promise)
- [ ] Tests green incl. the no-retired-features assertion; manual pass complete

## Risks
**Fidelity drift, again.** This sprint exists because the recreation and the
product diverged silently. Mitigation: the no-retired-features test, the
eyeball gate against a production build in Task 3 AND manual acceptance, and
a handoff note telling every future overlay-redesign sprint to add "update
the marketing demo" to its own checklist.

**The full-arc hero loop is long (~25s).** A visitor may never see the recap.
Mitigation: the check-in (the flagship prediction moment) lands in the first
~5s; the arc's biggest beats (ping, mode switch, milestone) are front-loaded;
the profile section replays the bookends for anyone who scrolled past.

**The annotated H1 fights readability or LCP.** Mitigation: marks are an
absolutely-positioned SVG layer mounted post-paint over a static server-
rendered H1; if any mark hurts headline legibility at any viewport, the mark
moves or dies — the headline wins every conflict.

**Token reach.** The extension's mode/ping/annot tokens may not all be
consumable inside /web's Tailwind setup. Mitigation: the DemoStage-scoped
mirror pattern already exists for exactly this (`--cx-demo-hairline`);
extending it is contained and documented; theme.css itself is read-only.

**Scope creep into the extension.** Every gap found during fidelity checks is
a note in the handoff, never a fix in `/extension` (out of scope, and the
build artifact rule makes casual extension edits expensive).

## What the next sprint needs to know
- The marketing demo now mirrors the REDESIGNED overlay; any future overlay
  design change must add "update /web/components/marketing/demo" to its own
  sprint checklist, or the page rots again.
- ADR-031 §4 is dead: the study loop is roadmap copy (no beta promise). When
  study-material generation actually ships, Task-9's section is the surface
  to flip back to marketed-as-live.
- The adaptive section's vignette scripts are the natural home for any new
  ping kinds or tutor modes — pure data in scripts.ts.
- The scene engine's vocabulary now matches the product's display language
  (modes/stages/milestones/pings); if the dashboard sprint (22) ever wants a
  marketing-side "what the extension records" visual, reuse it.
