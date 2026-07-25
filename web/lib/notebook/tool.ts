import 'server-only'
import type Anthropic from '@anthropic-ai/sdk'

// ADR-054 (v3, "notebook studio"): the Personal Notebook generator's forced-tool
// contract and its validator, kept together the way study/tool.ts keeps
// STUDY_KIT_TOOL near its discipline. It mirrors that file's posture:
//   - `strict: true` is Anthropic's guaranteed schema validation — the model
//     cannot skip a required key or mis-type a field.
//   - every object node carries `additionalProperties: false`.
//   - array-LENGTH caps are NOT expressible under strict:true, so the counts
//     below are a prompt-side cap in the descriptions AND a hard slice in
//     parseNotebook.
//   - strict:true also can't express "optional" — so optional fields (an
//     expression, a callout, a step's mistake) are ALWAYS present in the schema
//     and use the ""/[] EMPTY SENTINEL convention: the model emits "" / [] when
//     there's nothing, and parseNotebook reads that as absent.
//
// The v3 model turns the notebook from three flat fields into a real READABLE
// DOCUMENT — the shape the Notebook Studio's notes view renders top to bottom:
//   - summary   : the "Brief Overview" paragraph, in the tutor's voice.
//   - keyPoints : the "Key Points" bullets directly under it.
//   - sections  : the body of the document. Each section is a titled chapter
//                 with an icon; each subsection is an h3 with prose, an optional
//                 featured expression, an optional pull-quote, and an optional
//                 ordered method whose steps carry the student's actual slips.
//
// v2 compatibility runs BOTH ways and lives entirely in parseNotebook:
//   - a v2 row read back off the DB ({summary, mustKnow, method}) is lifted into
//     keyPoints + a two-section document, so old notebooks still render;
//   - a v3 notebook exposes derived `mustKnow` / `method` so the pre-existing
//     /notebook renderers (ConceptNotes, ConceptPage, detail-read) keep working
//     untouched.
// Neither direction is stored — the persisted jsonb is whatever the tool emitted,
// and the derivations are recomputed on every read.

// Prompt-side caps (strict:true can't enforce array length — same note as
// study/tool.ts). A notebook is a re-readable running document, not a dump.
export const MAX_KEY_POINTS = 6
export const MAX_SECTIONS = 4
export const MAX_SUBSECTIONS = 4
export const MAX_BODY_PARAGRAPHS = 3
export const MAX_STEPS = 8
export const MAX_REVISION_ITEMS = 4

// v2 caps — still enforced when lifting a legacy row.
export const MAX_MUST_KNOW = 5
export const MAX_POINTS_PER_KEY = 4

/** The fixed icon vocabulary for a section heading. The render layer maps each
 *  to a stroke glyph; anything else falls back to `pencil`. */
export const SECTION_ICONS = ['pencil', 'grid', 'bolt', 'compass', 'target'] as const
export type SectionIcon = (typeof SECTION_ICONS)[number]

export const NOTEBOOK_TOOL_NAME = 'submit_concept_notebook'

