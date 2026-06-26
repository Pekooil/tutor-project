# Sprint 05 — AI integration (hardcoded profile)

## Goal
Make Calyxa **talk math**. By the end, a signed-in student opens the overlay,
types a math question, and gets a real Socratic answer back from Claude — with
**no provider key anywhere in the extension bundle**. The tutor runs on the
production system prompt (§2.5 pedagogy + hard rules) injected with a **hardcoded
dummy learning profile**; the live profile system and the learning model are not
built this sprint. This is the first sprint where a Claude call exists: a new
**server-side `/api/ai/turn` proxy** sits behind the same bearer auth + RLS the
session API established in Sprint 04, holds the `ANTHROPIC_API_KEY`, assembles the
prompt, and relays Claude's reply. The extension reaches it the only way it is
allowed to — overlay → content script → **background worker** (sole network-egress
context) → backend — so the client stays dumb and keyless.

This sprint is deliberately **text-only**. There is **no voice**: no Deepgram, no
ElevenLabs, no microphone, no VAD, no streaming-overlap pipeline, and **no
annotation rendering**. A "turn" is `{ student text } → Claude → { tutor text }`.
The overlay shell from Sprint 02 grows its first interactive surface — a text input
and a transcript — but the content script's **read-only DOM policy is untouched**:
the overlay still lives entirely inside its closed shadow root and reads nothing
from the host page. Page-context extraction is **not** wired in yet; the prompt's
page-context slot is left empty this sprint.

## Context
Sprint 04 delivered the **authenticated API proxy layer**: the extension signs in
through `/api/auth/token`, holds a Supabase user JWT only in
`chrome.storage.session` (background worker only), and calls `/api/session/*` with
`Authorization: Bearer <access_token>`; the backend rebuilds a request-scoped
Supabase client from that bearer so RLS evaluates every call as the caller
(`/web/lib/auth/bearer.ts`). The `sessions` lifecycle (start/end) and the atomic
free-tier gate exist; the overlay and content script were explicitly **out of
scope** in Sprint 04 and are still the Sprint 02 presentational shell.

This sprint adds the **AI tier** of the locked architecture on top of that proxy.
Three locked decisions from `/CLAUDE.md` drive it:
- **AI is the Anthropic Claude API via a server-side proxy (Sprint 05+).** The
  Claude call lives in `/web`, never the extension. The extension sends text to
  our backend and renders text back; it never sees the `ANTHROPIC_API_KEY`.
- **All API keys server-side; never in the extension bundle.** The new
  `ANTHROPIC_API_KEY` is a server-only env var (never `NEXT_PUBLIC_`), in exactly
  the same class as `SUPABASE_SERVICE_ROLE_KEY`. The bundle-grep gate from Sprint
  04 is extended to cover it.
- **DOM policy: content script reads only; overlay in shadow DOM.** The overlay
  becomes interactive but mutates nothing on the host page; it is still an additive
  `<calyxa-overlay>` shadow host (ADR-002).

### Reconciliation with `/docs/PLAN.md` sprint numbering (read before Task 1)
`/docs/PLAN.md` §2.10 **Sprint 3** is "AI integrated with a HARDCODED profile
(voice pipeline)" — it folds the **full STT→AI→TTS voice pipeline** (Deepgram, mic
capture + VAD, sentence-level streaming overlap, ElevenLabs) **and** annotation
JSON rendering into the same sprint as the first Claude call. The
`/docs/sprint-NN-plan.md` series is sequenced more finely (Sprint 04 was the API
proxy layer). This sprint deliberately takes **only the AI half** of PLAN §2.10
Sprint 3:
- it builds the **Claude proxy + §2.5 system prompt + hardcoded profile** and a
  **text** input→answer loop in the overlay, **and**
- it **defers the entire voice pipeline and annotation rendering** to a dedicated
  **voice sprint** (the next one), where they attach to this sprint's already-built
  prompt-assembly + proxy seam without reshaping it.

Splitting text-AI from the voice pipeline keeps this sprint's acceptance crisp
("type a question, get a math answer, no key in the extension") and means the
voice sprint is a focused latency/streaming problem against a Claude turn that
already works. This split is recorded in ADR-008 so it is not re-litigated.

