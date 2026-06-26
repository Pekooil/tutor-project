## ADR-009: The learning profile is a hardcoded typed seam this sprint

**Status:** Decided

**Context:** The §2.5 prompt needs a `{{LEARNING_PROFILE_SUMMARY}}`, but the
live profile system — query 1 (PLAN §2.3) plus the §2.5 summariser plus the
learning model and its tables — is a later sprint. We had to decide whether
to stub the profile as a throwaway string or as a typed interface the live
system later fills, since the former would force a prompt-assembly rewrite
when the real profile arrives.

**Decision:** Define a `LearningProfile` type and a single hardcoded
instance in `/web/lib/ai/profile.ts`; `system-prompt.ts` renders any
`LearningProfile` into the `STUDENT PROFILE` block. This sprint passes the
hardcoded instance; the learning-connect sprint swaps the data source
(query 1 → summariser) behind the same type, with no change to
prompt-assembly or the route. Prompt-assembly stays in `/web/lib/ai` for
now — extraction to a shared `/packages/ai` is deferred until the learning
model needs to share scoring code across the API and tests.

**Rationale:**
- A typed seam makes hardcoded→live a data-source swap, not a rewrite.
- Keeping it in `/web/lib` avoids standing up workspace-package tooling for
  one sprint.
- The §2.5 summary shape (top-K weak/relevant nodes + active misconceptions
  + a confidence note) is honoured now so the budget discipline is already
  in place when the live summariser lands.

**Consequences:**
- Enables: a real Socratic prompt today, and a clean swap-in later with no
  prompt-assembly rewrite.
- Requires: the hardcoded profile to satisfy the same type the live
  summariser will emit.
- Forecloses: nothing — it defers `/packages/ai` extraction and the live
  profile/learning model to their own sprints.