export const NOTEBOOK_TOOL: Anthropic.Tool = {
  name: NOTEBOOK_TOOL_NAME,
  description:
    'Submit the UPDATED personal notebook for ONE concept. This is the ONLY way to reply — always ' +
    'call it, exactly once. You are given the student\'s CURRENT notebook for this concept and what ' +
    "happened in today's session on it (the transcript, the outcomes, the tutor's highlighted steps, " +
    'and the misconceptions seen). Revise the notebook IN PLACE: keep what is still true, refine it ' +
    "with today's work, and attach a mistake annotation — including the student's actual wrong work — " +
    'to any step they got wrong. Write it as a notebook the student will re-read weeks later: full ' +
    'sentences, the tutor\'s voice, no markdown. Ground everything in the material provided — never ' +
    'invent coverage the sessions did not have.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: {
        type: 'string',
        description:
          'The "Brief Overview" paragraph that opens the notebook: what this concept is and where the ' +
          "student stands on it, updated to reflect today's session. Three or four plain sentences " +
          'addressed to the student ("you"); no markdown. Use "" only if there is genuinely nothing to ' +
          'summarize yet.',
      },
      keyPoints: {
        type: 'array',
        items: { type: 'string' },
        description:
          `The "Key Points" bullets that sit under the overview — the facts the student needs in hand ` +
          `before solving anything (at most ${MAX_KEY_POINTS}, prompt-side cap). Each one a single ` +
          `self-contained plain sentence; no markdown, no leading dashes. Use [] only if there is ` +
          `genuinely nothing yet.`,
      },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: {
              type: 'string',
              description:
                'The section heading — a short noun phrase naming this part of the concept, e.g. ' +
                '"Factoring Essentials", "Special Patterns", "The Discriminant". It must NOT repeat any ' +
                "of its own subsections' headings — the section names the theme, the subsection names the " +
                'one idea inside it. If a section would have the same name as its only subsection, you ' +
                'have split the material wrong: either widen the section or merge it into another.',
            },
            icon: {
              type: 'string',
              enum: [...SECTION_ICONS],
              description:
                'The glyph for this section: "pencil" for technique/practice, "grid" for patterns and ' +
                'special cases, "bolt" for formulas and shortcuts, "compass" for procedures and ' +
                'strategy, "target" for common traps and what to watch for. Use a DIFFERENT icon for ' +
                'every section — if two sections want the same glyph they are covering the same ground ' +
                'and should be one section.',
            },
            subsections: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  heading: {
                    type: 'string',
                    description: 'The sub-heading — the one idea this block teaches.',
                  },
                  body: {
                    type: 'array',
                    items: { type: 'string' },
                    description:
                      `The explanation, as full prose paragraphs (at most ${MAX_BODY_PARAGRAPHS}, ` +
                      `prompt-side cap). Plain sentences in the tutor's voice; no markdown, no bullets. ` +
                      `Use [] when the heading needs no prose (a pure method block, for example).`,
                  },
                  expression: {
                    type: 'string',
                    description:
                      'A single short math expression to feature under this heading (rendered as a ' +
                      'highlighted bubble), e.g. "x^2 - 5x + 6 = (x-2)(x-3)". Plain text, no markdown or ' +
                      'LaTeX delimiters. Use "" when there is nothing to feature.',
                  },
                  callout: {
                    type: 'string',
                    description:
                      'The one sentence from this block worth pulling out as a quote — the thing the ' +
                      'student should remember if they remember nothing else. Use "" when nothing rises ' +
                      'to that.',
                  },
                  category: {
                    type: 'string',
                    description:
                      'The EXACT misconception category from the "MISCONCEPTIONS" list you were given ' +
                      'that this block addresses, so the notebook can flag it as missed or solid last ' +
                      'session. Use "" when this block maps to no listed misconception.',
                  },
                  steps: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        step: {
                          type: 'string',
                          description:
                            "One step of the procedure, in the tutor's voice. A single plain sentence " +
                            'or two; no markdown.',
                        },
                        expression: {
                          type: 'string',
                          description:
                            'THE MATH FOR THIS STEP — the single most important field on a step. Show the ' +
                            'actual manipulation this step performs, on real numbers from the material, ' +
                            'e.g. "6x^2 + 11x + 4 -> a*c = 6 * 4 = 24" or "2 * 3 = 6, 2 + 3 = 5". Write ' +
                            'the transformation, not a restatement of the sentence: prefer the "before -> ' +
                            'after" form so the student can see what changed. Plain text, no markdown or ' +
                            'LaTeX delimiters. Use "" ONLY when the step genuinely performs no ' +
                            'manipulation (a purely conceptual instruction like "read the question ' +
                            'again"); every step that touches the algebra must carry its math.',
                        },
                        mistake: {
                          type: 'object',
                          additionalProperties: false,
                          description:
                            'A mistake the STUDENT actually made at this step, if any. When they have ' +
                            'not slipped here, set all four fields to "".',
                          properties: {
                            category: {
                              type: 'string',
                              description:
                                'The EXACT misconception category from the "MISCONCEPTIONS" list this ' +
                                'slip corresponds to (so the notebook can show how often and when it ' +
                                'happened). Use "" if this slip is not one of the listed misconceptions.',
                            },
                            studentAttempt: {
                              type: 'string',
                              description:
                                "The student's ACTUAL wrong work at this step, copied from the session " +
                                'transcript as they wrote it, e.g. "6x^2 + 11x + 4 -> (6x + 4)(x + 1)". ' +
                                'Never invent or clean it up. Use "" when the transcript does not show ' +
                                'their attempt.',
                            },
                            whatWentWrong: {
                              type: 'string',
                              description:
                                'What the student did wrong at this step, grounded in the session — one ' +
                                'plain sentence. "" when there is no mistake here.',
                            },
                            watchFor: {
                              type: 'string',
                              description:
                                "What to watch for next time to avoid this, in the tutor's voice — one " +
                                'plain, concrete sentence. "" when there is no mistake here.',
                            },
                          },
                          required: ['category', 'studentAttempt', 'whatWentWrong', 'watchFor'],
                        },
                      },
                      required: ['step', 'expression', 'mistake'],
                    },
                    description:
                      `The ordered procedure for this block — the steps the student walks through (at ` +
                      `most ${MAX_STEPS}, prompt-side cap). THE STEPS ARE THE MOST USEFUL PART OF THE ` +
                      `NOTEBOOK: when the material supports a procedure at all, break it down finely — ` +
                      `four to six small steps each showing its own math beats two big ones that hide ` +
                      `the work. Split any step that does two manipulations into two steps. Attach a ` +
                      `mistake annotation to any step the student got wrong this or a prior session. NEVER ` +
                      `repeat a step that already appears in another block — one procedure lives in ONE ` +
                      `block; a duplicated step list is worse than none. Use [] when this block is ` +
                      `genuinely explanation rather than procedure.`,
                  },
                },
                required: ['heading', 'body', 'expression', 'callout', 'category', 'steps'],
              },
              description:
                `The blocks inside this section (at most ${MAX_SUBSECTIONS}, prompt-side cap). Each is ` +
                `one idea: prose, optionally a featured expression, optionally a pull-quote, optionally ` +
                `an ordered method. Two blocks in the same section must teach DIFFERENT things — if you ` +
                `find yourself restating one block in the next, cut it.`,
            },
          },
          required: ['title', 'icon', 'subsections'],
        },
        description:
          `The body of the notebook — the titled sections the student reads through (at most ` +
          `${MAX_SECTIONS}, prompt-side cap). Each section must cover a DISTINCT facet of the concept ` +
          `(what it means · the patterns · the procedure · the traps), never the same ground twice. ` +
          `Carry forward the still-true ones and revise in place rather than appending duplicates. Use ` +
          `[] only if the sessions give nothing to record yet.`,
      },
      revision: {
        type: 'object',
        additionalProperties: false,
        description:
          "The changelog for THIS revision — what today's session changed about the student and about " +
          'the notebook. Every entry must be grounded in the material you were given; use [] for any ' +
          'list that has nothing real in it (a first session has no improvements).',
        properties: {
          improved: {
            type: 'array',
            items: { type: 'string' },
            description:
              `What the student got RIGHT this session that used to trip them up (at most ` +
              `${MAX_REVISION_ITEMS}, prompt-side cap). Draw ONLY from the "MISCONCEPTIONS THE STUDENT ` +
              `RESOLVED THIS SESSION" list and from turns whose outcome was correct on a step they ` +
              `previously slipped on. One short sentence each, addressed to the student, naming the ` +
              `specific thing — "You computed a*c first this time instead of guessing a pair." Use [] ` +
              `when nothing improved.`,
          },
          newMisconceptions: {
            type: 'array',
            items: { type: 'string' },
            description:
              `Misconceptions spotted for the FIRST time this session (at most ${MAX_REVISION_ITEMS}, ` +
              `prompt-side cap). Draw ONLY from the "MISCONCEPTIONS" list you were given. One short ` +
              `sentence each, naming the slip concretely. Use [] when no new misconception appeared.`,
          },
          noteChanges: {
            type: 'array',
            items: { type: 'string' },
            description:
              `What actually changed in THIS notebook versus the CURRENT NOTEBOOK you were given (at ` +
              `most ${MAX_REVISION_ITEMS}, prompt-side cap) — the edits, not the content. One short ` +
              `sentence each, e.g. "Added a worked AC-method procedure with the a*c step called out." ` +
              `or "Rewrote the signs step to flag the mistake you made." Describe only edits you ` +
              `actually made. Use [] on a first session, where the whole notebook is new.`,
          },
        },
        required: ['improved', 'newMisconceptions', 'noteChanges'],
      },
    },
    required: ['summary', 'keyPoints', 'sections', 'revision'],
  },
  // A worked example anchoring the intended grain: an overview, four key points,
  // and two sections that cover DIFFERENT facets with DIFFERENT icons — one
  // explanatory, one a finely-broken-down procedure where every step carries its
  // own math and the a·c step carries the student's actual slip — plus a revision
  // changelog naming one improvement, one new misconception, and the real edits.
  input_examples: [
    {
      summary:
        'Factoring quadratics means rewriting ax^2 + bx + c as a product of two binomials. You can find ' +
        'the factor pair reliably now when a = 1, and you are getting more careful about the signs. The ' +
        'part that is still shaky is what to do first when a is not 1.',
      keyPoints: [
        'Factoring undoes multiplication: you are looking for the two binomials that multiply back to the original.',
        'When a = 1, you need two numbers that multiply to c and add to b.',
        'When a is not 1, start from the product a*c — not from c alone.',
        'Always check your factors by expanding them back out.',
      ],
      sections: [
        {
          title: 'Factoring Essentials',
          icon: 'pencil',
          subsections: [
            {
              heading: 'The number pair rule',
              body: [
                'For a quadratic with a leading coefficient of 1, factoring comes down to one question: which two numbers multiply to c and add to b? Once you have that pair, the binomials write themselves.',
              ],
              expression: 'p * q = c,  p + q = b',
              callout: 'The sign of c tells you whether the numbers share a sign; the sign of b tells you which.',
              category: '',
              steps: [],
            },
          ],
        },
        {
          title: 'The AC Method',
          icon: 'compass',
          subsections: [
            {
              heading: 'When the leading coefficient is not 1',
              body: [
                'With a leading coefficient other than 1 you cannot read the pair off c directly. The AC method fixes that by working from the product a*c instead.',
              ],
              expression: '',
              callout: '',
              category: 'guess-and-check',
              steps: [
                {
                  step: 'Read off a, b and c so you know what you are working with.',
                  expression: '6x^2 + 11x + 4  ->  a = 6, b = 11, c = 4',
                  mistake: { category: '', studentAttempt: '', whatWentWrong: '', watchFor: '' },
                },
                {
                  step: 'Multiply a by c. This — not c on its own — is the number you are factoring.',
                  expression: 'a*c = 6 * 4 = 24',
                  mistake: {
                    category: 'guess-and-check',
                    studentAttempt: '6x^2 + 11x + 4 -> (6x + 4)(x + 1)',
                    whatWentWrong:
                      'You guessed a factor pair straight from the 6 and the 4 instead of computing a*c first.',
                    watchFor:
                      'When a is not 1, always compute a*c before you look for a pair — guessing is what broke here.',
                  },
                },
                {
                  step: 'Find the pair that multiplies to a*c and adds to b.',
                  expression: '3 * 8 = 24,  3 + 8 = 11',
                  mistake: { category: '', studentAttempt: '', whatWentWrong: '', watchFor: '' },
                },
                {
                  step: 'Split the middle term using that pair.',
                  expression: '6x^2 + 11x + 4  ->  6x^2 + 3x + 8x + 4',
                  mistake: { category: '', studentAttempt: '', whatWentWrong: '', watchFor: '' },
                },
                {
                  step: 'Group the four terms in pairs and pull the common factor out of each.',
                  expression: '6x^2 + 3x + 8x + 4  ->  3x(2x + 1) + 4(2x + 1)',
                  mistake: { category: '', studentAttempt: '', whatWentWrong: '', watchFor: '' },
                },
                {
                  step: 'Both groups now share a bracket — factor it out to finish.',
                  expression: '3x(2x + 1) + 4(2x + 1) = (3x + 4)(2x + 1)',
                  mistake: { category: '', studentAttempt: '', whatWentWrong: '', watchFor: '' },
                },
              ],
            },
          ],
        },
      ],
      revision: {
        improved: [
          'You handled the signs correctly on every factor pair this session — that was the slip last time.',
        ],
        newMisconceptions: [
          'When the leading coefficient was not 1, you guessed a factor pair instead of computing a*c first.',
        ],
        noteChanges: [
          'Added an AC Method section with the procedure broken into six steps, each showing its own working.',
          'Flagged the a*c step with the attempt you actually wrote.',
        ],
      },
    },
  ],
}

