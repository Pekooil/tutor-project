#!/usr/bin/env python3
# ruff: noqa: E501
"""
Calyxa — LLM API Cost Analysis Tool
===================================

Estimates the *real* API cost of running Calyxa's tutoring turns, and of
switching the tutor model from **Claude Haiku 4.5** to **GPT-4o-mini**, using
this project's ACTUAL request format rather than generic assumptions.

WHAT IS DERIVED FROM THE REAL IMPLEMENTATION (not guessed)
----------------------------------------------------------
Every prompt block, tool schema, model id, token cap, and payload-shape below
is transcribed from the live source. Pointers (file:line) are given so the
script can be re-synced whenever the prompts change:

  web/lib/ai/claude.ts
    - MODEL              = 'claude-haiku-4-5-20251001'          (line 17)
    - MAX_TOKENS         = 600                                  (line 18)
    - ENVELOPE_TOOL      (submit_tutor_turn, strict)            (lines 159-301)
    - SESSION_START_TOOL (submit_session_start_turn, strict)    (lines 326-381)
    - runTutorTurn / runTutorTurnEnvelopeStream / *Stream       (call sites)
  web/app/api/ai/turn/route.ts
    - OPENING_SCAN_MODEL     = 'claude-haiku-4-5-20251001'      (line 43)
    - OPENING_SCAN_MAX_TOKENS = 300                             (line 44)
    - opening scan sends NO tools (prompt-driven)               (lines 71-76)
  web/lib/ai/system-prompt.ts
    - buildSystemPrompt(): INTRO + PEDAGOGY + STUDENT PROFILE +
      PAGE CONTEXT + HARD RULES + OUTPUT FORMAT (+ COMPLIANCE /
      OPENING SCAN / SESSION START blocks)                      (lines 725-782)
    - MAX_PROMPT_CONCEPT_KEYS = 24                              (line 58)
  web/lib/ai/page-context.ts
    - MAX_EQUATIONS=12, MAX_EQUATION_CHARS=400, MAX_TEXT_CHARS=2000
  web/lib/ai/turn-request.ts
    - MAX_MESSAGES=40, MAX_MESSAGE_LENGTH=4000
  packages/curriculum/src/concepts/*  -> 66 CONCEPT_KEYS (embedded below)

KEY FINDING — NO IMAGES ARE SENT TO THE LLM
-------------------------------------------
Calyxa NEVER sends screenshots / base64 images to the model (V1 scope, see
CLAUDE.md "Video frame / diagram understanding" is out of scope). "Screenshot
analysis" in this app means DOM/OCR *text* extraction (page title + up to 12
equations + up to 2000 chars of page text), injected as the PAGE CONTEXT text
block. So image count is 0 on every request, for both models. This is reported
explicitly rather than silently assumed.

WHAT IS ASSUMED (and adjustable via the CONFIG block / CLI flags)
----------------------------------------------------------------
The *sizes* of dynamic content (how many mastery nodes a profile has, how long
the page text is, how many student turns, average message length, typical
output length, per-model latency throughput) cannot be read from source — they
are runtime values. Every such assumption lives in the CONFIG dataclasses below
with a documented default, and can be overridden on the command line. Token
COUNTS are derived by building the real strings and counting them (via the
Anthropic count_tokens API when available, else a transparent char heuristic).

USAGE
-----
    python cost_analysis.py                 # full report (auto-detects API)
    python cost_analysis.py --heuristic     # force offline char-based estimate
    python cost_analysis.py --api           # force Anthropic count_tokens API
    python cost_analysis.py --responses 15  # 15 student responses per session
    python cost_analysis.py --page-max      # model worst-case page context
    python cost_analysis.py --json          # machine-readable dump too

Re-run this whenever prompts or pricing change. If a value cannot be derived
automatically it is flagged as an assumption in the report.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field, asdict
from typing import Callable

# ============================================================================
# 1. PRICING  (public list prices, per 1,000,000 tokens — adjust as they change)
# ============================================================================
# Claude Haiku 4.5 pricing is authoritative from the Anthropic pricing table
# ($1.00 in / $5.00 out per MTok, 200K context). GPT-4o-mini pricing is
# OpenAI's public list price ($0.15 in / $0.60 out per MTok). No prompt caching
# is modelled: Calyxa sends a large system prompt + tool schema every turn with
# NO cache_control breakpoints (see claude.ts), so caching does not apply today
# — it is called out in the OPTIMIZATION REPORT as an opportunity.


@dataclass
class ModelPricing:
    name: str
    input_per_mtok: float
    output_per_mtok: float
    context_window: int
    tok_per_sec: float          # assumed streaming throughput (latency model)
    first_token_ms: float       # assumed time-to-first-token (latency model)
    notes: str = ""

    def input_cost(self, tokens: int) -> float:
        return tokens / 1_000_000 * self.input_per_mtok

    def output_cost(self, tokens: int) -> float:
        return tokens / 1_000_000 * self.output_per_mtok


HAIKU = ModelPricing(
    name="Claude Haiku 4.5",
    input_per_mtok=1.00,
    output_per_mtok=5.00,
    context_window=200_000,
    tok_per_sec=130.0,          # ASSUMPTION: typical Haiku 4.5 output throughput
    first_token_ms=450.0,       # ASSUMPTION: typical TTFT for a large prompt
    notes="Current production model (claude-haiku-4-5-20251001).",
)

GPT4O_MINI = ModelPricing(
    name="GPT-4o-mini",
    input_per_mtok=0.15,
    output_per_mtok=0.60,
    context_window=128_000,
    tok_per_sec=95.0,           # ASSUMPTION: typical 4o-mini output throughput
    first_token_ms=550.0,       # ASSUMPTION: typical TTFT
    notes="Public OpenAI list price. Uses o200k_base tokenizer (see multiplier).",
)


# ============================================================================
# 2. CONFIG  (all runtime assumptions — override via CLI)
# ============================================================================


@dataclass
class Config:
    # --- Session shape (matches the task brief: ~5 min, ~10 responses) -----
    student_responses: int = 10          # regular tutor turns per session
    include_opening_scan: bool = True    # 1 proactive opening-scan call
    include_session_start: bool = True   # 1 session-start kickoff call
    session_minutes: float = 5.0         # nominal session wall-clock (brief)

    # --- Conversation history (stateless: full windowed transcript resent) --
    # PLAN.md §2.5 targets the last 6-8 turns; MAX_MESSAGES=40 is the hard cap.
    history_window_messages: int = 16    # ASSUMPTION: ~8 exchanges kept in view
    avg_student_chars: int = 90          # ASSUMPTION: a typed student reply
    avg_assistant_chars: int = 330       # ASSUMPTION: prior `say` text in history

    # --- Injected profile size (STUDENT PROFILE block) ---------------------
    # Caps from system-prompt.ts: 12 nodes / 8 misconceptions / 6 due / 3 prior.
    profile_mastery_nodes: int = 12
    profile_misconceptions: int = 4
    profile_due_review: int = 2
    profile_prior_work: int = 1

    # --- Injected page context size (PAGE CONTEXT block, the "OCR" payload) -
    page_context_present: bool = True    # sent on turns where extraction fired
    page_title_chars: int = 40
    page_text_chars: int = 600           # ASSUMPTION: typical; MAX_TEXT_CHARS=2000
    page_equations: int = 4              # ASSUMPTION: typical; MAX_EQUATIONS=12
    page_equation_chars: int = 40        # avg per equation; MAX is 400

    # --- Output size (derived from the tools' own worked examples by default)
    # If None, the script counts tokens of the tool's representative
    # input_example JSON. Override to force a fixed number.
    output_tokens_regular: int | None = None
    output_tokens_opening: int | None = None
    output_tokens_session_start: int | None = None

    # --- Cross-tokenizer adjustment for GPT-4o-mini ------------------------
    # Token counts are measured with Claude's tokenizer. GPT-4o-mini uses
    # o200k_base, which for this kind of English+JSON prompt is usually within
    # a few percent. 1.0 = assume parity; bump if you measure a difference.
    gpt_token_multiplier: float = 1.0

    # --- Token counting mode ----------------------------------------------
    token_mode: str = "auto"             # auto | api | heuristic
    chars_per_token: float = 3.7         # heuristic divisor (English + JSON)


# ============================================================================
# 3. REAL PROMPT BLOCKS  (verbatim transcriptions — re-sync from source)
# ============================================================================
# NOTE: raw strings (r"""...""") are used because the prompts contain literal
# backslashes (\frac, \sqrt, \cdot) that must NOT be interpreted as escapes.

# --- system-prompt.ts:734-737  (intro) --------------------------------------
INTRO = r"""You are Calyxa, a patient, encouraging math tutor for an independent high-school or
college student. You teach MATH ONLY -- high-school math (algebra, geometry, trigonometry/
precalculus, intro probability & statistics) through a first college calculus course. This turn
happens over text chat, so write the way a great tutor talks: warm, concise, one idea at a time."""

# --- system-prompt.ts:739-757  (PEDAGOGY, static) ---------------------------
PEDAGOGY = r"""═══════════════════ PEDAGOGY ═══════════════════
DEFAULT MODE IS SOCRATIC. Your job is to make the student do the thinking.
- Lead with questions and small steps. Ask the student to take the next step themselves.
- Give hints in escalating size: first a nudge, then a pointed hint, then a worked micro-step.
- NEVER state the final answer in Socratic mode. Guide them to produce it.
SWITCH TO DIRECT EXPLANATION only when ANY of these is true, and say briefly that you're
switching ("Let me show you this part, then you try"):
  1. The student has attempted and is stuck after ~3 escalating hints on the same step.
  2. The student explicitly asks to be shown / says they're overwhelmed or frustrated.
  3. It's a definition or notation fact they could not be expected to derive.
