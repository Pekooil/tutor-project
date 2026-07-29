## ADR-056: The v4 homework session ships local-first — a zero-model DOM scan, a client-side reaction engine, and `chrome.storage.local` as the source of truth; system font stays, and the one sound is synthesized

**Status:** Proposed

**Context:** The Calyxa v4 implementation spec (slice 1) turns the extension from
"opens when a student is stuck on one problem" into a wrapper around the whole
homework session: scan → opener → denominator confirmation → a persistent
progress pill with a one-tap completion trio → a local reaction vocabulary →
tutoring handoff → an auto-firing summary → lossless resume. Three of its
decisions were explicitly left open for us to settle (spec §9 plus the
persistence scope), and each one changes an existing locked decision or adds a
new subsystem, so they are recorded here rather than buried in the diff.

Darcy settled all four on 2026-07-29.

---

### Decision 1 — The scan is two calls, and only one of them is a model call

`extension/src/content/problemScanner.ts` enumerates every problem on the page
with a **synchronous, read-only DOM pass and zero model involvement**: container
adapters (exercise-engine data attributes, `<ol><li>`, `role=listitem`, table
rows), a labelled-line fallback for worksheets rendered as loose `<div>`s, and a
deliberately conservative graded-detection pass. It reuses `pageExtractor.ts`'s
read boundary verbatim (`collectSearchRoots` / `queryExcludingOverlay`, now
exported) so the overlay's own `<calyxa-overlay>` subtree is excluded and open
host-page shadow roots are still read — one definition of that boundary, two
readers.

**It never solves anything.** Problem bodies are not sent to a model at scan
time. That is what keeps the scan cost near zero and the latency inside the
spec's budget (target <1.5s, hard ceiling 4s), and it is what makes the mechanic
affordable at student pricing.

Naming the topic is the one call allowed, and it reuses the **shipped
`OPENING_SCAN` transport** rather than adding an endpoint — same auth, same
`costGuard`, same free-cap behavior, same session reuse. It is raced against a
4s ceiling and dropped entirely if it loses, comes back empty, or is
unconfident: `"8 problems."` alone is a valid opener; a wrong topic on the first
screen is not. Annotations are deliberately **not** drawn from this call — it is
a "what is this page about" read at the start of a homework hour, not a tutoring
turn.

Consequence: a homework session that never reaches tutoring still costs one
opening-scan turn. Accepted — it is the moment the whole feature is selling, and
it degrades silently (to the bare count) under the hard cost cap or a spent free
allowance.

### Decision 2 — Persistence is local-only this slice

`chrome.storage.**local**`, not `.session` — the deliberate opposite of
`lib/storage.ts`'s auth-token discipline (ADR-006, PLAN §2.2: tokens must not
hit disk). A homework session must survive a tab crash, a browser restart, and
going offline; that is the entire point of resume. What lands there is progress
bookkeeping: problem labels, short snippets read off the page the student is
already looking at, outcomes, durations, and a bounded rolling history of
completed sets. No tokens, no transcripts, no audio.

**Nothing syncs to Supabase this slice** (Darcy's call). The spec's "never let a
sync failure block or lose a tap" is satisfied trivially while there is no sync,
and the persisted shape is exactly what a later upload would carry, unchanged.
The local history is also the **only** source of pace data, which is what the
opener's variant B/C lines and the summary's self-comparison read.

Consequence: pace history does not follow a student across devices, and the
Studio v4 dashboard cannot yet show homework sessions. Both land with the
server half, which gets its own pass alongside the dashboard work that consumes
it.

### Decision 3 — Font: the shipped system stack stays (ADR-018 unchanged)

The handoff presents Sys vs. Hanken Grotesk as an open toggle. Bundling a
variable font inside the shadow DOM would amend ADR-018, add a `woff2` to the
extension bundle, and add an `@font-face` the shadow root has to resolve. The v4
flow reads correctly in the system stack (the handoff's own 1a panel), so the
warmer counters do not buy enough to be worth the change. **ADR-018 stands.**

### Decision 4 — The tap sound is synthesized, not bundled

One sound in slice 1: tap accepted. It is generated with WebAudio
(`overlay/homework/sound.ts`) rather than shipped as an asset — zero bundled
bytes, a duration under the spec's 150ms **by construction** (110ms envelope),
no `web_accessible_resources` plumbing for a content script, and a timbre that
stays tunable in code. Two triangle partials a fifth apart, 2ms attack (no
click), exponential tail, peak gain 0.09.

It is **the same sound for every tap** — nothing carries information by sound
alone (spec §10); the reaction chip carries the meaning. One persistent mute
toggle lives in `chrome.storage.local` beside the session.

---

### Also decided, because the spec left the mechanism open

- **The reaction vocabulary is a rules engine, not the prototype's `vocab(n)`
  switch.** Eight prioritized rules, evaluated client-side, synchronously, with
  zero model calls and templated copy. Cooldowns (90s on `moment`), a
  per-session moment cap (3, set-complete exempt), and the position-rule
  suppression below denominator 6 all live in a **persisted** `ReactionMemory`,
  so a resume carries the budget over rather than handing out a fresh one. A
  blocked moment is **demoted to a whisper, never dropped** — the tap is always
  acknowledged.
- **The breathing green glow fires only on `moment`.** Stated in the design and
  load-bearing: while a set runs, the resting glow is dimmed well down so a
  moment reads as a change.
- **The just-in-time misconception rule is built, tested, and silent.** It needs
  both mastery data for the concept *and* a confident problem-to-concept
  mapping; nothing client-side produces the second one yet, so its input map
  stays empty. Spec §2's rule applies: omit whenever either is missing, never
  show a placeholder.
- **A tutoring detour does not end the set.** Inside a running set, a turn's
  `session.complete` means *this problem* is done: the bloom still fires, then
  the student is returned to the set with the bar advanced and the outcome
  recorded as `tutored`. The tutoring session stays open for the next problem
  that needs it, and the inactivity auto-end is suspended (the student is
  demonstrably present; their taps are activity the tutoring-side timer cannot
  see). The set's completion ends the session, so nothing dangles.
- **SPA navigation offers the pause.** Polled (pushState fires no event); the
  session and its frozen denominator are kept, nothing is re-scanned, and the
  student chooses between pausing and continuing to count.
- **The resting homework bar is a `<button>`.** Approaching with a mouse opens
  the referee row, but the trio has to be reachable without one — spec §10's
  "never assume" posture applies to input, not only to speech.

### Consequences

- `PillState` gains `hwIdle` / `hwWork` / `hwTutor`; the surface slot gains
  `hwSummary`, `hwOpener`, `hwManual`, `hwNavigated`, `hwReaction`, `hwResume`.
  Every one of them enters and leaves through the existing single-surface
  machinery — no new stacking rules.
- The whole flow is `homework?: HomeworkTransports` on `Overlay` — optional, so
  omitting it leaves the shipped one-off tutor exactly as it was.
- The word "streak" in this feature means the longest run of problems completed
  without help **within one session**. It is not a day-streak and must not
  become one.
- Explicitly NOT built in slice 1, and not stubbed in ways that imply they
  exist: stuck detection / "raise hand", the other four sounds, all Studio
  dashboard changes, and every deferred display item (XP, levels, rings,
  badges, leaderboards).