// ── The validated, persist-ready notebook. parseNotebook is the only producer. ─

export type NotebookMistake = {
  /** The misconception category this slip maps to (for the live count/date
   *  join at render), or null when it maps to no tracked misconception. */
  category: string | null
  /** The student's actual wrong work, verbatim from the transcript, or null.
   *  Drives the notes view's "Your attempt" callout — never fabricated. */
  studentAttempt: string | null
  whatWentWrong: string
  watchFor: string
}

export type NotebookStep = {
  step: string
  /** A short math expression to highlight, or null when absent. */
  expression: string | null
  /** The student's slip at this step, or null when they did not slip here. */
  mistake: NotebookMistake | null
}

export type NotebookSubsection = {
  heading: string
  /** Prose paragraphs; may be empty for a pure method block. */
  body: string[]
  /** A short math expression to feature, or null when absent. */
  expression: string | null
  /** The one pulled-out sentence, rendered as the accent blockquote, or null. */
  callout: string | null
  /** The misconception category this block addresses, or null — drives the
   *  "Missed in last session" / "Solid last session" heading pill. */
  category: string | null
  steps: NotebookStep[]
}

export type NotebookSection = {
  title: string
  icon: SectionIcon
  subsections: NotebookSubsection[]
}

/** v2 shape, retained so the pre-existing /notebook renderers keep working. It
 *  is DERIVED from `sections` on read and never persisted on its own. */