After a direct explanation, immediately return to Socratic mode with a check-for-understanding
question that applies what you just showed.
CONCISENESS is a bound, not a vibe: by default, keep every reply to at most 3 sentences (about
60 words), one idea per turn. Exceed this ONLY when the student explicitly asks for the full
explanation spelled out -- being in direct-explanation mode for one of the three reasons above
does NOT by itself license a long reply; a hint, a definition, or a nudge after 3 stuck attempts
should still be short unless the student outright asked for the whole thing. No wall-of-text
bubbles: if an explanation genuinely needs more room, break it into the next turn instead of
one long one."""

# --- system-prompt.ts:768-775  (HARD RULES, static) -------------------------
HARD_RULES = r"""═══════════════════ HARD RULES — NEVER ═══════════════════
- NEVER give a final answer without scaffolding while in Socratic mode.
- NEVER claim certainty when the input is ambiguous or low-quality. Ask a clarifying question, or
  ask the student to restate or retype the step.
- NEVER answer anything outside mathematics. Redirect warmly: "That's outside what I can help
  with — want to get back to the math?"
- NEVER invent page or context content you cannot see.
- NEVER shame mistakes. Treat every error as information."""

SESSION_CLOSE_SENTENCE = "Now closing tutoring session."  # envelope.ts:99

# --- system-prompt.ts:224-520  (buildEnvelopeOutputFormat, minus keySubset) -
# The keySubset (<=24 keys) is spliced in at render time (see build fn below).
ENVELOPE_OUTPUT_FORMAT_HEAD = r"""═══════════════════ OUTPUT FORMAT ═══════════════════
Return a single JSON object and NOTHING else -- on EVERY turn, with NO exception. This
requirement does not depend on the topic, on whether the topic matches one of the concept
keys below, or on whether the assessment has a concept_key to tag: even a turn about a
concept outside the list below (the list is a bounded subset, not the whole curriculum --
see the note under "known keys" below) still gets the full JSON object, never plain prose,
never markdown, never a reply that starts talking before the JSON begins.
{
  "say": "<the spoken/written response — plain, natural sentences, no markdown, no LaTeX
           read-aloud gibberish. A passing math reference inside a sentence is verbalized
           naturally e.g. 'x squared plus three x'. BUT any equation or expression you are
           actually working -- the step being solved, the expression being simplified, the
           factored/expanded version, the result -- goes by ITSELF wrapped in $$ ... $$,
           e.g. 'Nice — combine the t-squared terms first. $$5t^2 + 8t^2 = 13t^2$$ Now what
           about the t terms?'. Inside $$ use plain calculator-style notation ONLY: x^2,
           sqrt(x), pi, /, *, <=, >=, != -- NEVER LaTeX commands (no \frac, \sqrt, \cdot,
           no braces-as-markup), never markdown, never words in place of symbols. The app
           renders each $$ block as its own centered, highlighted math line (it renders ^
           as a real superscript and sqrt/pi/<= as real symbols). Keep the prose around the
           blocks short: explanation in prose, the math work in $$ blocks, never both
           restating the same thing.>",
  "annotations": [ <zero or more annotation objects — optional, leave [] if none apply> ],
  "profile_tags": [ <zero to TWO profile-tag objects — optional; MOST turns have none> ],
  "solution_progress": <number 0-1 — see SOLUTION PROGRESS below; omit if nothing about the
                         student's progress on THIS problem changed this turn>,
  "session": { "complete": true, "reason": "solved" | "follow-up-declined" | "follow-up-corrected" },
                                    // see SESSION COMPLETION below — include this object ONLY
                                    // on the turn that actually closes the session; OMIT it
                                    // entirely on every other turn (there is no "still open"
                                    // value to send; absence IS "still open")
  "signals": [ <zero or more signal kinds — see SIGNALS below; the student sees each as a
                brief header pin. Emit whichever GENUINELY happened this turn; most turns
                carry one or two, [] only when none apply> ],
  "chips": [ <zero to four SHORT answer options for the ONE question "say" just asked — see
              ANSWER CHIPS below; the student taps one and it becomes their answer verbatim.
              [] when the question is open-ended or the turn asks no question> ],
  "mode": "socratic" | "direct",   // which mode THIS turn used
  "assessment": {                  // your read of the student's LAST message. Include this
                                    // object on EVERY turn EXCEPT your very first (opening)
                                    // turn of the conversation, when there is nothing yet to
                                    // assess -- that is the ONLY turn that omits it.
     "concept_key": "<the correct key for this concept -- from the list below when it's there,
                       otherwise the canonical key if you know one -- or null if nothing fits>",
     "outcome": "correct" | "incorrect" | "partial" | "none",
     "reasoning_quality": "sound" | "shallow" | "none",
     "self_confidence": "low" | "med" | "high" | "unknown",  // the STUDENT's apparent certainty
     "misconception_category": "<short dotted.snake_case category, or null>",
     "misconception_description": "<one plain sentence describing the specific error, or null>",
     "confidence": "low" | "med" | "high"   // YOUR OWN confidence in this assessment (not the student's)
  }
}
Each annotation (when present) has this shape:
{ "id": "a1", "type": "highlight" | "circle" | "arrow" | "label" | "step-indicator",
  "target": { "kind": "selector" | "bbox" | "textMatch", "selector"?: string,
              "bbox"?: { "x": number, "y": number, "w": number, "h": number }, "text"?: string },
  "style"?: { "color"?: string, "weight"?: string }, "label": string, "note"?: string,
  "step"?: number, "ttl_ms"?: number }

ANNOTATION GUIDANCE — read before including any annotation:
- Annotating is the EXPECTED default, not an occasional flourish and not something the
  student has to ask for. Whenever your "say" text names or refers to a specific term, part,
  step, or value of an on-screen equation while explaining or walking through a problem,
  you SHOULD annotate it, automatically, in that SAME turn.
- "highlight" (the outlined box) is the DEFAULT annotation type -- reach for it first.
- When your "say" text names something you are ALSO annotating, phrase that reference using
  the EXACT SAME substring you put in that annotation's "target.text".
- Only annotate content that appears in PAGE CONTEXT below.
- Prefer "target.kind": "textMatch", with "text" copied EXACTLY from PAGE CONTEXT.
- Point at the SPECIFIC part you are talking about, not the whole equation.
- Each distinct region gets its OWN annotation, up to the 3-per-turn limit.
- NEVER invent a "selector" or a "bbox".
- At most 3 annotations per turn.
- Every annotation MUST carry a "label" -- no naked shapes. Verb-first, 4 words or fewer.
- "note" is the optional teaching payload, 90 characters or fewer.
- Use "step-indicator" to walk through a multi-step process within the SAME turn.
- "style.color", when set, MUST be one of: "amber", "blue", "green", "red".
- If PAGE CONTEXT is empty, leave "annotations" as [] or omit it entirely.

Each profile tag (when present) has this shape:
{ "kind": "reviewing" | "known-gap" | "due-review" | "strength" | "callback",
  "concept_key": "<one of the known keys below, or null>",
  "label": "<4 words or fewer, student-friendly>" }

PROFILE TAGS GUIDANCE — read before including any profile tag:
- A profile tag is a structured claim about what you know about THIS student. Tag ONLY what
  the STUDENT PROFILE block above actually contains. NEVER tag from general math knowledge.
