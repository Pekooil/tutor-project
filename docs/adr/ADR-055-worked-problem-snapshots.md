## ADR-055: "Session screenshots" ship as text-based worked-problem snapshots — the tutor's per-turn annotations, persisted on the interaction row and replayed — not pixel captures

**Status:** Proposed

**Context:** The dashboard IA brief ([[dashboard-ia-redesign]]) asks for **Session
Screenshots** on the concept workspace (§2) and the Sessions page (§3): *"a chronological
list of homework screenshots, each containing an AI explanation, misconception, and
corrected reasoning,"* plus the student's expectation of seeing the tutor's **drawings**.
This was the largest deferred item, deferred because the literal reading — pixel captures
of the student's homework — runs straight into locked architecture and a user-facing
privacy promise. Darcy's scoping call (2026-07-20) resolved the two forks:

1. **Screenshots → a text-based visual card, not pixels.** The verified reality: the
   extension captures **no pixels** today. `extension/src/content/pageExtractor.ts` reads
   DOM text only (innerText, MathML/KaTeX, image *alt* text) — the tutor "sees" the
   problem through extracted text. Real pixel capture would require re-adding a
   screen-capture permission **deliberately removed for the Chrome Web Store review**
   (Sprint 18 dropped `tabs`/tabCapture — likely a new store review to restore), a **new
   Supabase Storage bucket** (none exists anywhere in the repo), an extension upload path,
   and a **reversal of the `/privacy` promise** *"we never store the contents of the pages
   you visit."* Darcy chose the text path: no pixels, no new permission, no privacy
   reversal.
