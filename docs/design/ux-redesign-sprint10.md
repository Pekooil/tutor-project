# Sprint 10 — UX audit + redesign spec

**Status: spec, no code.** This is what Tasks 6–7 implement. Every redesign below maps directly to
either a `@calyxa/ui` primitive (overlay, popup) or a shadcn component (login/signup/account) — if a
proposed element doesn't map to Task 3/5's component set, it isn't in this spec.

## Cross-surface rules (read before any per-surface section)

- **No behavior/logic change, anywhere.** Every form posts to the same endpoint with the same body;
  every disabled condition, every error string sourced from server/`describeError`, every message
  contract (`CalyxaMessage`/`TurnMessage`/`AiTurnPayload`, etc.) is unchanged. Where this spec adds a
  *new* small piece of copy (there are exactly two, both flagged inline below — §3 signup's
  consent-disabled hint and §5 account's empty-profile message), it is presentational text for an
  **already-possible state**, not a new rule, field, or condition.
- **One header language.** Overlay and popup both get a small logomark + "Calyxa" text-label header
  (plain text in the system-font stack — this is a UI label, not an execution of the brand
  *wordmark*, so it does not need the SVG wordmark asset; see `/docs/brand.md` §3). Login/signup/
  account share the logomark+wordmark lockup (the actual SVG asset, since `/web` can use the real
  brand font) above or inside the auth card / dashboard header.
- **Focus-visible + `aria-live` are added everywhere uniformly.** None of the five surfaces currently
  define visible focus styling beyond the browser default, and none of the async-update regions
  (overlay transcript, popup state swap, form errors) are wired to `aria-live`. This is the single
  biggest AA gap across all five and is called out once here rather than five times below.
- **The overlay gets no new dismiss/close button.** Open/close is exclusively the existing keyboard
  shortcut, handled in `extension/src/content/index.ts` (outside Task 6's scope: `Overlay.tsx`,
  `Overlay.css`, `mount.tsx`, popup). Adding an in-panel close affordance would require new
  content-script wiring — out of scope. Confirmed not part of this redesign.
- **No new routes, no new fields, no new messages.** Every state below is reachable today from the
  existing component state/props; this spec only changes how each state is laid out and styled.

---

## 1. Overlay (`extension/src/overlay/Overlay.tsx`)

### Current friction
- No brand anchor inside the panel — nothing visually says "this is Calyxa" once it's open.
- Four different system messages — page-context chip, error `notice`, the `playing` indicator, and
  the `latency` readout — are all separate `<p>` tags with separate ad hoc styling, competing
  visually with actual tutor/student messages in the same scroll region.
- The latency trace (`stt … · ai … · tts …`) is QA instrumentation rendered with the same visual
  weight as conversation content — clutters the transcript for an end user.
- No single "what's happening right now" indicator — busy/recording/playing are each signaled only
  by their own small, separate cue (mic button color, a `🔊 Speaking…` line), not one coherent status
  slot.
- Empty state is one muted italic line with no visual invitation.
- No visible focus ring on the input, mic, or send button (browser default only) — fails the AA
  target.
- No `aria-live` region — a screen-reader user is told nothing when a reply, error, or status change
  arrives.

### Redesigned layout

```
┌─────────────────────────────────────┐
│ [mark] Calyxa                        │  ← header: logomark (decorative,
├─────────────────────────────────────┤    aria-hidden) + "Calyxa" label
│ [status slot — exactly one of:]      │
│  · page-context chip (idle default)  │  ← ONE slot, one visual language,
│  · "Recording…" (mic held)           │    replaces 3 separate ad hoc lines
│  · "Thinking…" (busy/sending)         │
│  · "🔊 Speaking…" (playing)           │
│  · error notice (danger-styled)       │
├─────────────────────────────────────┤
│                                       │
│   transcript (scrollable)            │  ← more vertical room; empty state
│   user / assistant bubbles            │    gets the logomark + existing
│                                       │    copy, not just an italic line
│                                       │
├─────────────────────────────────────┤
│ [▸ turn timing]  ← collapsed, small  │  ← latency demoted: present, not
├─────────────────────────────────────┤    deleted, just out of the chat flow
│ [ text input ] [mic] [Send]          │
└─────────────────────────────────────┘
```

### Interaction flow (unchanged transports, restyled states)
1. Panel opens (existing keyboard shortcut, untouched) → status slot shows the page-context chip
   (`pageContextSummary`) exactly as today; transcript shows the empty state if no messages yet.
2. Text turn: type → Send → status slot switches to "Thinking…" (replaces the bare `busy` disabling
   of the input with a visible state, same `busy` boolean) → reply appends to transcript → status
   slot reverts to the page-context chip, or to the error notice if `onSend` rejected.
3. Voice turn: mic press → status slot shows "Recording…" (mirrors today's `mm-mic--recording`
   pulse, now reduced-motion-aware) → release → status slot shows "Thinking…" through the
   transcribe→AI→synthesize chain (unchanged sequence) → "🔊 Speaking…" during playback → reverts to
   the page-context chip after, or to the error notice on any leg's failure (same
   `describeError`-sourced text, same partial-success wording when the reply lands but TTS fails).