export type NotebookKeyPoint = {
  heading: string
  points: string[]
  expression: string | null
}

/** What the latest session changed — both about the student and about the
 *  notebook itself. Rendered as the "Since your <date> session" changelog under
 *  the overview. */
export type NotebookRevision = {
  /** What the student got right this time that used to trip them up. */
  improved: string[]
  /** Misconceptions spotted for the first time this session. */
  newMisconceptions: string[]
  /** The edits made to the notebook, not its content. */
  noteChanges: string[]
}

export type Notebook = {
  /** The "Brief Overview" paragraph. */
  summary: string
  /** The "Key Points" bullets under the overview. */
  keyPoints: string[]
  /** The document body. */
  sections: NotebookSection[]
  /** This revision's changelog, or null when there is nothing real to report
   *  (a v2 row, a first session, or a format-only migration). */
  revision: NotebookRevision | null
  /** Derived from `sections` — v2 compatibility for ConceptNotes/detail-read. */
  mustKnow: NotebookKeyPoint[]
  /** Derived from `sections` — v2 compatibility for ConceptNotes/detail-read. */
  method: NotebookStep[]
}

// The empty notebook (deterministic fallback, mirroring EMPTY_STUDY_KIT): every
// malformed-or-absent tool output degrades to THIS, never a throw and never a
// half-parsed notebook. An empty notebook is the update path's signal to persist
// nothing — never a row with an empty payload.
export const EMPTY_NOTEBOOK: Notebook = {
  summary: '',
  keyPoints: [],
  sections: [],
  revision: null,
  mustKnow: [],
  method: [],
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function cleanStringArray(value: unknown, cap: number): string[] {
  return (Array.isArray(value) ? value : [])
    .map(cleanString)
    .filter((s): s is string => s !== null)
    .slice(0, cap)
}

function parseMistake(value: unknown): NotebookMistake | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const whatWentWrong = cleanString(row.whatWentWrong)
  const watchFor = cleanString(row.watchFor)
  // A mistake needs at least a description of what went wrong to be worth
  // showing; the ""-sentinel (no slip here) collapses to null.
  if (!whatWentWrong && !watchFor) return null
  return {
    category: cleanString(row.category),
    studentAttempt: cleanString(row.studentAttempt),
    // Keep the pair coherent even if the model filled only one side.
    whatWentWrong: whatWentWrong ?? watchFor ?? '',
    watchFor: watchFor ?? whatWentWrong ?? '',
  }
}