### Hardcoded profile model (read before Tasks 2–3)
The system prompt's `{{LEARNING_PROFILE_SUMMARY}}` slot (§2.5) is filled this
sprint by a **fixed, server-side dummy profile** — a small set of concept mastery
levels, a couple of active misconceptions to watch for, and a low-confidence note —
defined once in `/web/lib/ai/profile.ts`. It is a **typed seam**, not a throwaway
string: it implements the same `LearningProfile` shape the live profile system will
later produce from query 1 (PLAN §2.3) + the §2.5 summariser. Swapping hardcoded →
live in the learning-connect sprint is then a change of **data source**, not of the
prompt-assembly or proxy code. The route never persists anything to the learning
tables (they do not exist yet) — there is **no DB write on an AI turn this sprint**.

### Output shape this sprint (read before Task 2)
§2.5 ultimately specifies a **single JSON object** (`say` + `annotations` +
`assessment`). This sprint emits **plain conversational text only** and instructs
the model accordingly. Reasons: (a) `annotations` need the content script's live
page extraction + the shadow-root SVG layer, both out of scope here; (b)
`assessment` only matters once it is persisted to drive the learning model, which
arrives later. The JSON envelope (and its incremental/streaming parse) is added in
the voice sprint alongside annotation rendering. Keeping output as text now avoids
building a JSON parser with no consumer. ADR-008 records this so the envelope is
not pre-empted.

### Conversation-history model (read before Tasks 5–6)
The `/api/ai/turn` proxy is **stateless**: it holds the system prompt and the key,
but no session memory (the worker is ephemeral; no interactions table exists yet).
The running transcript therefore lives in the **overlay** (the content script's
page-lifetime context), which sends the full `messages` array each turn. History is
**not** persisted and **not** held in the worker. This matches §2.5's "last 6–8
turns kept per turn" intent while keeping the backend stateless until the
learning-connect sprint adds `session_interactions`. (A running summary / token
budgeting is a voice-sprint concern; this sprint sends recent turns verbatim.)

## Execution model
A **single code session** owns this sprint end to end, worked **strictly in order
(1 → 7)**. The dependency chain is real: the system prompt + Claude client (Task 2)
must exist before the route (Task 3) can call them; the route must exist and be
tested (Task 4) before the extension (Tasks 5–6) has anything to call; end-to-end
verification (Task 7) is last. Respect the per-task **scope** lines as a focus
discipline (touch only the listed files), but it is one session — no handoff.

`/extension` is in scope, and this sprint — unlike Sprint 04 — **does** touch the
overlay and content script (`src/overlay/*`, `src/content/*`), because the text
chat UI is the headline deliverable. The popup is **not** touched (sign-in stays
exactly as Sprint 04 built it). The session start/end endpoints, the freemium gate,
and the auth plumbing are **not** modified.

## Files in scope

### Task 1 (planning / docs) creates or edits:
```
/docs/adr/ADR-008-claude-proxy.md            ← new — server-side Claude proxy; text-only now, JSON/voice deferred
/docs/adr/ADR-009-hardcoded-profile-seam.md  ← new — hardcoded profile as a typed seam for the live system
/CLAUDE.md                                     ← edit one line: Current sprint → Sprint 05
/docs/CLAUDE.md                                ← edit one line: Current phase → Phase 1, Sprint 5
/docs/sprint-05-plan.md                        ← this file
```

### Web — AI library (Task 2) creates / edits:
```
/web/lib/ai/profile.ts          ← new — LearningProfile type + the hardcoded dummy profile (the seam)
/web/lib/ai/system-prompt.ts    ← new — assemble §2.5 pedagogy+rules + injected profile summary + empty page slot
/web/lib/ai/claude.ts           ← new — Anthropic client; runTutorTurn({messages}) → {reply}; Haiku default
/web/.env.local.example         ← edit — document ANTHROPIC_API_KEY (server-only, never NEXT_PUBLIC_)
/web/package.json               ← edit — add @anthropic-ai/sdk dependency
```

### Web — proxy route (Task 3) creates:
```
/web/app/api/ai/turn/route.ts   ← POST {messages} → bearer auth → assemble prompt → Claude → {reply}
```

### Test (Task 4) creates:
```
/web/tests/ai-turn.test.ts      ← route test with a MOCKED Anthropic client: bearer required, prompt carries
                                   the hardcoded profile + math-only rule, reply relayed, no key leak
```

### Extension — AI transport (Task 5) creates / edits:
```
/extension/src/lib/api.ts            ← edit — add aiTurn(messages) via authorizedFetch (401→refresh→retry reused)
/extension/src/types/messages.ts     ← edit — add AI_TURN (→ background) + AI_REPLY payload types
/extension/src/background/index.ts   ← edit — handle AI_TURN → api.aiTurn → reply; SignedOutError → "not signed in"
```