4. Any notice clears on the next successful submit, exactly as `setNotice(null)` already does today.

### State set
| State | Status slot | Transcript | Input row |
|---|---|---|---|
| Empty / idle | page-context chip (detected or "no equations" copy, verbatim) | empty-state line + logomark | enabled |
| Busy (text turn sent) | "Thinking…" | unchanged, shows history so far | input + send disabled (existing `busy`) |
| Recording | "Recording…" (pulse, reduced-motion-safe) | unchanged | mic shows pressed/recording style |
| Playing | "🔊 Speaking…" (verbatim copy) | shows the just-added reply | input + send disabled |
| Error / notice | danger-styled notice (verbatim `describeError` text) | unchanged | re-enabled once `busy` clears |
| Disabled (general) | — | — | input/mic/send disabled per existing `busy`/`recording` logic, now with a visible (not just default) disabled style |
| Success / steady | page-context chip | full history, latest reply visible | enabled |

### Primitive mapping
Header → `Card` (or a bare styled `div`, decision left to Task 6) + logomark SVG; status slot →
`Card`-on-`Card` small banner using `--color-accent-subtle`/`--color-danger` tokens by state;
mic/send → `Button` (variant: icon for mic, primary for send); text input → `Field`'s input styling
(no label needed — placeholder serves as the accessible name via `aria-label`, already implied by
the existing `placeholder`); recording pulse / "Thinking…" → `Spinner` (reduced-motion-safe,
replacing the current CSS `@keyframes mm-mic-pulse` with the shared token-driven animation, or
keeping the pulse but gating it on `prefers-reduced-motion` — Task 6's call, either satisfies Task
8/9's reduced-motion gate).

---

## 2. Popup (`extension/src/popup/main.tsx`)

### Current friction
- `<h1>Calyxa</h1>` is the only branding — no logomark, no visual identity matching the overlay.
- Sign-in error and the free-tier "degraded" hint are both plain `<p>` tags distinguishable only by
  class — no hierarchy.
- All buttons (Sign in, Start tutor, End session, Sign out) look identical — "Sign out" (low-priority,
  semi-destructive) carries the same visual weight as "Start tutor on this page" (the primary action).
- "Loading…" is unstyled centered-nowhere text.
- No visible focus styling on either input.

### Redesigned layout

```
Signed out:                         Signed in:
┌──────────────────────┐            ┌──────────────────────┐
│ [mark] Calyxa          │            │ [mark] Calyxa          │
├──────────────────────┤            ├──────────────────────┤
│ Email    [________]    │            │ Signed in as a@b.com   │
│ Password [________]    │            │ [free-tier badge:       │
│ (error banner, if any) │            │  "3 sessions left" or   │
│ [   Sign in   ]        │            │  "Free limit reached —  │
└──────────────────────┘            │   this one's on us"]   │
                                     │ (error banner, if any) │
                                     │ [ Start/End — primary ] │
                                     │ [ Sign out — secondary ]│
                                     └──────────────────────┘
```

### Interaction flow
1. Popup mounts → `GET_STATE` (unchanged) → while awaiting, show a `Spinner` + "Loading…" (same
   string, now paired with a primitive instead of bare text) instead of a blank/empty popup.
2. Signed out: fill email/password → Sign in → button shows busy label, same `busy` gate on the
   single button; on failure the existing `state.error` renders in a danger-styled banner instead of
   a plain `<p>`.
3. Signed in, no active session: "Start tutor on this page" is the single primary action; Sign out is
   present but visually secondary.
4. Signed in, active session: button swaps to "End session" (same condition, `activeSession` truthy);
   the remaining-sessions/degraded hint renders as a small badge — info-styled for a normal count,
   warning/accent-styled for the degraded ("on the house") case — same two source strings, just
   visually distinguished instead of both being plain muted text.
5. Sign out always available, always secondary-styled, regardless of session state.

### State set
| State | What renders | Notes |
|---|---|---|
| Loading | Spinner + "Loading…" | before first `GET_STATE` reply |
| Signed out, idle | email/password Fields + primary Button | |
| Signed out, error | + danger banner (verbatim `state.error`) | |
| Signed out, submitting | Button busy/disabled | existing `busy` |
| Signed in, no session | status line + primary "Start tutor" Button + secondary "Sign out" | |
| Signed in, active session (normal) | + info badge "`N` sessions left" | verbatim existing string |
| Signed in, active session (degraded) | + warning badge "Free limit reached… on the house" | verbatim existing string |
| Signed in, error | + danger banner (verbatim `state.error`) | e.g. a failed start/end |
| Disabled (general) | every button disabled together | existing single shared `busy` flag — kept as is, not split into per-button busy state |

### Primitive mapping
Header → logomark + "Calyxa" label, same pattern as the overlay; email/password → `Field`; all
buttons → `Button` (`variant="primary"` for Sign in / Start / End, `variant="secondary"` or
`"ghost"` for Sign out); error → a danger-toned banner built from `Card` + token colors; free-tier
hint → a small badge (no dedicated `Badge` primitive is in Task 5's list — build it as a `Card`
with `--text-xs` and accent/warning token coloring, or flag to Task 5 if a true `Badge` primitive
turns out to be needed; not adding a new primitive file preemptively here).

---

## 3. Login (`web/app/login/page.tsx`)

### Current friction
- Entirely unstyled (`<main><h1>` defaults, no layout, no card, no spacing system).
- Error is a bare `<p role="alert">` — correct ARIA already, zero visual treatment.
- No branding.

### Redesigned layout

```
┌───────────────────────────────┐
│        [logomark+wordmark]      │
│                                  │
│   ┌───────────────────────┐    │
│   │  Log in                 │    │
│   │  Email    [__________]   │    │
│   │  Password [__________]   │    │
│   │  (error banner, if any)  │    │
│   │  [     Log in      ]    │    │
│   └───────────────────────┘    │
│                                  │
│   Need an account? Sign up      │
└───────────────────────────────┘
```
Centered single-column auth card — same shell pattern signup reuses in §4 (one layout, not two).

### Interaction flow
Identical to today: submit → POST `/api/auth/login` (unchanged body/endpoint) → on failure, render
`body.error` (verbatim) in a styled alert; on success, `router.push('/account')` — same navigation,
no separate success UI (the page is left before any "success" state could render).

### State set
| State | What renders |
|---|---|
| Idle | Email/Password Fields, enabled Button |
| Submitting | Button shows "Logging in…", disabled (existing `submitting`) |
| Error | styled alert with verbatim `body.error ?? 'Login failed.'` |
| Success | n/a — immediate navigation, nothing to design |

### Component mapping
shadcn `Card` (auth shell) + `Form`/`Input`/`Label` (email, password — `id`/`htmlFor` association
replacing the current implicit `<label>Email<input/></label>` nesting, same submitted values) +
`Button` + an `Alert`-pattern for the error (shadcn doesn't ship a dedicated `Alert` by default in
every preset — add it via the shadcn CLI in Task 7 if not already present, themed by
`--color-danger`).

---

## 4. Signup (`web/app/signup/page.tsx`)

### Current friction
- Same unstyled baseline as login, plus:
- The under-13 advisory (`looksUnder13`) is a bare `<p>` with no visual distinction from the consent
  paragraph beside it — easy to misread as a generic disclaimer rather than a real eligibility steer
  (the real gate is server-side per ADR-004; this client-side line is advisory only, and the redesign
  must keep it exactly that — advisory, not a new client-side submit block).
- The consent checkbox is glued to the front of a long legal-style paragraph — no visual separation
  between the required action (the checkbox) and the surrounding informational copy.
- The submit button simply does nothing when `!consent` — no visible explanation near the button.
- Credentials and eligibility/consent fields are one flat list with no grouping.

### Redesigned layout

```
┌───────────────────────────────┐
│        [logomark+wordmark]      │
│   ┌───────────────────────┐    │
│   │  Sign up                 │    │
│   │  ── Account ──            │    │
│   │  Email    [__________]   │    │
│   │  Password [__________]   │    │
│   │  ── Eligibility & consent ──│
│   │  Birth year [______]     │    │
│   │  (under-13 advisory, if   │    │
│   │   looksUnder13 — warning- │    │
│   │   styled, verbatim text)  │    │
│   │  ┌─ consent block ─────┐ │    │
│   │  │ [ ] I agree to ... v.N │ │    │
│   │  └──────────────────────┘ │    │
│   │  (error banner, if any)  │    │
│   │  [   Sign up   ]          │    │
│   │  (hint if disabled by      │    │
│   │   consent — NEW microcopy, │    │
│   │   flagged below)         │    │
│   └───────────────────────┘    │
│   Already have an account? Log in│
└───────────────────────────────┘
```

### Flagged: one new piece of microcopy
Today the submit button is silently disabled while `consent` is unchecked, with no visible reason.
The spec adds one inline hint near the button, shown only while disabled-by-consent specifically
(e.g. "Check the box above to continue") — this explains an **existing** disabled condition
(`!consent || submitting`, unchanged), it does not add a new rule. Flagging explicitly per the
sprint's "no behavior change" discipline: this is new *text*, not new *logic*. If you'd rather this
shipped with zero new copy at all, drop it and Task 7 leaves the button silently disabled as today.

### Interaction flow
Identical to today: birth year changes recompute `looksUnder13` client-side (display only, never
gates submission); checkbox toggles `consent` (gates the Button exactly as now); submit → POST
`/api/auth/signup` with the same body shape → on failure, the server's message (including the verbatim
403 COPPA rejection) renders in the same alert pattern as login; on success, navigates to `/account`.