- When to use each kind: reviewing / known-gap / due-review / strength / callback.
- At most 2 profile tags per turn, and MOST turns have none.
- "label" is 4 words or fewer, plain student-friendly language.
- Set "concept_key" to the profile entry's exact key from the list below whenever one applies.

SIGNALS — read before setting "signals":
"signals" is how the app shows the student, live, that you are ADAPTING to them and PAYING
ATTENTION. Emit signals GENEROUSLY but HONESTLY. Most turns carry one or two. The kinds:
  teaching-visual / teaching-decompose / pace-up / guidance-up / guidance-down /
  difficulty-up / difficulty-down / misconception-detected / prediction-confirmed /
  pattern-detected / pattern-broken / concept-understood / confidence-up / self-caught.
Never emit a kind that did not actually happen this turn.

ANSWER CHIPS — read before setting "chips":
"chips" renders as a row of tappable answer buttons directly under your reply. Offer chips
whenever your turn ends in ONE question whose expected answer comes from a SMALL set of short
options. 2 to 4 chips, each 6 words or fewer. EXACTLY ONE chip is the correct answer; the
wrong ones are PLAUSIBLE distractors. Usually end with "Not sure". Use [] when open-ended.

SESSION COMPLETION — read before setting "session":
This is a problem-sized session: it ends on exactly THREE conditions. Set
"session": { "complete": true, "reason": "<solved|follow-up-declined|follow-up-corrected>" }
ONLY on the turn where one becomes true. On the SAME turn, "say" MUST end with this EXACT
sentence as its final sentence: \"""" + SESSION_CLOSE_SENTENCE + r"""\" Never set complete
speculatively. A missed close is recoverable; a false close mid-problem is not.

SOLUTION PROGRESS — read before setting "solution_progress":
"solution_progress" is a number from 0 to 1 estimating how far through THIS specific problem
the student has progressed. Score it on genuine reasoning steps the student has actually
completed correctly. NEVER set it to 1.0 unless this is also the "solved" turn.

"assessment.concept_key" — the known keys below are the subset most relevant to THIS student
and THIS page right now, NOT the entire curriculum. Prefer one of these when it fits:"""

ENVELOPE_OUTPUT_FORMAT_TAIL = r"""

If the concept this turn is actually about is clearly a DIFFERENT one than anything listed
above, still set "concept_key" to the correct canonical key for that concept if you know one.
Use null only when nothing fits clearly. These are the same keys the STUDENT PROFILE block
uses. Ground each turn in that profile.

Earlier assistant turns in this conversation appear as plain text — that is how your past
replies are DISPLAYED, not how you produce them. EVERY reply must be exactly one JSON object.

Default "say": at most 3 sentences (~60 words), one idea per turn -- see CONCISENESS in the
PEDAGOGY section above. One question at a time. Math you are working goes in its own $$ ... $$
block, not spelled out inside the sentence."""

# --- system-prompt.ts:537-606  (ENVELOPE_COMPLIANCE_CHECK, static) ----------
ENVELOPE_COMPLIANCE_CHECK = r"""═══════════════════ BEFORE YOU ANSWER ═══════════════════
These checks are NOT optional extras -- run ALL of them, every single turn, even a small
scaffolding step:
1. "assessment" -- is this your very first turn of the whole conversation? If not, INCLUDE
   "assessment". A short clarifying answer, a partial step, or "yes"/"no" is still something to
   grade. Returning { "say": "..." } alone on a non-opening turn is a mistake.
2. "solution_progress" -- did the student's last message move them forward, backward, or
   nowhere on THIS problem? If forward or backward, set the number.
3. "annotations" -- does "say" name, point at, or reason about ANYTHING that appears in PAGE
   CONTEXT (an equation, a term, an exponent, a number, a step)? If yes, you MUST add an
   annotation for it THIS turn. Copy the exact text into "target.text" and reuse that same
   exact substring in "say" so the box and the phrase share a color.
4. "$$ math blocks" -- does "say" contain an equation or expression you are working? Then it
   MUST be wrapped in $$ ... $$ in plain calculator notation (x^2, sqrt(x), pi; NEVER \frac).
5. "signals" -- what did you just DO or NOTICE this turn (see SIGNALS above)? List every kind
   that GENUINELY fits -- this is the product's headline feature.
6. "chips" -- does "say" end in one question whose expected answer is one of a SMALL set of
   short options? Then offer them as "chips": 2-4 short options, exactly one correct.

WORKED EXAMPLE of a correct MID-conversation turn (this is turn 3+ of a real exchange, NOT
the opening turn -- note it still carries "assessment" and "solution_progress"):
Student's last message: "13t^2"  (PAGE CONTEXT includes the equation "5t^2 - 6t + 8t^2 - 8t")
{
  "say": "Excellent! The t-squared terms combine: $$5t^2 + 8t^2 = 13t^2$$ Now what about the t terms -- what is -6t plus -8t?",
  "solution_progress": 0.4,
  "assessment": {
    "concept_key": "algebra.polynomials.expanding",
    "outcome": "correct",
    "reasoning_quality": "sound",
    "self_confidence": "med",
    "misconception_category": null,
    "misconception_description": null,
    "confidence": "high"
  },
  "annotations": [
    { "id": "a1", "type": "highlight", "target": { "kind": "textMatch", "text": "-6t" } },
    { "id": "a2", "type": "highlight", "target": { "kind": "textMatch", "text": "-8t" }, "style": { "color": "blue" } }
  ],
  "signals": ["concept-understood"],
  "chips": ["-14t", "14t", "Not sure"]
}
A bare { "say": "..." } for a turn shaped like this one is exactly the mistake this checklist
exists to catch."""

# --- system-prompt.ts:616-644  (OPENING_SCAN_MODE, static) ------------------
OPENING_SCAN_MODE = r"""═══════════════════ OPENING SCAN MODE ═══════════════════
This is the OPENING SCAN: the panel just opened and the student has not sent a message yet.
There is no conversation history -- PAGE CONTEXT above is everything you have. Your ONLY job
this turn is to look at PAGE CONTEXT and decide whether you can confidently name the SPECIFIC
problem the student appears to be working on.

If you CAN confidently name it:
- Set "say" to exactly ONE line naming that ACTUAL problem and asking whether that's what they
  need help with, e.g. "Looks like you're working on factoring x^2 + 5x + 6 -- is that what you
  need help with?"
- Include exactly one annotation framing it. "highlight" first, "target.text" copied EXACTLY
  from PAGE CONTEXT, and "say" must reuse that same exact text.
- Include a "callback" profile tag ONLY when the STUDENT PROFILE's PRIOR SESSIONS list above
  contains a genuinely relevant prior session on this same topic.
- NEVER include "assessment" -- there is no student answer yet, nothing to grade.
- NEVER include "solution_progress", "session", or any "signals". Use "signals": [].

If you CANNOT confidently name a specific problem, set "say" to an empty string ("") and omit
"annotations", "profile_tags", "assessment", "solution_progress", and "session" entirely. An
empty "say" is a valid, EXPECTED answer here. Do NOT invent a plausible-sounding problem."""


# --- system-prompt.ts:655-702  (buildSessionStartMode, dynamic) -------------
def build_session_start_mode(question: str, sticking_point: str | None, snippet: str | None) -> str:
    if sticking_point:
        sticking_line = f'- Their usual sticking point, which they confirmed: "{sticking_point}"'
    else:
        sticking_line = (
            "- They said they are NOT sure where it usually goes wrong -- do not claim a weakness\n"
            "  they didn't name; watch for it while you work and name it only when you actually see it."
        )
    snippet_line = (
        f'\n- The exact part of the page they framed as where they\'re stuck (copied from the page):\n  "{snippet}"'
        if snippet
        else ""
    )
    return (
        r"""═══════════════════ SESSION START MODE ═══════════════════
This is the FIRST turn of a confirmed tutoring session. The student has not typed anything:
they were shown the problem detected on this page and a predicted sticking point, and tapped
"Start session" to confirm both. That confirmation already happened in the UI, so it is
settled fact -- do NOT greet, do NOT ask what they want to work on, and do NOT re-confirm the
problem or the sticking point.

What the student confirmed:
- The detected problem: \""""
        + question
        + r"""\""""
        + (f"\n{sticking_line}" if sticking_line else "")
        + snippet_line
        + r"""