// `seen` is shared across the WHOLE notebook, not just one block. A model that
// repeats a procedure into two subsections produces exactly the sameness this
// shape exists to avoid — and it drops the expressions from the second copy,
// making the duplicate strictly worse than the original. The first occurrence
// wins, so the copy that carries the math is the one kept. Identical step
// sentences are never a deliberate authoring choice, so removing them is a
// repetition fix rather than a content edit.
function parseSteps(value: unknown, seen?: Set<string>): NotebookStep[] {
  const steps: NotebookStep[] = []

  for (const item of Array.isArray(value) ? value : []) {
    if (steps.length >= MAX_STEPS) break
    if (typeof item !== 'object' || item === null) continue
    const row = item as Record<string, unknown>
    const step = cleanString(row.step)
    if (!step) continue

    const key = step.toLowerCase().replace(/\s+/g, ' ')
    if (seen) {
      if (seen.has(key)) continue
      seen.add(key)
    }

    steps.push({
      step,
      expression: cleanString(row.expression),
      mistake: parseMistake(row.mistake),
    })
  }

  return steps
}

function parseIcon(value: unknown): SectionIcon {
  const raw = cleanString(value)
  return SECTION_ICONS.includes(raw as SectionIcon) ? (raw as SectionIcon) : 'pencil'
}