### Extension — overlay chat UI (Task 6) creates / edits:
```
/extension/src/overlay/Overlay.tsx   ← edit — text input + transcript; calls an injected onSend transport prop
/extension/src/overlay/Overlay.css   ← edit — styles for the input + message list (still shadow-root-scoped)
/extension/src/overlay/mount.tsx     ← edit — thread the transport callback into <Overlay onSend=... />
/extension/src/content/index.ts      ← edit — provide the transport: sendMessage({type:'AI_TURN'}) → reply text
```

## Files explicitly out of scope
```
/extension/src/popup/*           (sign-in/launcher unchanged — Sprint 04 stays as-is)
/extension/wxt.config.ts         (host_permissions already include localhost:3000 from Sprint 04 — no change)
/web/app/api/session/*           (session lifecycle + freemium gate unchanged — Sprint 04)
/web/app/api/auth/*              (bearer/cookie auth unchanged — Sprint 04)
/web/lib/auth/bearer.ts          (reused as-is; the AI route imports it, does not change it)
/web/lib/tier/*                  (freemium gate unchanged)
/supabase/migrations/*           (NO migration this sprint — no new tables, no AI persistence)
/packages/*                      (shared /ai package extraction is deferred — see ADR-009)
```

Also out of scope this sprint (no pre-empting later work):
- **Voice / STT / TTS / mic / VAD / streaming overlap.** Deepgram, ElevenLabs, and
  the §2.5 latency pipeline land in the **voice sprint**. A turn is text→text.
- **Annotation rendering and the §2.5 JSON output envelope** (`annotations`,
  `assessment`). Output is plain text; the JSON envelope + incremental parse + the
  shadow-root SVG annotation layer are voice-sprint work.
- **Page-context extraction.** The content script stays **read-only and does not
  yet read page math** — the prompt's page-context slot is empty this sprint. (The
  extractor is its own deliverable; PLAN §2.6.)
- **The live learning profile + learning model + new tables.** No
  `knowledge_nodes`/`misconceptions`/`session_interactions`; no profile query, no
  post-turn assessment persistence, no scoring. The profile is hardcoded (ADR-009).
- **Model routing / escalation (Haiku → Sonnet → Opus).** One default model
  (Haiku 4.5) this sprint; the tiered router is a later concern.
- **Per-turn freemium/`degraded` branching.** The turn requires a signed-in bearer
  but is not metered per-turn this sprint; tying AI turns to the session counter +
  the `degraded` text-only branch is voice-sprint work.

Do not create any file not listed above. If something seems needed but is not
listed, add it to "What the next sprint needs to know" and ask before creating it.

---

## Task 1 — Claude-proxy + hardcoded-profile ADRs + sprint pointers (planning / docs)

Write two ADRs using the project's ADR format (match ADR-001…ADR-007 exactly):

```
## ADR-00N: [Title]
**Status:** Decided
**Context:** [why this needed a decision]
**Decision:** [what was chosen]
**Rationale:** [bullets — why]
**Consequences:** [Enables / Requires / Forecloses]
```

ADR-008 — Claude runs behind a server-side proxy; text-only this sprint:
- Context: the locked stack puts the AI behind a **server-side proxy only** and all
  keys server-side. The extension must never hold the `ANTHROPIC_API_KEY`. We also
  had to decide the **output shape** for the first AI sprint, given that the §2.5
  JSON envelope (`say`/`annotations`/`assessment`) has no consumer yet (no
  annotation layer, no persistence). Candidates for output: full §2.5 JSON now
  (rejected — parser with no consumer, and annotations need page extraction), or
  plain text now with the JSON envelope added when the voice/annotation sprint
  needs it.
- Decision: a new **`POST /api/ai/turn`** route in `/web` holds the
  `ANTHROPIC_API_KEY`, authenticates with the **Sprint 04 bearer** (`clientFromBearer`,
  401 if not signed in), assembles the §2.5 system prompt + the hardcoded profile,
  calls Claude (**`claude-haiku-4-5-20251001`**, the PLAN §2.1 default) via
  `@anthropic-ai/sdk` **server-side**, and returns **plain text** (`{ reply }`).
  The extension reaches it overlay → content script → **background worker** → backend.
  The **voice pipeline and the JSON envelope are deferred** to the voice sprint.