THIS TURN USES A DIFFERENT TOOL than every other turn: call submit_session_start_turn, not
submit_tutor_turn. Ignore the OUTPUT FORMAT JSON shape above for this one turn. In short:
- "board_text" is ONLY the problem in bare calculator notation -- no sentence, no greeting, no
  question, nothing but the math. The server wraps it in the $$ ... $$ board display itself.
- "opening_question" is your ONE next question or micro-step, in your own voice, TO the
  student. Start AT the sticking point, not at a generic step 1. PEDAGOGY applies in full:
  Socratic default, one idea, at most 3 sentences.
Splitting the reply into these two narrow fields is deliberate: it structurally prevents both
opening with a greeting and echoing the confirmation back as if the student said it.
Annotations are encouraged on this turn too: framing the problem on the page (target.text
copied EXACTLY from PAGE CONTEXT) is the expected opening move when the problem is visible."""
    )


# ============================================================================
# 4. CURRICULUM KEYS  (66, from packages/curriculum/src/concepts/*)
# ============================================================================
CONCEPT_KEYS: list[str] = [
    "algebra.linear-equations.one-variable", "algebra.linear-equations.two-variable",
    "algebra.exponents.product-rule", "algebra.exponents.power-rule",
    "algebra.quadratics.factoring", "algebra.quadratics.formula",
    "algebra.polynomials.expanding", "algebra.functions.notation",
    "algebra.functions.graphs", "algebra.inequalities.linear",
    "algebra.absolute-value.equations", "algebra.absolute-value.inequalities",
    "algebra.radicals.simplifying", "algebra.radicals.rational-exponents",
    "algebra.ratios.proportions", "algebra.ratios.percent",
    "algebra.systems.elimination-substitution",
    "algebra2.complex.numbers", "algebra2.exponential.functions",
    "algebra2.logarithms.intro", "algebra2.logarithms.properties",
    "algebra2.polynomials.division-factor-theorem", "algebra2.rational.equations",
    "algebra2.rational.simplifying", "algebra2.sequences.arithmetic",
    "algebra2.sequences.geometric", "algebra2.systems.nonlinear",
    "geometry.angles.parallel-lines", "geometry.triangles.congruence",
    "geometry.triangles.similarity", "geometry.trig.right-triangle",
    "geometry.circles.arcs-angles", "geometry.circles.area-circumference",
    "geometry.coordinate.distance-midpoint", "geometry.measurement.area",
    "geometry.measurement.volume", "geometry.transformations.rigid-and-dilation",
    "precalc.trig.identities", "precalc.trig.equations", "precalc.trig.graphs",
    "precalc.trig.inverse", "precalc.unit-circle.radians",
    "precalc.limits.intuitive", "precalc.vectors.operations",
    "calculus.limits.formal", "calculus.derivatives.as-limit",
    "calculus.differentiation.power-rule", "calculus.differentiation.product-rule",
    "calculus.differentiation.quotient-rule", "calculus.differentiation.chain-rule",
    "calculus.differentiation.implicit", "calculus.applications.related-rates",
    "calculus.applications.optimization", "calculus.applications.curve-sketching",
    "calculus.integration.antiderivatives", "calculus.integration.u-substitution",
    "calculus.integration.definite-ftc", "calculus.integration.area-between-curves",
    "calculus.integration.volumes", "calculus.differential-equations.intro",
    "stats.descriptive.measures", "stats.distributions.normal",
    "stats.probability.rules", "stats.probability.conditional",
    "stats.probability.counting", "stats.random-variables.expected-value",
]
assert len(CONCEPT_KEYS) == 66, f"expected 66 concept keys, found {len(CONCEPT_KEYS)}"


# ============================================================================
# 5. TOOL SCHEMAS  (reconstructed from claude.ts — serialized == request cost)
# ============================================================================


def _nullable_enum(values: list[str]) -> dict:
    return {"anyOf": [{"type": "string", "enum": values}, {"type": "null"}]}


_NULLABLE_STRING = {"anyOf": [{"type": "string"}, {"type": "null"}]}

_ASSESSMENT_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "description": (
        "Your grading of the STUDENT's last message. Required on every turn -- including a short, "
        "partial, or yes/no answer, which is still something to grade. Only on the very first turn of "
        "a brand-new conversation (nothing yet to assess) should this read as a placeholder: "
        'concept_key null, outcome "none", reasoning_quality "none", confidence "low".'
    ),
    "properties": {
        "concept_key": {**_nullable_enum(CONCEPT_KEYS), "description": "One of the known curriculum keys, or null if none fits clearly."},
        "outcome": {"type": "string", "enum": ["correct", "incorrect", "partial", "none"]},
        "reasoning_quality": {"type": "string", "enum": ["sound", "shallow", "none"]},
        "self_confidence": {"type": "string", "enum": ["low", "med", "high", "unknown"], "description": "The STUDENT's apparent certainty (not your own)."},
        "misconception_category": _NULLABLE_STRING,
        "misconception_description": _NULLABLE_STRING,
        "confidence": {"type": "string", "enum": ["low", "med", "high"], "description": "YOUR confidence in this assessment."},
    },
    "required": ["concept_key", "outcome", "reasoning_quality", "self_confidence", "misconception_category", "misconception_description", "confidence"],
}

_ANNOTATION_ITEM_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "properties": {
        "id": {"type": "string"},
        "type": {"type": "string", "enum": ["highlight", "circle", "arrow", "label", "step-indicator"]},
        "target": {
            "type": "object", "additionalProperties": False,
            "properties": {
                "kind": {"type": "string", "enum": ["selector", "bbox", "textMatch"]},
                "text": {"type": "string", "description": "Copied EXACTLY (same characters, same spacing) from PAGE CONTEXT. Never invented."},
            },
            "required": ["kind", "text"],
        },
        "style": {"type": "object", "additionalProperties": False, "properties": {"color": {"type": "string", "enum": ["amber", "blue", "green", "red"]}}, "required": ["color"]},
        "label": {"type": "string", "description": 'REQUIRED on every annotation -- no naked shapes. Verb-first, 4 words or fewer, naming WHAT the mark points at (e.g. "Split this term", "Same factor, twice").'},
        "note": {"type": "string", "description": 'Optional why-note shown under the label: answers WHY this mark matters, 90 characters or fewer. Include one whenever there is a genuine why; if you cannot say why the mark matters, reconsider the mark.'},
        "step": {"type": "number"},
    },
    "required": ["id", "type", "target", "label"],
}

_PROFILE_TAG_ITEM_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "properties": {
        "kind": {"type": "string", "enum": ["reviewing", "known-gap", "due-review", "strength", "callback"]},
        "concept_key": _nullable_enum(CONCEPT_KEYS),
        "label": {"type": "string", "description": "4 words or fewer, student-friendly."},
    },
    "required": ["kind", "concept_key", "label"],
}

ENVELOPE_TOOL = {
    "name": "submit_tutor_turn",
    "description": "Submit your structured response for this tutoring turn. This is the ONLY way to reply -- always call it, exactly once, every turn.",
    "strict": True,
    "input_schema": {
        "type": "object", "additionalProperties": False,
        "properties": {
            "say": {"type": "string", "description": 'The spoken/written response -- plain, natural sentences, no markdown, no LaTeX read-aloud gibberish; verbalize math naturally (e.g. "x squared plus three x").'},
            "mode": {"type": "string", "enum": ["socratic", "direct"], "description": "Which mode THIS turn used."},
            "solution_progress": {"type": "number", "description": "Your current best estimate of how far through THIS problem the student has progressed, 0 (just started) to 1 (fully solved) -- re-estimate fresh each turn. Required every turn -- repeat your last estimate when truly nothing changed. Clamped server-side to [0,1]."},
            "assessment": _ASSESSMENT_SCHEMA,
            "annotations": {"type": "array", "items": _ANNOTATION_ITEM_SCHEMA, "description": 'Zero or more annotations (at most 3). Use an empty array when there is nothing on screen worth pointing at this turn -- but annotating is the EXPECTED default whenever "say" names something visible in PAGE CONTEXT.'},
            "profile_tags": {"type": "array", "items": _PROFILE_TAG_ITEM_SCHEMA, "description": "Zero to two profile tags. Empty on most turns."},
            "session": {"type": "object", "additionalProperties": False, "description": "Include this KEY ONLY on the turn that actually closes the session. Omit on every other turn.", "properties": {"complete": {"type": "boolean", "enum": [True]}, "reason": {"type": "string", "enum": ["solved", "follow-up-declined", "follow-up-corrected"]}}, "required": ["complete", "reason"]},
            "chips": {"type": "array", "items": {"type": "string"}, "description": 'Answer chips: 2-4 SHORT tappable answer options for the ONE question "say" just asked -- each 6 words or fewer, exactly one correct, wrong ones plausible distractors, usually "Not sure" last. Use [] when open-ended.'},
            "signals": {"type": "array", "items": {"type": "string", "enum": ["prediction-confirmed", "misconception-detected", "pattern-detected", "pattern-broken", "concept-understood", "teaching-visual", "teaching-decompose", "pace-up", "guidance-up", "guidance-down", "difficulty-up", "difficulty-down", "confidence-up", "self-caught"]}, "description": "The status signals for THIS turn -- the student sees each as a brief pin. Emit a kind WHENEVER it genuinely happened. Most turns carry one or two; use [] only when truly none apply."},
        },
        "required": ["say", "mode", "solution_progress", "assessment", "annotations", "profile_tags", "signals", "chips"],
    },
    "input_examples": [{
        "say": "Look at the two t-squared terms — 5t^2 and 8t^2. Can you add them together?",
        "mode": "socratic", "solution_progress": 0.2,
        "assessment": {"concept_key": "algebra.polynomials.expanding", "outcome": "none", "reasoning_quality": "none", "self_confidence": "unknown", "misconception_category": None, "misconception_description": None, "confidence": "low"},
        "annotations": [
            {"id": "a1", "type": "highlight", "target": {"kind": "textMatch", "text": "5t^2"}, "label": "Add these like terms", "note": "Both are t² terms, so their coefficients (5 and 8) add directly."},
            {"id": "a2", "type": "highlight", "target": {"kind": "textMatch", "text": "8t^2"}, "style": {"color": "blue"}, "label": "Same power here"},
        ],
        "profile_tags": [], "signals": ["concept-understood"], "chips": ["13t^2", "13t^4", "Not sure"],
    }],
}

SESSION_START_TOOL = {
    "name": "submit_session_start_turn",
    "description": "Submit your response for this SESSION START turn -- the first turn after the student confirmed the detected problem and sticking point on the check-in card (no student message exists yet). This is the ONLY way to reply -- always call it, exactly once.",
    "strict": True,
    "input_schema": {
        "type": "object", "additionalProperties": False,
        "properties": {
            "board_text": {"type": "string", "description": 'ONLY the problem restated in plain calculator notation (e.g. "20 - 6 + 4k = 2 - 2k"). No sentence, no greeting, no question, no punctuation beyond the math itself -- the server wraps this in the $$ ... $$ board display.'},
            "opening_question": {"type": "string", "description": "The ONE Socratic question or micro-step YOU, the tutor, ask this turn -- in your own voice, addressed TO the student, aimed straight at the confirmed sticking point. Never a greeting or re-confirmation. Never a restatement of the confirmation AS IF the student said it. Just your next question, nothing else."},
            "annotations": {"type": "array", "items": _ANNOTATION_ITEM_SCHEMA, "description": "Zero or more annotations framing the problem on the page (at most 3). Use an empty array when PAGE CONTEXT has nothing to point at."},
        },
        "required": ["board_text", "opening_question", "annotations"],
    },
    "input_examples": [{
        "board_text": "F = m*a",
        "opening_question": "The mass is in grams -- what does it need to be in first?",
        "annotations": [{"id": "a1", "type": "highlight", "target": {"kind": "textMatch", "text": "F = ma"}, "label": "Start with units", "note": "Every quantity must be in SI units before you plug in."}],
    }],
}


# ============================================================================
# 6. DYNAMIC CONTENT BUILDERS  (mirror the TS renderers; sizes from Config)
# ============================================================================


def build_profile_block(cfg: Config) -> str:
    """Mirror renderProfileSummary() with cfg-controlled counts."""
    keys = CONCEPT_KEYS
    nodes = "\n".join(
        f"- {keys[i % len(keys)]}: mastery 0.4{i}, state practicing, confidence med"
        for i in range(cfg.profile_mastery_nodes)
    ) or "(no mastery data yet)"
    misc = "\n".join(
        f"- {keys[i % len(keys)]} — sign.error.dropped: forgets to distribute the negative across both terms"
        for i in range(cfg.profile_misconceptions)
    ) or "(none active)"

    parts = [
        "Mastery (weakest/most relevant first):", nodes, "",
        "Active misconceptions to watch for (do not name clinically):", misc,
    ]
    if cfg.profile_due_review:
        due = "\n".join(f"- {keys[i % len(keys)]} (fading, last seen 6d ago)" for i in range(cfg.profile_due_review))
        parts += ["", "Fading / due for review — these are slipping; look for a natural moment (ideally early)", 'to weave one in, e.g. "let\'s revisit…", especially where it connects to the page:', due]
    if cfg.profile_prior_work:
        prior = "\n".join(f"- {keys[i % len(keys)]}: last session (2d ago) — struggled early, finished strong" for i in range(cfg.profile_prior_work))
        parts += ["", "PRIOR SESSIONS — real recorded history, and the ONLY prior sessions you may ever", "reference. At most ONCE this whole conversation, when one of these genuinely connects", "to what the student is doing right now, call back to it specifically and warmly. Never", "invent or embellish a memory beyond what a line below states:", prior]
    parts += ["", "Confidence: moderate — several estimates are low-confidence, verify with a quick question."]
    body = "\n".join(parts)
    return (
        "═══════════════════ STUDENT PROFILE (injected) ═══════════════════\n"
        + body
        + "\nActively use this: calibrate difficulty to the listed mastery, build on strengths, and watch for\n"
        + "the listed misconceptions WITHOUT naming them clinically. If a profile estimate is\n"
        + "low-confidence, verify with a quick question before assuming."
    )


def build_page_context_block(cfg: Config) -> str:
    """Mirror renderPageContextBlock() with cfg-controlled sizes."""
    if not cfg.page_context_present:
        return (
            "═══════════════════ PAGE CONTEXT (injected) ═══════════════════\n"
            "(no page context this turn)\n"
            "Page-context extraction is not wired in yet this sprint. Do not claim to see anything on the\n"
            "student's screen — ask them to describe or type the problem instead."
        )
    eq_stub = "x^2 + 5x + 6 = 0"
    equations = "\n".join(f"- {(eq_stub + ' ' * cfg.page_equation_chars)[:cfg.page_equation_chars].strip()}" for _ in range(cfg.page_equations))
    page_text = ("The problem asks you to factor the quadratic expression and solve for x. " * 40)[:cfg.page_text_chars]
    sections = [
        f"Page title: {('Factoring Quadratics — Practice' + ' ' * cfg.page_title_chars)[:cfg.page_title_chars].strip()}",
        "Visible on the page:",
        equations + "\n(each of these can be annotated: copy its text exactly into a textMatch target)",
        "",
        f"Page text (excerpt): {page_text}",
    ]
    rendered = "\n".join(sections)
    return (
        "═══════════════════ PAGE CONTEXT (injected) ═══════════════════\n"
        + rendered
        + '\nAnchor the session to THIS content. Refer to "the equation on your screen," not abstractions.'
    )


def build_envelope_output_format(cfg: Config) -> str:
    key_subset = CONCEPT_KEYS[:24]  # MAX_PROMPT_CONCEPT_KEYS
    keys_rendered = "\n".join(f"  - {k}" for k in key_subset)
    return ENVELOPE_OUTPUT_FORMAT_HEAD + "\n" + keys_rendered + ENVELOPE_OUTPUT_FORMAT_TAIL


def build_system_prompt(cfg: Config, kind: str) -> dict[str, str]:
    """
    Reproduce buildSystemPrompt() and return the ordered component -> text map
    so the report can break down every prompt component's size.

    kind: 'regular' | 'opening' | 'session_start'
    """
    components: dict[str, str] = {
        "system prompt: intro": INTRO,
        "system prompt: PEDAGOGY": PEDAGOGY,
        "system prompt: STUDENT PROFILE (injected)": build_profile_block(cfg),
        "system prompt: PAGE CONTEXT / OCR text (injected)": build_page_context_block(cfg),
        "system prompt: HARD RULES": HARD_RULES,
        "system prompt: OUTPUT FORMAT (envelope + concept keys)": build_envelope_output_format(cfg),
    }
    if kind == "regular":
        components["system prompt: BEFORE YOU ANSWER (compliance)"] = ENVELOPE_COMPLIANCE_CHECK
    elif kind == "opening":
        components["system prompt: OPENING SCAN MODE"] = OPENING_SCAN_MODE
    elif kind == "session_start":
        components["system prompt: SESSION START MODE"] = build_session_start_mode(
            "Factor x^2 + 5x + 6 and solve for x",
            "finding the factor pair that multiplies to c and adds to b",
            "x^2 + 5x + 6 = 0",
        )
    return components


def build_history_messages(cfg: Config, n_student_turns: int) -> list[dict[str, str]]:
    """
    Build a realistic windowed transcript ending in the latest student message.
    Stateless model resends the full (windowed) history every turn.
    """
    student = ("Is it (x+2)(x+3)? I tried the factor pairs of 6 that add to 5. " * 3)[: cfg.avg_student_chars]
    assistant = ("Great start — you found the pair. Now let's check by expanding it back out. What do you get for the middle term when you multiply the outer and inner parts? " * 3)[: cfg.avg_assistant_chars]

    msgs: list[dict[str, str]] = []
    # oldest first; assistant then student, ending on a user (student) turn.
    for _ in range(n_student_turns - 1):
        msgs.append({"role": "assistant", "content": assistant})
        msgs.append({"role": "user", "content": student})
    msgs.append({"role": "user", "content": student})  # latest student message

    # apply the history window cap (keep the most recent messages)
    if len(msgs) > cfg.history_window_messages:
        msgs = msgs[-cfg.history_window_messages:]
    return msgs


# ============================================================================
# 7. TOKEN COUNTER  (Anthropic count_tokens API, else char heuristic)
# ============================================================================


class TokenCounter:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.mode = cfg.token_mode
        self._client = None
        self._resolve_mode()

    def _resolve_mode(self) -> None:
        want_api = self.mode in ("auto", "api")
        if want_api:
            try:
                import anthropic  # type: ignore
                if os.environ.get("ANTHROPIC_API_KEY"):
                    self._client = anthropic.Anthropic()
                    self.mode = "api"
                    return
            except Exception:
                pass
            if self.mode == "api":
                print("WARNING: --api requested but anthropic SDK / ANTHROPIC_API_KEY unavailable; "
                      "falling back to heuristic.", file=sys.stderr)
        self.mode = "heuristic"

    def _heuristic(self, text: str) -> int:
        return max(1, round(len(text) / self.cfg.chars_per_token))

    def count_text(self, text: str) -> int:
        if self.mode == "api":
            try:
                r = self._client.messages.count_tokens(
                    model="claude-haiku-4-5",
                    messages=[{"role": "user", "content": text or " "}],
                )
                # subtract the fixed ~ message-wrapper baseline for a fairer
                # per-component number (empirically small; ~4-8 tokens).
                return max(1, r.input_tokens - self._baseline())
            except Exception as e:
                print(f"WARNING: count_tokens failed ({e}); using heuristic.", file=sys.stderr)
                self.mode = "heuristic"
        return self._heuristic(text)

    _baseline_cache: int | None = None

    def _baseline(self) -> int:
        if self._baseline_cache is None:
            try:
                r = self._client.messages.count_tokens(
                    model="claude-haiku-4-5", messages=[{"role": "user", "content": "x"}]
                )
                # tokens for a 1-char message ≈ wrapper overhead + 1
                self._baseline_cache = max(0, r.input_tokens - 1)
            except Exception:
                self._baseline_cache = 0
        return self._baseline_cache

    def count_request(self, system: str, tools: list[dict] | None, messages: list[dict]) -> int:
        """Authoritative input-token count for a full request payload."""
        if self.mode == "api":
            try:
                kwargs: dict = {
                    "model": "claude-haiku-4-5",
                    "system": system,
                    "messages": messages,
                }
                if tools:
                    kwargs["tools"] = tools
                r = self._client.messages.count_tokens(**kwargs)
                return r.input_tokens
            except Exception as e:
                print(f"WARNING: count_tokens(request) failed ({e}); using heuristic.", file=sys.stderr)
                self.mode = "heuristic"
        # heuristic: system + serialized tools + messages + small per-msg wrap
        total = self._heuristic(system)
        if tools:
            total += self._heuristic(json.dumps(tools, ensure_ascii=False))
        for m in messages:
            total += self._heuristic(m["content"]) + 4
        total += 8  # request scaffolding
        return total


# ============================================================================
# 8. REQUEST + SESSION MODELLING
# ============================================================================


@dataclass
class RequestBreakdown:
    kind: str
    components: dict[str, int]          # component -> input tokens
    tools_tokens: int
    history_tokens: int
    input_tokens: int                  # authoritative total
    output_tokens: int
    images: int
    latency_ms: float


def _output_tokens_for(cfg: Config, counter: TokenCounter, kind: str, cap: int) -> int:
    """Estimate output tokens from the tool's own worked example (derived)."""
    override = {
        "regular": cfg.output_tokens_regular,
        "opening": cfg.output_tokens_opening,
        "session_start": cfg.output_tokens_session_start,
    }[kind]
    if override is not None:
        return min(override, cap)
    if kind == "session_start":
        example = SESSION_START_TOOL["input_examples"][0]
    elif kind == "opening":
        # opening scan returns a bare say + one annotation (no tool); build a
        # representative envelope of that shape.
        example = {
            "say": "Looks like you're working on factoring x^2 + 5x + 6 -- is that what you need help with?",
            "annotations": [{"id": "a1", "type": "highlight", "target": {"kind": "textMatch", "text": "x^2 + 5x + 6"}, "label": "This quadratic"}],
            "signals": [],
        }
    else:
        example = ENVELOPE_TOOL["input_examples"][0]
    tokens = counter.count_text(json.dumps(example, ensure_ascii=False))
    return min(tokens, cap)