### State set
| State | What renders |
|---|---|
| Idle | grouped Fields, checkbox unchecked, Button disabled |
| Birth year suggests under-13 | + warning-styled advisory line (verbatim copy) — submission still gated only by `consent`, not by this |
| Consent checked | Button enabled |
| Submitting | Button "Creating account…", disabled |
| Error | alert with verbatim server message, incl. the COPPA 403 case |
| Success | n/a — immediate navigation |

### Component mapping
Same auth-card shell as login (shared, not duplicated); `Input`/`Label` for email/password/birth
year; the consent block as a bordered `Card`-in-`Card` (or shadcn's `Checkbox` + `Label` wrapped in a
visually distinct container) so it reads as one discrete, required action; the under-13 advisory and
the server-error alert both use the same `Alert` pattern as login, in warning vs. danger tone
respectively.

---

## 5. Account (`web/app/(dashboard)/account/page.tsx`)

### Current friction
- No shell at all — bare `<main><h1>Account</h1>` straight into a raw `<dl>`, then the logout button.
- The `<dl>` gives email, tier, age_verified, and consent_version equal visual weight — the latter two
  are compliance/support-facing metadata, not what a student logging in cares about first.
- `{profile && (...)}` silently renders nothing if the `users` row lookup ever comes back null — an
  unexplained blank gap today, not an explicit state.