- Rationale (bullets): no provider key in the extension bundle; reuses the Sprint 04
  bearer/RLS seam instead of a second auth path; plain text avoids building a JSON
  parser with no consumer; one default model keeps the first AI turn simple; the
  worker stays the sole network-egress context.
- Consequences: Enables — a working text tutor and a stable prompt-assembly +
  proxy seam the voice sprint extends without reshaping. Requires — a server-only
  `ANTHROPIC_API_KEY` env var (never `NEXT_PUBLIC_`); the bundle-grep gate extended
  to cover it. Forecloses — any direct extension→Anthropic call; the
  `@anthropic-ai/sdk` is never imported in `/extension`.

ADR-009 — The learning profile is a hardcoded **typed seam** this sprint:
- Context: the §2.5 prompt needs a `{{LEARNING_PROFILE_SUMMARY}}`, but the live
  profile system (query 1 + summariser + the learning model + its tables) is a
  later sprint. We had to decide whether to stub the profile as a throwaway string
  or as a typed interface the live system later fills.
- Decision: define a `LearningProfile` **type** and a single hardcoded instance in
  `/web/lib/ai/profile.ts`; `system-prompt.ts` renders **any** `LearningProfile`
  to the summary block. This sprint passes the hardcoded one; the learning-connect
  sprint swaps the **data source** (query 1 → summariser) behind the same type with
  no change to prompt assembly or the route. Prompt-assembly stays in `/web/lib/ai`
  for now; extraction to a shared `/packages/ai` is deferred until the learning
  model needs to share scoring code across the API and tests.
- Rationale (bullets): a typed seam makes hardcoded→live a data-source swap, not a
  rewrite; keeping it in `/web/lib` avoids standing up workspace-package tooling for
  one sprint; the §2.5 summary shape (top-K weak/relevant nodes + active
  misconceptions + confidence note) is honoured now so the budget discipline is
  already in place.
- Consequences: Enables — a real Socratic prompt today and a clean swap-in later.
  Requires — the hardcoded profile to satisfy the same type the live summariser
  emits. Forecloses — nothing; defers `/packages/ai` extraction and the live
  profile/learning model to their own sprints.

Then make two one-line edits:
- /CLAUDE.md: change the "Current sprint" line to
    Sprint 05 — AI integration (hardcoded profile)
- /docs/CLAUDE.md: change "Current phase" from "Phase 1, Sprint 4" to
    "Phase 1, Sprint 5"

Do not change any other line in either CLAUDE.md.

Acceptance gate before Task 2:
  - ADR-008 and ADR-009 exist and follow the ADR format exactly.
  - Both CLAUDE.md sprint-pointer lines are updated and nothing else changed.

---

## Task 2 — AI library: system prompt + hardcoded profile + Claude client (web)

Scope: /web/lib/ai, /web/.env.local.example, /web/package.json. No route yet.

Add the SDK: `cd web && npm install @anthropic-ai/sdk` (a server dependency; it
must never be imported by anything that ships to the browser). Confirm the
installed major version and use its `messages.create` API in `claude.ts`.

/web/.env.local.example — add, in the **server-only** block alongside
`SUPABASE_SERVICE_ROLE_KEY`, with the same "never `NEXT_PUBLIC_`" warning:
```
# Server-only. The Claude proxy (/web/app/api/ai/turn) holds this; it must
# never reach the browser bundle or the extension (ADR-008, locked key policy).
ANTHROPIC_API_KEY=
```

/web/lib/ai/profile.ts:
  - `export type LearningProfile` — the typed seam (ADR-009). Mirror the §2.5
    summary inputs: an array of `{ conceptKey, mastery (0–1), state, confidenceBand }`
    nodes, an array of `{ conceptKey, category, description }` active misconceptions,
    and an overall `confidenceNote` string.
  - `export const HARDCODED_PROFILE: LearningProfile` — a small, realistic dummy
    (e.g. weak on `algebra.quadratics.factoring`, an active
    `sign_error.distribution` misconception, low overall confidence). Comment that
    the live profile system replaces this instance (not the type) in the
    learning-connect sprint.

/web/lib/ai/system-prompt.ts:
  - `export function buildSystemPrompt(profile: LearningProfile): string` —
    assemble the §2.5 prompt verbatim where it is static (the PEDAGOGY block, the
    HARD RULES — NEVER block including **math-only**), render the profile into the
    `STUDENT PROFILE` block as bounded one-line-per-node + active-misconceptions
    summary (top-K weak/relevant; honour the §2.5 truncation intent), and leave the
    `PAGE CONTEXT` block **empty with an explicit "(no page context this turn)"**
    note (extraction is out of scope). Override the §2.5 OUTPUT FORMAT block to
    instruct **plain conversational text only — no JSON, no markdown, no LaTeX
    read-aloud** (ADR-008); keep the "verbalize math naturally / one question at a
    time / under ~60 words unless explaining" guidance.