def model_request(cfg: Config, counter: TokenCounter, kind: str, n_student_turns: int) -> RequestBreakdown:
    """Model a single Claude request of a given kind."""
    caps = {"regular": 600, "opening": 300, "session_start": 600}
    cap = caps[kind]

    components_text = build_system_prompt(cfg, kind)
    component_tokens = {name: counter.count_text(text) for name, text in components_text.items()}
    system_str = "\n\n".join(components_text.values())

    # tools + messages per kind (matches the real call sites)
    if kind == "opening":
        tools = None  # opening scan sends NO tools (route.ts)
        messages = [{"role": "user", "content": "(The panel just opened. No message has been sent yet -- this is the opening scan; follow OPENING SCAN MODE.)"}]
    elif kind == "session_start":
        tools = [SESSION_START_TOOL]
        messages = [{"role": "user", "content": "(Session start: the student confirmed the detected problem on the check-in card. Nothing was typed -- follow SESSION START MODE.)"}]
    else:
        tools = [ENVELOPE_TOOL]
        messages = build_history_messages(cfg, n_student_turns)

    tools_tokens = counter.count_text(json.dumps(tools, ensure_ascii=False)) if tools else 0
    history_tokens = sum(counter.count_text(m["content"]) for m in messages)
    input_tokens = counter.count_request(system_str, tools, messages)
    output_tokens = _output_tokens_for(cfg, counter, kind, cap)

    # latency (Haiku assumptions; per-model recomputed later for comparison)
    latency_ms = HAIKU.first_token_ms + output_tokens / HAIKU.tok_per_sec * 1000.0

    return RequestBreakdown(
        kind=kind,
        components=component_tokens,
        tools_tokens=tools_tokens,
        history_tokens=history_tokens,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        images=0,  # KEY FINDING: no images are ever sent to the LLM
        latency_ms=latency_ms,
    )