2. **Drawings → persist the tutor's existing annotations.** The tutor already produces
   an `annotations` array every turn — `ENVELOPE_TOOL` / `SESSION_START_TOOL`
   (`web/lib/ai/claude.ts`): each annotation is `{ id, type (highlight|underline|circle|
   arrow|label|step-indicator), target: { kind, text }, style: { color }, label, note?,
   step? }`, where `target.text` is *copied verbatim from the page context*. Today those
   annotations are returned to the extension (`completeTurn`'s `TurnResponsePayload`),
   rendered live in the shadow-DOM overlay's `AnnotationLayer`, and then **discarded** —
   never persisted.

The decisive find that collapses both features into one small change: the annotations —
the tutor's drawings — are the same data that reconstructs a "screenshot." Persisting the
one array the pipeline already computes yields both. And everything else the brief's
"snapshot" wants is **already stored** on `session_interactions`: `tutor_response` (the AI
explanation), `misconception_category` / `misconception_description` (the misconception),
`student_transcript` (what the student worked), `concept_key`, `outcome`. The only missing
ingredient is the annotations.

**Decision:** Ship "Session screenshots" as **worked-problem snapshots** — a text-based
card reconstructed from data the session already produces — realized by **persisting the
tutor's per-turn `annotations` array as a new nullable `jsonb` column on
`session_interactions`**, then reading and rendering it on the concept workspace and a new
Sessions detail view. Four decisions fix the shape:

1. **A column on `session_interactions`, not a new table.** Annotations are per-turn data
   that already belongs to the interaction row; a `annotations jsonb null` column
   (migration `0027`) rides every existing invariant with **zero new wiring**: RLS is the
   interaction row's existing `select/modify own`; erasure is its existing `user_id`
   cascade; the GDPR export already `select('*')`s the table, so the column is exported
   automatically. No new RLS policy, no export-list edit, no erasure-sweep edit.

2. **Persist at the existing completion tail, both turn kinds, best-effort.** The insert
   in `persistInteraction` (gradable turns) and `persistOpeningInteraction` (the opening
   scan that frames the whole problem) each gain `annotations: envelope.annotations ??
   null`. Both `/api/ai/turn` and `/api/ai/turn/stream` route through `completeTurn`
   (`turn-complete.ts` — the single source of truth), so this one edit covers **all** AI
   turn routes with no per-route change. It stays inside the existing best-effort insert:
   a persistence hiccup already degrades to "no row this turn," and a null-annotations
   turn is byte-identical to today.

3. **The snapshot is a reconstruction, never a page capture.** A rendered snapshot shows
   the annotated problem **spans** (`target.text`, already verbatim fragments of the
   problem) with their color, label, and why-note, alongside the stored `tutor_response`
   (AI explanation) and misconception fields (the brief's "corrected reasoning"). It is
   built entirely from the tutor's own output + text the student's turns already carried —
   **no image, no full-page content beyond the short spans the tutor chose to mark**. The
   concept workspace shows this concept's snapshots (brief §2); the Sessions detail view
   shows a session's full ordered timeline (brief §3).

4. **Truthful disclosure, no reversal.** Persisting annotations stores short verbatim
   problem spans that were not previously kept, so `/privacy` + the data-safety disclosure
   gain a **"saved worked-problem snapshots"** data type — but this is an *addition*, not
   a reversal of the "no page pixels / no page contents" stance, which still holds (no
   images, no URLs, no page bodies). Same discipline the notebook (ADR-054) and study kits
   (ADR-049) followed.

**Rationale:**
- **Persisting one already-computed array is the whole feature.** The alternative reading
  (pixels) is a multi-front project — a removed store permission, new storage
  infrastructure, and a reversed privacy promise — for a capability the text path delivers
  faithfully. The brief's "AI explanation, misconception, corrected reasoning" maps
  one-to-one onto data already on the row; only the annotations were missing.
- **A column, not a table, because annotations ARE the interaction.** They have no life
  independent of the turn that produced them; a separate table would re-model the exact
  session/turn/user linkage `session_interactions` already carries and force new RLS +
  export + erasure wiring for no gain.
- **The completion tail is the one hook that covers every route.** `turn-complete.ts` was
  built to be the single persistence source for the streaming and non-streaming routes;
  hooking it (not the routes) keeps the change to two inserts and inherits the
  best-effort, never-block posture the turn path already guarantees.
- **Reconstruction stays inside the locked stance.** "Read-only content script, nothing
  from the page's visual content stored" holds: we store the tutor's marks and the short
  spans they name, not a capture. The privacy line is added because that is truthful, not
  because the stance changed.

**Consequences:**
- **Enables:** the concept workspace's **Worked-problem snapshots** section (brief §2) and
  a new **Sessions detail** view (brief §3) — each a text card of the tutor's annotated
  spans + explanation + misconception, replayed from `session_interactions`. The extension
  overlay's live `AnnotationLayer` is unchanged; this only persists + replays what it
  already draws.
- **Requires:** `0027_interaction_annotations.sql` (one additive `annotations jsonb null`
  column); the two-line persist in `turn-complete.ts`; a read (annotated interactions per
  concept and per session); a `VisualCard` render component + its placements; and one
  `/privacy` + data-safety line. `ENVELOPE_TOOL` / the model / the envelope parse / RLS /
  export / erasure are **reused or untouched**.
- **Forecloses (this change):** **pixel/screenshot capture** (the text card is the
  decision; pixels would need the removed permission + storage + a privacy reversal, a
  separate future project if ever); **a freehand student drawing canvas** (Darcy chose
  "persist the tutor's annotations," not a new drawing surface); **a new annotations
  table** (a column is the grain); and **any change to what the extension reads or draws
  live** (persistence only).
- **Privacy disclosure (a truthful addition):** `/privacy` + the CWS data-safety
  disclosure add "saved worked-problem snapshots (the problem spans the tutor annotated,
  with its notes)" as a persisted data type, before this reaches users. The "no page
  pixels, no page contents, no URLs" stance is unchanged and still stated.

> **Numbering note:** this ADR is **055** — latest on disk is **054 (personal notebook)**,
> so 055 is next-free per the repo's "next free at execution, no renumber" convention. The
> migration is **`0027_interaction_annotations.sql`** — `0026_concept_notebook.sql` is the
> latest, so `0027` is next-free. Confirm both at execution (parallel tracks). See ADR-054
> (the notebook sibling this follows for read/render/disclosure shape), ADR-030 (the
> opening scan whose row also gains annotations), ADR-024 (the annotation surface + the
> grounded-display discipline this persists), ADR-019/026 (the persistence tail this hooks),
> ADR-035 (export + erasure — inherited free via the `session_interactions` column), and
> ADR-046 (the data-safety disclosure this amends).