function parseSubsection(value: unknown, seenSteps: Set<string>): NotebookSubsection | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const heading = cleanString(row.heading)
  if (!heading) return null
  const subsection: NotebookSubsection = {
    heading,
    body: cleanStringArray(row.body, MAX_BODY_PARAGRAPHS),
    expression: cleanString(row.expression),
    callout: cleanString(row.callout),
    category: cleanString(row.category),
    steps: parseSteps(row.steps, seenSteps),
  }
  // A heading alone teaches nothing — drop blocks with no content at all.
  const empty =
    subsection.body.length === 0 &&
    subsection.steps.length === 0 &&
    !subsection.expression &&
    !subsection.callout
  return empty ? null : subsection
}

function parseSections(value: unknown): NotebookSection[] {
  // One set for the whole document, so a step repeated across sections is caught.
  const seenSteps = new Set<string>()

  const sections = (Array.isArray(value) ? value : [])
    .map((item): NotebookSection | null => {
      if (typeof item !== 'object' || item === null) return null
      const row = item as Record<string, unknown>
      const title = cleanString(row.title)
      if (!title) return null
      const subsections = (Array.isArray(row.subsections) ? row.subsections : [])
        .map((sub) => parseSubsection(sub, seenSteps))
        .filter((s): s is NotebookSubsection => s !== null)
        .slice(0, MAX_SUBSECTIONS)
      if (subsections.length === 0) return null
      return { title, icon: parseIcon(row.icon), subsections }
    })
    .filter((s): s is NotebookSection => s !== null)
    .slice(0, MAX_SECTIONS)

  // The prompt asks for a distinct icon per section; this is the deterministic
  // backstop when the model repeats one anyway. Two sections wearing the same
  // glyph read as the same kind of content, which is exactly the sameness the v3
  // shape exists to avoid. Reassigning is safe because the icon is a visual
  // accent, not a claim about the material.
  const used = new Set<SectionIcon>()
  for (const section of sections) {
    if (!used.has(section.icon)) {
      used.add(section.icon)
      continue
    }
    const free = SECTION_ICONS.find((icon) => !used.has(icon))
    if (free) {
      section.icon = free
      used.add(free)
    }
  }

  return sections
}

function parseRevision(value: unknown): NotebookRevision | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const revision: NotebookRevision = {
    improved: cleanStringArray(row.improved, MAX_REVISION_ITEMS),
    newMisconceptions: cleanStringArray(row.newMisconceptions, MAX_REVISION_ITEMS),
    noteChanges: cleanStringArray(row.noteChanges, MAX_REVISION_ITEMS),
  }
  // All three empty is the ""-sentinel case (a first session, or a session that
  // changed nothing) — collapse to null so the render layer shows no changelog
  // rather than an empty card.
  const empty =
    revision.improved.length === 0 &&
    revision.newMisconceptions.length === 0 &&
    revision.noteChanges.length === 0
  return empty ? null : revision
}

// ── v2 ⇄ v3 bridging ─────────────────────────────────────────────────────────