@dataclass
class SessionModel:
    requests: list[RequestBreakdown]

    @property
    def total_calls(self) -> int:
        return len(self.requests)

    @property
    def total_input(self) -> int:
        return sum(r.input_tokens for r in self.requests)

    @property
    def total_output(self) -> int:
        return sum(r.output_tokens for r in self.requests)

    @property
    def total_images(self) -> int:
        return sum(r.images for r in self.requests)


def model_session(cfg: Config, counter: TokenCounter) -> SessionModel:
    reqs: list[RequestBreakdown] = []
    if cfg.include_opening_scan:
        reqs.append(model_request(cfg, counter, "opening", 1))
    if cfg.include_session_start:
        reqs.append(model_request(cfg, counter, "session_start", 1))
    # each student response -> one regular turn, history grows turn by turn
    for k in range(1, cfg.student_responses + 1):
        reqs.append(model_request(cfg, counter, "regular", k))
    return SessionModel(reqs)


# ============================================================================
# 9. REPORT
# ============================================================================

BAR = "=" * 60


def _money(x: float) -> str:
    if x < 0.01:
        return f"${x:.6f}"
    if x < 1:
        return f"${x:.4f}"
    return f"${x:,.2f}"


def print_report(cfg: Config, counter: TokenCounter, session: SessionModel) -> None:
    reg = next((r for r in session.requests if r.kind == "regular"), session.requests[-1])
    # use a "mid-session" regular turn (window roughly full) for PER REQUEST
    mid = session.requests[len(session.requests) // 2] if session.requests else reg
    if mid.kind != "regular":
        mid = reg

    print()
    print(BAR)
    print("CALYXA — LLM COST ANALYSIS  (Haiku 4.5  ->  GPT-4o-mini)")
    print(BAR)
    print(f"Token counting mode : {counter.mode.upper()}"
          + ("" if counter.mode == "api" else f"  (char heuristic, {cfg.chars_per_token} chars/token — approximate)"))
    print(f"Session shape       : {'opening scan + ' if cfg.include_opening_scan else ''}"
          f"{'session-start + ' if cfg.include_session_start else ''}{cfg.student_responses} student responses")
    print(f"Page context / OCR  : {'PRESENT' if cfg.page_context_present else 'ABSENT'} "
          f"(~{cfg.page_text_chars} chars text + {cfg.page_equations} eqns)  |  IMAGES SENT TO LLM: 0")
    print(f"History window      : up to {cfg.history_window_messages} messages resent each turn (stateless)")

    # ---- PER REQUEST --------------------------------------------------------
    print()
    print(BAR)
    print("PER REQUEST")
    print(BAR)
    for label, r in [("Regular tutor turn (mid-session)", mid),
                     ("Opening scan", next((x for x in session.requests if x.kind == "opening"), None)),
                     ("Session-start kickoff", next((x for x in session.requests if x.kind == "session_start"), None))]:
        if r is None:
            continue
        print(f"\n--- {label} [{r.kind}] ---")
        print("  Prompt component sizes (input tokens):")
        for name, tok in r.components.items():
            short = name.replace("system prompt: ", "")
            print(f"      {short:<44} {tok:>7,}")
        print(f"      {'tools / forced-schema JSON':<44} {r.tools_tokens:>7,}")
        print(f"      {'conversation history':<44} {r.history_tokens:>7,}")
        print(f"      {'hidden metadata (placeholder / wrappers)':<44} {'incl.':>7}")
        cap = 300 if r.kind == "opening" else 600
        print(f"    -> Input tokens (authoritative total) : {r.input_tokens:>7,}")
        print(f"    -> Estimated output tokens            : {r.output_tokens:>7,}  (cap {cap})")
        print(f"    -> Images sent                        : {r.images:>7,}")
        print(f"    -> Est. latency contribution (Haiku)  : {r.latency_ms/1000:>6.2f} s")

    # ---- PER SESSION --------------------------------------------------------
    print()
    print(BAR)
    print("PER SESSION")
    print(BAR)
    print(f"  Total API calls        : {session.total_calls:,}")
    print(f"  Total input tokens     : {session.total_input:,}")
    print(f"  Total output tokens    : {session.total_output:,}")
    print(f"  Total images           : {session.total_images:,}")
    est_secs = sum(r.latency_ms for r in session.requests) / 1000.0
    print(f"  Sum of model latency   : {est_secs:,.1f} s across all calls")
    print(f"  Nominal session length : ~{cfg.session_minutes:.0f} min wall-clock (turns are spread across think-time)")
    print(f"  Avg input / call       : {session.total_input // max(1, session.total_calls):,} tokens")

    # ---- COST COMPARISON ----------------------------------------------------
    print()
    print(BAR)
    print("COST COMPARISON")
    print(BAR)
    in_tok, out_tok = session.total_input, session.total_output
    # per-request uses the mid-session regular turn
    for model in (HAIKU, GPT4O_MINI):
        mult = cfg.gpt_token_multiplier if model is GPT4O_MINI else 1.0
        req_in = round(mid.input_tokens * mult)
        req_out = round(mid.output_tokens * mult)
        req_cost = model.input_cost(req_in) + model.output_cost(req_out)
        sess_cost = model.input_cost(round(in_tok * mult)) + model.output_cost(round(out_tok * mult))
        print(f"\n{model.name}   (in ${model.input_per_mtok:.2f} / out ${model.output_per_mtok:.2f} per MTok)")
        if model is GPT4O_MINI and mult != 1.0:
            print(f"  [tokens x{mult} for o200k_base tokenizer assumption]")
        print(f"  Cost per request (regular turn) : {_money(req_cost)}")
        print(f"  Cost per tutoring session       : {_money(sess_cost)}")

    print("\n  Scaled session costs:")
    print(f"    {'sessions':>10} | {HAIKU.name:>18} | {GPT4O_MINI.name:>14} | {'savings':>12} | {'reduction':>9}")
    print("    " + "-" * 76)
    for n in (100, 1_000, 10_000, 100_000):
        h = HAIKU.input_cost(in_tok) + HAIKU.output_cost(out_tok)
        g = GPT4O_MINI.input_cost(round(in_tok * cfg.gpt_token_multiplier)) + GPT4O_MINI.output_cost(round(out_tok * cfg.gpt_token_multiplier))
        hc, gc = h * n, g * n
        save = hc - gc
        pct = (save / hc * 100) if hc else 0
        print(f"    {n:>10,} | {_money(hc):>18} | {_money(gc):>14} | {_money(save):>12} | {pct:>7.1f} %")

    # ---- OPTIMIZATION REPORT ------------------------------------------------
    reg_sys_tokens = sum(mid.components.values())
    _print_optimization(cfg, mid, reg_sys_tokens, in_tok)

    # ---- MIGRATION REPORT ---------------------------------------------------
    _print_migration()

    print()
    print(BAR)
    print("ASSUMPTIONS IN EFFECT (override via CLI or the Config dataclass)")
    print(BAR)
    for k, v in asdict(cfg).items():
        print(f"  {k:<28} = {v}")
    print()


def _print_optimization(cfg: Config, mid: RequestBreakdown, reg_sys_tokens: int, sess_in: int) -> None:
    print()
    print(BAR)
    print("OPTIMIZATION REPORT")
    print(BAR)
    tools_tok = mid.tools_tokens
    static_sys = (mid.components.get("system prompt: OUTPUT FORMAT (envelope + concept keys)", 0)
                  + mid.components.get("system prompt: BEFORE YOU ANSWER (compliance)", 0)
                  + mid.components.get("system prompt: PEDAGOGY", 0)
                  + mid.components.get("system prompt: HARD RULES", 0)
                  + mid.components.get("system prompt: intro", 0))
    print(f"""
• REPEATED PROMPT TEXT (biggest lever)
  The system prompt + forced-tool schema are ~identical on EVERY turn yet resent
  in full, uncached. Static, turn-invariant tokens per regular turn:
     - system prompt (intro+PEDAGOGY+HARD RULES+OUTPUT FORMAT+compliance) ~ {static_sys:,}
     - forced-tool schema (submit_tutor_turn, incl. 66 concept keys x2)   ~ {tools_tok:,}
     Combined ~{static_sys + tools_tok:,} input tokens repeated on all {cfg.student_responses} regular turns.
  -> Enable Anthropic prompt caching (cache_control on the system + tools prefix).
     Cache reads bill ~0.1x input. At {cfg.student_responses} turns/session that is roughly a
     {(static_sys + tools_tok) * (cfg.student_responses - 1):,}-token/session block dropping to ~1/10th cost.
     NOTE: claude.ts currently sets NO cache_control breakpoints — this is unclaimed.

• LARGE / DUPLICATED SCHEMA PAYLOAD
  CONCEPT_KEYS (66 keys) is embedded TWICE in the tool schema
  (assessment.concept_key and profile_tags[].concept_key), ~{tools_tok:,} tool tokens total.
  -> Factor the enum via JSON-Schema $ref/$defs so the 66-key list is serialized once,
     or prune to the MAX_PROMPT_CONCEPT_KEYS(24) subset already used in the prompt.

• REDUNDANT INSTRUCTION SURFACE
  The envelope shape is described in THREE places every turn: OUTPUT FORMAT prose,
  the BEFORE YOU ANSWER checklist, AND the strict tool schema. With strict:true the
  schema alone guarantees shape — the prose OUTPUT FORMAT block is now belt-and-braces.
  -> Trim OUTPUT FORMAT to the semantic guidance the schema can't encode (annotation
     targeting, $$ notation, chip design) and drop the field-by-field JSON restatement.

• LARGE OCR / PAGE-CONTEXT PAYLOADS
  PAGE CONTEXT can carry up to 2000 chars text + 12 equations x 400 chars (~{(2000 + 12*400)//4:,}+ tokens
  worst case), resent every turn even when unchanged.
  -> Dedupe: only resend page context when the extracted DOM actually changed
     (hash it client-side); otherwise reference "the same page as before."

• DUPLICATE SCREENSHOTS / IMAGES
  None — Calyxa sends NO images to the LLM (text-only). Nothing to dedupe here, and
  no image-token exposure on either model. (If image understanding ships in Phase 3+,
  revisit: 4o-mini bills images as tokens; Haiku/GPT differ materially.)

• CONVERSATION HISTORY
  Full windowed transcript ({cfg.history_window_messages}-msg cap) is resent every turn (stateless, ADR-008).
  Mid-session history ≈ {mid.history_tokens:,} input tokens/turn.
  -> Tighten the window to the PLAN's 6-8 turns, and/or summarise older turns.
     Prompt caching (above) also amortises the stable prefix so only the new
     turn's delta is full-price.

• LATENCY
  Output is the latency driver (forced-tool JSON must complete before TTS on the
  voice path). Levers: (1) prompt caching cuts prefill/TTFT on the big static prefix;
  (2) the streaming envelope already starts TTS on the first `say` delta — keep `say`
  as the FIRST schema property so it streams first; (3) opening scan already runs a
  smaller 300-token cap.
""")


def _print_migration() -> None:
    print(BAR)
    print("MIGRATION REPORT  (Haiku 4.5 -> GPT-4o-mini)")
    print(BAR)
    print("""
• FILES REQUIRING MODIFICATION (Anthropic-specific code)
    web/lib/ai/claude.ts          — SDK client, MODEL const, messages.create,
                                     messages.stream, ENVELOPE_TOOL / SESSION_START_TOOL
                                     (Anthropic tool schema + strict:true),
                                     tool_use block extraction, createSayExtractor
                                     (parses Anthropic input_json_delta).
    web/app/api/ai/turn/route.ts   — OPENING_SCAN_MODEL const + Anthropic client +
                                     messages.create for the opening scan.
    web/app/api/ai/turn/stream/route.ts, web/app/api/ai/stream/route.ts
                                   — consume the Anthropic streaming generators.
    web/lib/ai/envelope.ts         — parseEnvelope/parseEnvelopeObject are provider-
                                     neutral (JSON), but the tool-input path is fed by
                                     Anthropic's block shape.
    package.json                   — swap @anthropic-ai/sdk for the openai SDK.
    env / server config            — ANTHROPIC_API_KEY -> OPENAI_API_KEY.
    (Whisper STT + ElevenLabs TTS are already OpenAI/3rd-party and unaffected.)
    Estimated: ~5-7 source files.

• ANTHROPIC-SPECIFIC CODE TO PORT
    - Client: `new Anthropic()` -> `new OpenAI()`.
    - Model id: 'claude-haiku-4-5-20251001' -> 'gpt-4o-mini'.
    - Forced tool use: Anthropic `tools:[...] + tool_choice:{type:'tool',name}` +
      top-level `strict:true` -> OpenAI `tools:[{type:'function',function:{...,
      strict:true, parameters:<schema>}}]` + `tool_choice:{type:'function',
      function:{name}}`. Schema shape is JSON-Schema on both, BUT:
        * Anthropic uses `input_schema`; OpenAI nests under `function.parameters`.
        * `anyOf` nullable-enum trick (nullableEnum in claude.ts) — verify OpenAI
          strict-mode support; OpenAI strict requires every property in `required`
          and `additionalProperties:false` (already the case here) and represents
          nullable via `type:["string","null"]`, which Anthropic strict REJECTED
          (see claude.ts:61-69) — the two providers want OPPOSITE nullable forms.
          This is the single trickiest porting detail.
        * `input_examples` (Anthropic) has no direct OpenAI tool equivalent — fold
          into the description or a few-shot message.
    - Response parsing: Anthropic `response.content[] -> tool_use.input`
      -> OpenAI `choices[0].message.tool_calls[0].function.arguments` (a JSON
      STRING — must JSON.parse; Anthropic gives a parsed object).

• STREAMING DIFFERENCES
    - Anthropic emits `content_block_delta` with `input_json_delta.partial_json`
      for streamed tool args; createSayExtractor() scans that partial JSON for the
      first `say` string. OpenAI streams tool args as
      `choices[].delta.tool_calls[].function.arguments` fragments — same "partial
      JSON" idea, DIFFERENT event shape. createSayExtractor is reusable (it works on
      raw JSON fragments) but the stream-event plumbing feeding it must be rewritten.
    - `stream.finalMessage()` (Anthropic helper) -> accumulate deltas manually or use
      the OpenAI streaming helpers; no drop-in equivalent.
    - Text streaming path (runTutorTurnStream) maps cleanly: text deltas on both.

• MESSAGE FORMAT DIFFERENCES
    - System prompt: Anthropic top-level `system` string -> OpenAI a
      `{role:'system'}` message prepended to `messages`.
    - Roles: both use user/assistant; content is a plain string here (no image
      blocks), so message porting is mechanical.
    - The opening-scan placeholder and session-start placeholder user turns port
      unchanged.

• ESTIMATED ENGINEERING EFFORT
    - SDK swap + client/model plumbing .............. ~0.5 day
    - Port both forced tools to OpenAI function-calling
      (incl. the nullable-enum / strict-mode gotcha) . ~1.0-1.5 days
    - Rewrite streaming (tool-arg + text paths) + wire
      createSayExtractor to OpenAI deltas ............ ~1.0 day
    - Response parsing (JSON-string args) + fallbacks . ~0.5 day
    - Re-tune prompts for 4o-mini + regression test the
      envelope/annotation/assessment compliance ...... ~1.0-1.5 days
    ------------------------------------------------------------------
    TOTAL: ~4-5 engineering days (1 engineer), the bulk in tool-schema
    porting, streaming, and prompt/behaviour regression — not the SDK swap.
""")


# ============================================================================
# 10. CLI
# ============================================================================


def parse_args(argv: list[str]) -> Config:
    p = argparse.ArgumentParser(description="Calyxa LLM cost analysis (Haiku 4.5 -> GPT-4o-mini).")
    p.add_argument("--responses", type=int, help="student responses per session (default 10)")
    p.add_argument("--api", action="store_true", help="force Anthropic count_tokens API")
    p.add_argument("--heuristic", action="store_true", help="force char-based heuristic")
    p.add_argument("--chars-per-token", type=float, help="heuristic divisor (default 3.7)")
    p.add_argument("--page-max", action="store_true", help="model worst-case page context (2000 chars, 12 eqns)")
    p.add_argument("--no-page", action="store_true", help="model turns with no page context")
    p.add_argument("--history-window", type=int, help="max history messages resent per turn")
    p.add_argument("--gpt-token-multiplier", type=float, help="scale token counts for GPT-4o-mini tokenizer (default 1.0)")
    p.add_argument("--json", action="store_true", help="also emit a JSON dump of the model")
    args = p.parse_args(argv)

    cfg = Config()
    if args.responses is not None:
        cfg.student_responses = args.responses
    if args.api:
        cfg.token_mode = "api"
    if args.heuristic:
        cfg.token_mode = "heuristic"
    if args.chars_per_token is not None:
        cfg.chars_per_token = args.chars_per_token
    if args.history_window is not None:
        cfg.history_window_messages = args.history_window
    if args.gpt_token_multiplier is not None:
        cfg.gpt_token_multiplier = args.gpt_token_multiplier
    if args.page_max:
        cfg.page_text_chars = 2000
        cfg.page_equations = 12
        cfg.page_equation_chars = 60
    if args.no_page:
        cfg.page_context_present = False
    cfg._emit_json = bool(args.json)  # type: ignore[attr-defined]
    return cfg


def main(argv: list[str]) -> int:
    cfg = parse_args(argv)
    counter = TokenCounter(cfg)
    session = model_session(cfg, counter)
    print_report(cfg, counter, session)
    if getattr(cfg, "_emit_json", False):
        dump = {
            "config": asdict(cfg),
            "token_mode": counter.mode,
            "requests": [asdict(r) for r in session.requests],
            "session_totals": {
                "calls": session.total_calls,
                "input_tokens": session.total_input,
                "output_tokens": session.total_output,
                "images": session.total_images,
            },
        }
        print("\n----- JSON DUMP -----")
        print(json.dumps(dump, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