/web/lib/ai/claude.ts:
  - `export async function runTutorTurn({ messages }: { messages: TurnMessage[] }):
    Promise<{ reply: string }>` where `TurnMessage = { role: 'user' | 'assistant';
    content: string }`.
  - Construct the Anthropic client from `process.env.ANTHROPIC_API_KEY` (throw a
    clear server error if unset — never default to a placeholder). Call
    `messages.create` with `model: 'claude-haiku-4-5-20251001'`, the system prompt
    from `buildSystemPrompt(HARDCODED_PROFILE)`, a sane `max_tokens` (~600 per the
    §2.5 budget), and the passed `messages`. Return the assistant text as
    `{ reply }`. No streaming this sprint.

When done, list files created/edited and paste system-prompt.ts and claude.ts.

Acceptance gate before Task 3:
  - `cd web && npm run typecheck && npm run lint` pass.
  - `buildSystemPrompt(HARDCODED_PROFILE)` contains the math-only hard rule, the
    Socratic pedagogy block, the rendered hardcoded profile, and the plain-text
    output instruction; the page-context slot is explicitly empty.
  - `@anthropic-ai/sdk` is a normal dependency of `/web` and is imported only under
    `/web/lib/ai` (server code), never from any client component.

---

## Task 3 — Claude proxy route (web)

Scope: /web/app/api/ai/turn only.

/web/app/api/ai/turn/route.ts (POST { messages }):
  - `clientFromBearer(request)`; 401 `{ error: 'Not signed in.' }` if no user
    (same shape as `/api/session/start`). The bearer is required so the proxy is
    never anonymous and stays consistent with the Sprint 04 auth model — even
    though no DB write happens, an unauthenticated client must not be able to spend
    our Claude budget.
  - Parse and validate `messages`: a non-empty array of `{ role: 'user' |
    'assistant', content: string }`, last message `role: 'user'`, bounded length
    (cap the count and per-message size to keep the token budget sane; 400 on a bad
    shape). Math-only is enforced by the **system prompt**, not the route — the
    route does not classify content.
  - Call `runTutorTurn({ messages })`; return `{ reply }` (200). Map an SDK/key
    failure to a 502 `{ error: 'Tutor is unavailable right now.' }` (do **not** leak
    the provider error text or any key material to the client).
  - **No DB write** — the learning tables do not exist yet (ADR-009). Accept an
    optional `sessionId` in the body for forward-compat but ignore it this sprint.

The route holds the only `ANTHROPIC_API_KEY` reference path (via claude.ts); the
client cannot influence the system prompt or model. When done, list the file and
paste route.ts in full, and state explicitly that (a) the key is read only
server-side inside claude.ts, (b) the route writes nothing to the database.

Acceptance gate before Task 4:
  - `next build`, typecheck, lint pass.
  - With a valid bearer + `messages: [{role:'user', content:'How do I factor
    x^2+5x+6?'}]`, the route returns `{ reply }` with a non-empty Socratic math
    response. A non-math question is redirected by the tutor (per the prompt), not
    answered.
  - No-bearer / garbage-bearer call → 401. Malformed `messages` → 400.
  - The provider error text / key never appears in any client-visible response.

---

## Task 4 — AI-turn route test with a mocked Claude client (acceptance gate)

Scope: /web/tests. This is the sprint's automated guarantee that auth gating and
prompt assembly are correct **without** spending a live Claude call or needing a
real key in CI.

Create /web/tests/ai-turn.test.ts (vitest, the runner Sprints 03–04 used). **Mock
`@anthropic-ai/sdk`** (or `/web/lib/ai/claude.ts`) so no network call is made and
the test is deterministic. Assert:
1. **Bearer required:** a request with no/invalid bearer is rejected (401) and the
   mocked Claude client is **never called** (no budget spent on anonymous callers).
2. **Prompt carries the contract:** capture the `system` + `messages` passed to the
   mocked client and assert the system prompt contains the **math-only hard rule**,
   the **Socratic pedagogy** block, and the **hardcoded profile** (e.g. the dummy
   misconception category), and that the page-context slot is empty.
3. **Reply relayed:** with the mock returning a known string, the route responds
   `{ reply: <that string> }`.