/** v3 → v2: what the pre-existing /notebook renderers read. */
function deriveLegacy(sections: NotebookSection[]): {
  mustKnow: NotebookKeyPoint[]
  method: NotebookStep[]
} {
  const blocks = sections.flatMap((s) => s.subsections)
  return {
    mustKnow: blocks
      .filter((b) => b.body.length > 0 || b.expression)
      .map((b) => ({ heading: b.heading, points: b.body.slice(0, MAX_POINTS_PER_KEY), expression: b.expression }))
      .slice(0, MAX_MUST_KNOW),
    method: blocks.flatMap((b) => b.steps).slice(0, MAX_STEPS),
  }
}

/** v2 → v3: lift a legacy stored row into the document shape so old notebooks
 *  still render in the studio rather than showing an empty page. */
function liftLegacy(mustKnow: NotebookKeyPoint[], method: NotebookStep[]): NotebookSection[] {
  const sections: NotebookSection[] = []
  if (mustKnow.length > 0) {
    sections.push({
      title: 'Key ideas',
      icon: 'pencil',
      subsections: mustKnow.map((k) => ({
        heading: k.heading,
        body: k.points,
        expression: k.expression,
        callout: null,
        category: null,
        steps: [],
      })),
    })
  }
  if (method.length > 0) {
    sections.push({
      title: 'How to solve it',
      icon: 'compass',
      subsections: [
        { heading: 'The method', body: [], expression: null, callout: null, category: null, steps: method },
      ],
    })
  }
  return sections
}

function parseLegacyMustKnow(value: unknown): NotebookKeyPoint[] {
  return (Array.isArray(value) ? value : [])
    .map((item): NotebookKeyPoint | null => {
      if (typeof item !== 'object' || item === null) return null
      const row = item as Record<string, unknown>
      const heading = cleanString(row.heading)
      if (!heading) return null
      return {
        heading,
        points: cleanStringArray(row.points, MAX_POINTS_PER_KEY),
        expression: cleanString(row.expression),
      }
    })
    .filter((k): k is NotebookKeyPoint => k !== null)
    .slice(0, MAX_MUST_KNOW)
}

// The semantic re-validation the strict schema doesn't cover — the same posture
// parseStudyKit / parseEnvelopeObject take: strict:true guarantees the SHAPE,
// this enforces the MEANING (non-empty strings, the array-length caps the schema
// can't, ""→null optionals). Total and defensive: `input` is `unknown` because
// this runs against a raw tool_use.input, a hand-built object in tests, AND the
// stored jsonb re-read from the DB on the next revision — including BOTH older
// shapes: v2 {summary,mustKnow,method} (lifted into sections here) and the
// original {summary,reminders,explanations} (which yields an overview-only
// notebook and self-heals on the next generation). Anything it cannot make sense
// of collapses to EMPTY_NOTEBOOK rather than throwing.
export function parseNotebook(input: unknown): Notebook {
  if (typeof input !== 'object' || input === null) return EMPTY_NOTEBOOK

  const raw = input as Record<string, unknown>

  const summary = cleanString(raw.summary) ?? ''
  let sections = parseSections(raw.sections)

  // A v2 row has no `sections` — lift its mustKnow/method into the document.
  const legacyMustKnow = parseLegacyMustKnow(raw.mustKnow)
  const legacyMethod = parseSteps(raw.method)
  if (sections.length === 0) {
    sections = liftLegacy(legacyMustKnow, legacyMethod)
  }

  let keyPoints = cleanStringArray(raw.keyPoints, MAX_KEY_POINTS)
  if (keyPoints.length === 0 && legacyMustKnow.length > 0) {
    // v2 had no standalone key points — the headings are the closest true thing.
    keyPoints = legacyMustKnow.map((k) => k.heading).slice(0, MAX_KEY_POINTS)
  }

  return {
    summary,
    keyPoints,
    sections,
    // A v2 row has no changelog — the field simply doesn't render for it.
    revision: parseRevision(raw.revision),
    ...deriveLegacy(sections),
  }
}

// True when a notebook has nothing worth persisting — the update path's gate for
// "store nothing". Empty only when the overview is blank AND there are no key
// points AND no sections.
export function isEmptyNotebook(notebook: Notebook): boolean {
  return notebook.summary === '' && notebook.keyPoints.length === 0 && notebook.sections.length === 0
}
