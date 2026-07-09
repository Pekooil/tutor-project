# ADR-040: Landing page v2 — the redesigned overlay on stage, adaptive features above the fold, and the study loop reframed as roadmap

> **PROVISIONAL NUMBER.** Sprint 17's plan already claims ADR-039, and Sprints
> 16–19 execute on their own track. Assign the next actually-free number when
> Sprint 25 lands (or when a colliding sprint lands first) and fix references
> in one pass — the same handling Sprint 22's plan uses for its ADR-046/047.
> References to fix: this file's name/title, `/docs/sprint-25-plan.md`,
> `/docs/architecture.md`, and ADR-031's amendment note.

**Status:** Decided

**Context:** Sprint 20 shipped the marketing landing page (ADR-031) as a
faithful recreation of the overlay **as it existed at Sprint 14**: solid
panel, logo-and-wordmark header, per-bubble profile tags, pre/post insight
strips, a solution-progress bar in the composer, and the original
amber/blue/green annotation boxes with white-on-color label pills. The
extension has since shipped its full redesign (the Claude Design handoffs,
implemented across Sprint 15's design-board passes): a glass panel with an
idle pill; a session header whose identity is the live **tutor mode** (eight
modes, typographic glyphs) plus a stage subtitle and clock; the **ping
system** (nineteen kinds, three tones) with **milestone markers** that
persist in the transcript — explicitly replacing the retired progress bar
(ADR-034) and the retired per-bubble tags (Sprint 15); a **board strip**
pinning the current equation; **answer chips**; the **check-in card**
(scanning orb → one glow-haloed AI-prediction card + the 5b reframe tool)
and terminal **recap card** replacing the insight strips; and the **Meadow
annotation system** (ordinal color triples, tint label pills, why-note
cards, step badges, leader lines, draw-on motion). The landing page
therefore now advertises four retired features and shows none of the
flagship new ones. Separately, ADR-031 §4's fuse ("before the waitlist
converts to beta invitations, either artifact generation ships, or this
section's copy gains a qualifier") has come due: study-material generation
is deferred post-beta — the shipped recap card renders a "Generated for
you" **placeholder** — and it will not be in the beta build. This ADR
records the decisions for Sprint 25's correction pass.

**Decision:**
1. **The demo recreates the CURRENT overlay, and still never imports it.**
   ADR-031 §2 carries forward unchanged in mechanism: components under
   `/web/components/marketing/demo/` recreate the redesigned overlay — glass
   material, mode-identity header with stage subtitle and clock, board
   strip, un-bubbled tutor turns, sage student bubbles, milestone markers,
   answer chips, check-in and recap card states, the three-tone ping toast,
   and Meadow annotations (pills, why-notes, step badges, leaders, draw-on
   motion) — from tokens, never by importing `/extension`. Fidelity target
   is the shipped components (`Overlay.tsx`, `TitleBar.tsx`,
   `Transcript.tsx`, `Composer.tsx`, `CheckinCard.tsx`, `RecapCard.tsx`,
   `PingToast.tsx`, `AnnotationLayer.tsx`), eyeball-checked against a
   production build (`extension/dist/chrome-mv3`), not code-shared. The
   retired vocabulary — `progress`, `tag`, and `strip` scene actions and
   their renderers — is **deleted end-to-end**, and a test asserts no
   marketing component references it, so the page cannot quietly re-grow a
   retired feature.
2. **The hero plays the full session arc** (~25s + rest): opening scan →
   AI-prediction check-in → tutoring with pings, a live mode switch,
   milestones, and Meadow annotations → recap card. Darcy's call, so
   misconception prediction — the flagship adaptive moment — is visible
   without scrolling. The check-in lands in the first ~5s and the biggest
   beats are front-loaded, since a visitor may not watch a full loop.
3. **The headline itself is annotated — as marketing chrome, not product
   recreation.** Meadow-vocabulary marks (an ordinal circle + label pill, an
   underline + why-note) draw onto the hero H1 once on load, with the
   product's draw-on timing. The layer is an absolutely-positioned,
   `aria-hidden` SVG mounted after paint over the server-rendered H1: it
   never reflows the text, never blocks selection, never becomes the LCP
   element, and renders a composed static frame under reduced motion. A
   cycling ping toast and the tutor-mode capsule join it above the fold, one
   element at a time, calm. If any mark hurts headline legibility at any
   viewport, the mark moves or dies — the headline wins every conflict.
4. **Adaptive features get their own section** ("It adapts while you work"),
   between the scroll-scrubbed showcase and the profile section. The
   showcase stays a narrative; the four adaptive systems — misconception
   prediction, tutor modes, annotation anatomy, session pings — read as
   parallel machinery in a vignette grid. The ping-catalog vignette is
   tap-to-fire (the design board's own 8b interaction), the page's second
   interactive element after the flashcard, keyboard-reachable.
5. **The study loop is reframed as roadmap — this amends ADR-031 §4.** The
   marketed-as-live decision is reversed: the section presents notes,
   practice problems, and flashcards as **on the way**, with copy that makes
   no beta promise (Darcy's call — generation is deferred post-beta and will
   not be in the beta build), visually chained off the recap card's
   "Generated for you" placeholder slot so the page and the product tell the
   same story. ADR-031's fuse is hereby resolved on its "copy gains a
   qualifier" branch. When generation actually ships, this section is the
   surface to flip back.
6. **Colors come from the product's tokens.** The extension redesign shipped
   its palette as named `@calyxa/ui` tokens (`--calyxa-annot-1..4` triples,
   `--calyxa-mode-*`, `--calyxa-ping-*`); the demo consumes them wherever
   they are reachable inside `/web`. Where `/web`'s shadcn token re-targeting
   makes a product value unreachable by name, the demo extends the existing
   DemoStage-scoped `--cx-demo-*` mirror pattern (file-local, documented,
   the `--cx-demo-hairline` precedent) — never a new marketing palette, and
   `packages/ui/src/theme.css` itself stays read-only this sprint: a
   genuinely missing token is a stop-and-ask, not an addition.

**Rationale:**
- The page exists to show the product; a recreation that shows a retired
  product is worse than no demo — it bait-and-switches the exact beta users
  the waitlist is collecting. Rebuilding on the current anatomy, plus a
  test that fails on retired vocabulary, converts "someone should notice
  drift" into a mechanical gate.
- Deleting the retired scene actions (rather than leaving them dormant)
  makes the type-checker enforce the correction: a section that still
  renders a progress bar stops compiling, which is how every consumer is
  guaranteed to be swept in one sprint.
- The full-arc hero costs loop length but buys the two things the redesign
  is actually about — the tutor predicting the student's sticking point
  before the session, and the session visibly adapting — in the first
  screenful. The alternative (session-only loop) shows a nicer chat window
  and buries the differentiators below the fold.
- Annotating the H1 makes the page itself demonstrate the product's central
  gesture (point + teach) in the first second, at near-zero risk because it
  is decorative chrome layered over static text with an explicit
  headline-wins conflict rule.
- A separate adaptive section keeps the scrollytelling showcase's
  one-session narrative intact; folding four parallel systems into it would
  either bloat the scrub track or flatten each system to one line. Parallel
  machinery reads best as a grid.
- Reversing ADR-031 §4 now, on the recorded fuse's own terms, is the cheap
  branch: the fuse said "ship it or qualify it before invites," generation
  is confirmed post-beta, and an unqualified claim surviving into the beta
  invite would convert recorded marketing debt into a broken promise to
  identified users.

**Consequences:**
- Enables: a landing page that is again evidence of the product; marketing
  demos of new overlay features (modes, pings, milestones, check-in/recap)
  as pure script data; the adaptive section as the natural home for future
  ping kinds and tutor modes.
- Requires: any future overlay redesign to add "update
  `/web/components/marketing/demo`" to its own sprint checklist (recorded in
  Sprint 25's handoff — this sprint exists because Sprint 20's recreation
  had no such tripwire); the no-retired-features test to stay green; the
  Task 3 and manual-acceptance eyeball checks against a production extension
  build to be run, not skipped.
- Forecloses: marketing the study loop as live before generation ships
  (reverses ADR-031 §4; the old fuse is resolved and must not be silently
  re-armed); rendering any retired overlay feature on the page; new
  marketing palette values outside the token mirror pattern; edits to
  `/extension` or `packages/ui/src/theme.css` from this sprint's work.

**Amendment note:** ADR-031 carries a dated amendment section pointing here
(its §4 decision and the associated fuse language in its Consequences are
superseded by decision 5 above). ADR-031's other decisions (§1–3, §5–6)
stand unchanged.