4. **Bad input:** malformed `messages` (empty array, wrong roles, last role not
   `user`) → 400, mock not called.
5. **Provider failure is sanitised:** make the mock throw; assert a 502 whose body
   contains **no** key material and **no** raw provider error text.

Wire it into the `web` workspace `test` script (already `vitest run`). When done,
paste the test and its passing output.

Acceptance gate before Task 5:
  - The test passes: anonymous callers are 401'd before any model call; the system
    prompt provably carries the math-only rule + hardcoded profile; replies relay;
    provider failures are sanitised.
  - No live Anthropic call is made (the SDK is mocked); the suite runs with no real
    `ANTHROPIC_API_KEY`.

---

## Task 5 — Extension AI transport: api + messages + background

Scope: /extension/src/lib/api.ts, /extension/src/types/messages.ts,
/extension/src/background/index.ts.

/extension/src/lib/api.ts — add (do not change the existing auth/session helpers):
  - `export async function aiTurn(messages: TurnMessage[]): Promise<string>` —
    `authorizedFetch('/api/ai/turn', { method:'POST', ... body: { messages } })`,
    reusing the existing **401 → refresh once → retry** path verbatim; on a non-OK
    response throw `Error(body.error ?? ...)`; on success return `body.reply`. A
    dead refresh token surfaces `SignedOutError` exactly as the session helpers do.

/extension/src/types/messages.ts — extend the `MessageType` union with:
  - `AI_TURN` (overlay → content → background; payload: `{ messages: TurnMessage[] }`)
  - `AI_REPLY` (background → caller; payload: `{ reply: string } | { error: string }`)
  Add the `TurnMessage` type and the two payload types. Keep all existing types.
  Note in the comment block that `AI_TURN` carries the running transcript from the
  overlay (the worker is stateless; ADR-008 history model).