- Logout button has no visual distinction as a "leave" action and sits flush against the data list.

### Redesigned layout

```
┌──────────────────────────────────────┐
│ [mark] Calyxa            [nav slot — empty]│  ← (dashboard)/layout.tsx, new
├──────────────────────────────────────┤    this sprint; nav slot intentionally
│   Your account                          │    empty (nothing else exists to
│   Email   you@example.com               │    link to yet — the dashboard
│   Tier    free                          │    sprint fills it in)
│                                          │
│   Account details                       │  ← de-emphasized secondary group
│   Age verified     Yes                  │
│   Consent version  3                    │
│                                          │
│   [ Log out — secondary/outline ]       │
└──────────────────────────────────────┘
```

### Flagged: one new explicit state
Today, if `profile` is null the page silently renders an empty gap between the `<h1>` and the logout
button. The spec adds an explicit "We couldn't load your account details" message for that branch —
same query, same falsy check, just an explicit rendered state instead of an implicit blank one.

### Interaction flow
Unchanged: server component fetches the user, redirects to `/login` if absent (before any paint —
there is no client-visible loading flash to design here), fetches the `users` row, renders it.
Logout button posts to `/api/auth/logout` then navigates to `/login`, exactly as today.

### State set
| State | What renders |
|---|---|
| Unauthenticated | n/a — server-side redirect before paint |
| Profile loaded | two grouped sections as above | 
| Profile missing (new explicit branch) | "We couldn't load your account details" message in place of the silent gap |
| Logging out | Button shows "Logging out…", disabled (existing state) |

### Component mapping
`(dashboard)/layout.tsx` (new, Task 7): header bar (logomark + "Calyxa" text + empty nav slot) +
centered content container — the minimal authed shell the dashboard sprint extends. Account page:
two shadcn `Card`s ("Your account", "Account details") each wrapping a styled definition list;
missing-profile state as an `Alert`; `LogoutButton` as a shadcn `Button` with `variant="outline"`
(not destructive-red — logging out isn't data-destructive).

---

## Acceptance check (against Task 2's gate)

- All five surfaces covered with redesigned IA/flow + a complete state set (empty/loading/error/
  success/disabled) — see each section's state table. ✅
- No proposed change alters behavior/logic — every flow step above cites the exact existing
  condition/string/endpoint it reuses; the two new microcopy additions are explicitly flagged as
  copy-for-an-existing-condition, not new rules. ✅
- Every redesigned element maps to a named primitive (overlay/popup → `@calyxa/ui`) or shadcn
  component (login/signup/account) that Tasks 5–7 build/install. ✅
