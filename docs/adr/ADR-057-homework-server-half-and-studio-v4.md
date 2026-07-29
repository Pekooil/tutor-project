## ADR-057: Homework sessions get a server mirror so Studio v4 can read them; stuck detection is local, personal, and asks before it interrupts

**Status:** Proposed

**Context:** [[ADR-056]] shipped the v4 homework session local-first: the
extension owns the live set in `chrome.storage.local`, and a tap is acknowledged
in under 100ms whether or not anything else is reachable. Two pieces were
deferred out of that slice and are built here — the design handoff's **stuck
detection** ("raise hand"), and the **Studio v4** web views.

The second one forced the first architectural decision below. Studio v4's
dashboard is built entirely around homework sessions: the resume card, the
latest-set summary with its problem-by-problem timeline, and the History view's
homework rows with tutoring nested inside them. None of that is buildable from
data that only exists in one browser profile's local storage. So the server half
deferred in ADR-056 stopped being a deferral and became a dependency.

---

### Decision 1 — The server table is a MIRROR, never the source of truth

`homework_session` (migration 0029) is RLS-scoped Shape 2, FK-cascading to
`users`, on the export list, and asserted in `web/tests/account.test.ts` — the
Sprint 16 invariant every user-scoped table carries.

What makes it a mirror rather than a store:

- **The extension never waits on it.** `syncSession` fires on set COMPLETION and
  on PAUSE, and never on a tap. A tap touching the network at all would put the
  spec's 100ms visible-reaction budget behind a round trip.
- **The client mints the id**, and it is the primary key. That is what makes the
  sync idempotent: a set syncs on completion and again on every pause, and must
  upsert rather than pile up rows. A client-chosen PK is safe because RLS scopes
  every write to the caller — the worst a bad client can do is collide with its
  own prior row, which is the intended upsert.
- **Failure is invisible.** The background relay swallows everything and replies
  with the ids the server actually accepted; the content script clears exactly
  those from a bounded local queue and retries the rest on the next pause or
  completion. A student mid-set can never feel a failed sync.
- **One bad entry never costs the batch.** `parseSyncBody` drops malformed
  sessions and keeps the rest — a single corrupt row in a retry queue must not
  cost the student every other set in it.

`problems` is `jsonb`, not a child table: the array is written once, read whole
(both the timeline and "Where the time went" want all of it), never queried
across rows, and must stay atomic with its session — a half-written timeline is
worse than no timeline. Same reasoning as `study_artifact.payload`.

**Privacy:** `location_hash`, never a plaintext URL (the `sessions.page_url_hash`
discipline, restated by ADR-047 for the dashboard). `title` IS stored in the
clear, as a considered exception — the resume card reads "Stoichiometry
worksheet — paused at 5 of 8", which is unbuildable from a hash, and it is the
same class of data as `sessions.detected_topic`. **No problem text crosses this
boundary**: snippets stay local, for the tutoring handoff only.

### Decision 2 — Stuck detection is local, personal, and refusable

The design says: after N silent minutes (N personal, from pace data) the pill
asks **one question, not the answer**; gentle and refusable.

- **N is personal.** A constant is wrong in both directions — 4 minutes is
  nothing on a proof and an eternity on mental arithmetic. N is 2.5× the
  student's own observed pace: this session's median first, their history's
  average second, a wide default only when there is neither, clamped to
  [3 min, 12 min] so it can be neither nagging nor useless. `tutored` problems
  are excluded from the median, because a problem that took 11 minutes *because
  Calyxa was walking them through it* says nothing about how long they work
  alone.
- **A decline sticks.** Never re-offered on that problem, and the threshold
  widens to its ceiling for the rest of the set. A resumed set gets the safety
  net back — a decline said "not right now", and "now" was hours ago.
- **Zero model calls before acceptance**, which is spec §10's hard rule. This is
  the one deliberate deviation from the prototype: it renders the question
  inside the card ("One question: what do both terms share?"), which would mean
  billing a model call for every student who was merely thinking — most of them.
  Instead the offer *promises* exactly one question and no answer, and the
  tutor's opening turn delivers it. From the student's side the contract is
  identical; it just costs nothing when they say no.
- Accepting routes into the **existing** tutoring handoff — the same path the
  "Stuck" tap uses. Nothing parallel.

### Decision 3 — Studio v4 is a view change, not a shell change

The shell the handoff describes — 64px icon rail, 60px top bar, four
destinations — already shipped, and the four destinations were already
Dashboard / Notes / Progress / History. So v4 is what those views SHOW:

- **Dashboard** gains the resume card and the latest-set summary with its
  proportional timeline, both ahead of Today's Review (an unfinished set is the
  real answer to "what do I do right now").
- **Session summary detail** is a new route, `/sessions/homework/[id]`.
- **History** changes unit: a homework set is the row, the tutoring it contained
  is nested inside it, and a tutoring session that belonged to no set is
  relabelled **Quick help** — which is what it actually is. Listing them flat
  told the student nothing about the shape of an evening.
- **Removed, per the handoff:** the "Already done" / "Coming up" schedule
  columns (they restated the strip directly above them, and were the main
  reason that card dominated the page), and every remaining red/danger chip →
  amber. An overdue review is attention, not failure.

### Decision 4 — Homework outcomes get their own fill tokens

`--studio-outcome-{ok,shaky,tutored}` plus matching inks, added to the
`.cx-app.cx-studio` block. A deliberate deviation from the handoff, which names
the existing INK tokens as the timeline's segment fills.

Those inks are wildly uneven in lightness in LIGHT mode (`--studio-green-dot`
#4ade80 is pale, `--studio-amber-ink` #92400e is near-brown), so a numbered
timeline filled with them rendered as three unrelated materials with one
illegible label — verified in the browser, not predicted. The ORDINAL chip tints
were the other candidate and are far too faint (8–9% alpha) to encode anything
in a chart segment. The new pairs are pastel fill + dark ink and are
**identical in both themes** — a pastel is light against any page background —
measured at 6.49:1 / 5.70:1 / 8.02:1, all AA.

There is no `incorrect` member and there must never be one.

### Consequences

- Migration 0029 is applied live. `homework_session` is on the export list and
  covered by the erasure cascade; `web/tests/account.test.ts` asserts both.
- The `/privacy` + Chrome data-safety disclosure (ADR-046) must add homework
  sessions — problem labels, outcomes, durations, a hashed page id, and the
  worksheet title — as a persisted data type before this reaches students. Same
  handoff every prior persisted-data ADR carried.
- The dashboard's homework reads are **fail-soft**: they are additive to a page
  that stood on its own before them, so a read failure costs the two blocks and
  nothing else.
- Nothing here reads a LIVE set. The dashboard's resume card reflects the last
  PAUSE, not second-by-second progress, and it says so ("Open Calyxa on the same
  page"). The web app cannot resume a set — the set lives on the homework page —
  so it points rather than pretending to be a control.