/extension/src/background/index.ts — in the **async** message listener (the one
that already `return true`s — handler (4b)), add an `AI_TURN` case:
  - re-read nothing token-ish itself; call `api.aiTurn(payload.messages)` (which
    reads `chrome.storage.session` fresh, per the ephemeral-worker discipline) and
    `sendResponse` an `AI_REPLY` with `{ reply }`; on `SignedOutError` reply
    `{ error: 'not signed in' }` (the exact text the overlay shows as "sign in via
    the popup"); on any other error reply `{ error: <message> }`. Return `true` for
    this case like the others. Do **not** touch the synchronous logging listener
    (handler (3)) — it must keep returning `false`.

When done, list files edited and paste the `aiTurn` helper and the `AI_TURN`
background case.

Acceptance gate before Task 6:
  - `cd extension && npm run typecheck` passes; `wxt build` exits 0.
  - `aiTurn` reuses `authorizedFetch` (one refresh + retry on 401); it does not
    import `@anthropic-ai/sdk` or any key.
  - The `AI_TURN` handler lives in the async listener and returns `true`; the
    logging listener is unchanged.

---

## Task 6 — Overlay text chat UI + content-script transport

Scope: /extension/src/overlay/*, /extension/src/content/index.ts.

/extension/src/overlay/Overlay.tsx — grow the Sprint 02 placeholder into a minimal
text chat, **presentational only** (it still knows nothing about `chrome.*`):
  - Props: `onSend(messages: TurnMessage[]): Promise<string>` — the transport,
    injected by the content script via mount.
  - State: the running transcript (`TurnMessage[]`) held in React state (the
    overlay/content context lives for the page's lifetime — the right home for
    history, per the ADR-008 history model). A text input + send button; on submit,
    append the user turn, call `onSend(history)`, append the assistant reply (or, on
    an `'not signed in'` error, show "Sign in from the Calyxa popup to start"). A
    busy state disables the input mid-turn.
  - Render the transcript above the input. No mic, no audio, no annotations.

/extension/src/overlay/Overlay.css — add styles for the message list + input,
still inside the shadow root (typography on `.mm-overlay`/children, never `:host`,
per the ADR-002 note already in this file). Keep the fixed bottom-right panel.

/extension/src/overlay/mount.tsx — thread the transport: `mountOverlay(container,
onSend)` renders `<Overlay onSend={onSend} />`. Keep React mounting here so the
content script never imports react-dom.

/extension/src/content/index.ts — provide the transport when building the overlay:
a function that does `chrome.runtime.sendMessage({ type:'AI_TURN', payload:{
messages } })`, reads the `AI_REPLY` response, and returns `reply` (or throws on
`{ error }`). Pass it into `mountOverlay` in the `onMount` callback. **Do not**
add any host-page read — the DOM policy is unchanged; the content script still only
relays messages and owns the shadow-root overlay.

When done, list files edited and describe the type → send → reply → render flow
(overlay → content `sendMessage` → background `AI_TURN` → `api.aiTurn` → backend →
`reply` → overlay).

Acceptance gate before Task 7:
  - `wxt build` exits 0; typecheck passes.
  - Loading the unpacked extension and opening the overlay (Ctrl+Shift+Y), a text
    input is present; submitting a math question renders the tutor's reply in the
    transcript.
  - The overlay imports no `chrome.*` and no key; the content script adds **no**
    host-page DOM read (git diff shows only messaging + the transport wiring).

---

## Task 7 — End-to-end manual verification (manual)

This is the sprint's headline acceptance criterion: **a student can type a math
question and get a math answer, with no API key in the extension.**

With `cd web && next dev` running (`ANTHROPIC_API_KEY` set in `/web/.env.local`)
and the unpacked extension loaded:
  1. Open the popup → sign in with a Sprint 03/04 test account (sign-in unchanged).
  2. On any page, open the overlay (Ctrl+Shift+Y). Type "How do I factor
     x² + 5x + 6?" → the tutor replies with a **Socratic** nudge (a guiding
     question / small step), **not** the final factored answer.
  3. Ask a follow-up ("what two numbers multiply to 6 and add to 5?") → the reply
     uses the prior turns (history is sent each turn) and stays on the problem.
  4. Ask something **non-math** ("what's the weather?") → the tutor warmly
     redirects to math (math-only hard rule fired).
  5. Sign out from the popup → in the overlay, sending a turn now shows "not signed
     in" / sign-in prompt; no anonymous Claude call succeeds (the route 401s).
  6. Confirm `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, the anon key, and any
     `SUPABASE_`/`ANTHROPIC` string appear **nowhere** in the built
     `/extension/dist` output (grep the built bundle — none may be present); the
     extension holds only user tokens.
  7. Confirm the host page is byte-for-byte unchanged apart from the
     `<calyxa-overlay>` shadow host (DOM-diff / inspect): the chat UI lives entirely
     in the shadow root; the content script reads nothing from the page.

---

## Acceptance criteria (full checklist)

- [ ] `npm install` and `turbo run typecheck lint build` pass from the repo root
      with the new web files and extension changes present
- [ ] `cd web && next build` exits 0; `wxt build` exits 0
- [ ] **No migration this sprint**: `/supabase/migrations` is unchanged; an AI turn
      writes nothing to the database
- [ ] `@anthropic-ai/sdk` is a `/web` server dependency, imported only under
      `/web/lib/ai`; it is never imported in `/extension`
- [ ] `ANTHROPIC_API_KEY` is server-only (never `NEXT_PUBLIC_`), documented in
      `/web/.env.local.example`, and read only inside `/web/lib/ai/claude.ts`
- [ ] `/api/ai/turn` requires a valid bearer (401 otherwise) and never makes a
      Claude call for an anonymous caller; malformed `messages` → 400; provider
      failure → sanitised 502 with no key/error leakage
- [ ] The system prompt carries the §2.5 Socratic pedagogy + the math-only hard
      rule + the hardcoded profile; the page-context slot is explicitly empty
- [ ] Output is plain conversational text (no JSON envelope, no annotations) per
      ADR-008
- [ ] The mocked-Claude route test passes (auth gate, prompt contract, reply relay,
      bad input, sanitised failure) with no live Anthropic call
- [ ] The extension sends overlay → content → background → `/api/ai/turn` (worker is
      the only egress); a 401 triggers one refresh + retry; no key in the bundle
- [ ] The overlay renders a working text chat; non-math is redirected by the tutor;
      signed-out turns show "not signed in"
- [ ] `/extension/src/popup/*`, `/web/app/api/session/*`, `/web/app/api/auth/*`, and
      `/web/lib/auth/bearer.ts` are untouched
- [ ] Host page unchanged apart from the `<calyxa-overlay>` shadow host (no host-DOM
      read added)
- [ ] ADR-008 and ADR-009 exist; both CLAUDE.md sprint pointers updated
- [ ] git log shows commits for this sprint's tasks

---

## Risks

**Anthropic key creeping toward the client.** The easy wrong path is importing
`@anthropic-ai/sdk` (or referencing `ANTHROPIC_API_KEY`) from a client component or
the extension. Mitigation: the SDK and key live only under `/web/lib/ai` (server);
the extension imports neither (ADR-008); Task 7 greps the built `/extension/dist`
for `ANTHROPIC`/`SUPABASE_` strings — none may appear.

**Building the voice pipeline / JSON envelope by reflex.** PLAN §2.10 Sprint 3
bundles voice + annotations with the first Claude call; it is tempting to pull them
in. Mitigation: ADR-008 and the out-of-scope list fix the line at **text-only,
plain-text output**; Deepgram/ElevenLabs/mic/VAD/streaming/annotations are the
voice sprint. A turn is `text → Claude → text`.

**Anonymous or unmetered Claude spend.** An ungated proxy lets anyone spend our
Claude budget. Mitigation: `/api/ai/turn` requires the Sprint 04 bearer (401
otherwise) and the route test asserts the model is never called for an anonymous
request. (Per-turn freemium metering is deferred but the proxy is never anonymous.)

**Leaking provider errors / keys in responses.** Forwarding the raw Anthropic error
can expose internals. Mitigation: the route maps SDK/key failures to a generic 502
with no provider text; the test asserts the sanitised body.

**Stateless proxy + history in the wrong place.** Holding transcript in the
ephemeral worker would lose it on a wake; persisting it needs tables that do not
exist yet. Mitigation: history lives in the overlay (page-lifetime context) and is
sent each turn; the proxy stays stateless (ADR-008 history model).

**Touching the overlay breaks the read-only DOM policy.** Making the overlay
interactive risks reaching into the host page. Mitigation: the overlay stays
presentational inside its closed shadow root; the content script adds **no** host
read (only messaging); Task 7's DOM-diff confirms only `<calyxa-overlay>` is added.

**Hardcoded profile hard to swap later.** A throwaway string would force a rewrite
when the live profile lands. Mitigation: the profile is a **typed seam** (ADR-009);
hardcoded→live is a data-source swap behind `LearningProfile`, not a prompt rewrite.

**MV3 listener return-value trap (carried from Sprint 04).** The `AI_TURN` handler
calls `sendResponse` asynchronously, so it must live in the async listener that
returns `true`; the synchronous logging listener must keep returning `false`.
Mitigation: add the case only to the existing async listener; do not flip the
logging one (the comment in `background/index.ts` explains why a stray `true` hangs
the sender).

---

## What the next sprint needs to know

**The AI tier is live and keyless on the client.** A signed-in extension can hold a
text math conversation with Claude through a single server-side proxy; the next
sprint adds **voice** on top of this seam, it does not rebuild it.
- **Proxy (ADR-008):** `/web/app/api/ai/turn` holds the `ANTHROPIC_API_KEY`,
  bearer-auths via `clientFromBearer`, assembles the §2.5 prompt in
  `/web/lib/ai/system-prompt.ts`, and calls `claude.ts` (default
  `claude-haiku-4-5-20251001`). The **voice sprint** swaps the response from plain
  text to the §2.5 **JSON envelope** (`say`/`annotations`/`assessment`), adds
  **streaming** + sentence-level TTS overlap (Deepgram/ElevenLabs), and the
  shadow-root **annotation layer** — all attaching to this prompt-assembly seam.
- **Profile (ADR-009):** the prompt is fed a hardcoded `LearningProfile`
  (`/web/lib/ai/profile.ts`). The **learning-connect sprint** swaps the data source
  to query 1 + the §2.5 summariser behind the same type, and begins persisting the
  model's `assessment` to `session_interactions` (a table that arrives with the
  learning model + its migration + RLS).
- **History:** the overlay holds the running transcript and sends it each turn; the
  proxy is stateless. The next sprint that adds persistence (and a rolling summary /
  token budget per §2.5) moves history into `session_interactions`.

**Deferred to later sprints (deliberately not built):**
- Voice / STT / TTS / mic / VAD / streaming-overlap pipeline and annotation
  rendering + the §2.5 JSON output envelope — the **voice sprint**.
- Page-context extraction (PLAN §2.6) — the content script still reads nothing; the
  prompt's page slot is empty until the extractor lands.
- The live learning profile, the learning model (FSRS scoring/scheduling,
  misconception detection), cold start, and their tables — the learning sprints.
- Model routing/escalation (Haiku → Sonnet → Opus) and per-turn freemium/`degraded`
  metering tied to the session counter.
- Extraction of prompt-assembly into a shared `/packages/ai` (deferred until shared
  scoring code needs it).
