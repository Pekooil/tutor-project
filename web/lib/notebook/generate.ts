import 'server-only'
import type Anthropic from '@anthropic-ai/sdk'
import { createClient, logTurnUsage } from '@/lib/ai/claude'
import {
  createClient as createOpenAIClient,
  logUsage as logOpenAIUsage,
  toolCallInput,
} from '@/lib/ai/tutor-openai'
import { toOpenAIFunctionTool } from '@/lib/ai/openai-schema'
import type { ConceptSlice } from './source'
import {
  EMPTY_NOTEBOOK,
  NOTEBOOK_TOOL,
  NOTEBOOK_TOOL_NAME,
  parseNotebook,
  type Notebook,
} from './tool'

// ADR-054: the Personal Notebook generator — a NEW forced-tool call, a sibling
// of the study-kit generator (web/lib/study/generate.ts), NOT the tutoring
// turn. It mirrors that file exactly (its own model const / max_tokens /
// prompt, forced through NOTEBOOK_TOOL, re-validated by parseNotebook,
// deterministic EMPTY_NOTEBOOK fallback on a bad response, throw-through on a
// real API error). The one structural difference from the kit: the notebook
// REVISES an existing document — the current notebook is part of the prompt, so
// the model refines in place rather than generating from scratch.

// Same Haiku model the study kit uses (web/lib/study/generate.ts) — the
// Anthropic backup path's model, defined here rather than imported (each
// generator owns its own, the OPENING_SCAN_MODEL / STUDY_KIT_MODEL convention).
const NOTEBOOK_MODEL = 'claude-haiku-4-5-20251001'

// ADR-052: GPT-4o-mini is the DEFAULT notebook provider too; NOTEBOOK_PROVIDER=
// anthropic selects the retained Haiku backup path. A SEPARATE flag from
// TUTOR_PROVIDER / STUDY_KIT_PROVIDER so the tutor turn, kit, and notebook flip
// independently. Read per-call, no restart needed.
const NOTEBOOK_MODEL_OPENAI = 'gpt-4o-mini'
const NOTEBOOK_FN = toOpenAIFunctionTool(NOTEBOOK_TOOL)

// Sized for one concept's revised notebook. Raised from 1000 for the v3
// document shape (an overview + key points + up to four titled sections of
// prose, each with its own finely-broken-down method) and again for the revision
// changelog — still one concept, but real paragraphs rather than three flat
// fields, and a truncated tool call would parse to a partial notebook.
const NOTEBOOK_MAX_TOKENS = 3000

// The system prompt: the generator's role + the revise-in-place contract.
// Deliberately insists on carrying the existing notebook forward and grounding
// in the session — the two ways a running document most easily drifts (invent
// coverage, or silently drop what was still true).
const NOTEBOOK_SYSTEM =
  'You maintain a student\'s personal notebook for ONE math concept — a living, re-readable study ' +
  'document, like great hand-written notes. You are given their CURRENT notebook for this concept ' +
  '(possibly empty) and what happened in today\'s tutoring session on it: the transcript, the outcome ' +
  'of each turn, the steps the tutor HIGHLIGHTED, and the misconceptions seen.\n\n' +
  'Produce the UPDATED notebook as a READABLE DOCUMENT the student will re-read weeks later — full ' +
  'sentences and real paragraphs, addressed to them as "you", never bullet fragments or markdown:\n' +
  '- summary: the opening Brief Overview — what this concept is and where the student stands, updated ' +
  'for today. Three or four sentences.\n' +
  '- keyPoints: the Key Points bullets under it — the facts they need in hand before solving anything. ' +
  'Each a single self-contained sentence.\n' +
  '- sections: the body. Each section is a titled chapter with an icon; inside it, each subsection is ' +
  'one idea with its own heading, its prose explanation, optionally ONE short featured expression, ' +
  'optionally ONE pulled-out sentence worth remembering, and — when the idea is a procedure — an ' +
  'ORDERED list of steps.\n' +
  "- revision: this session's changelog — what improved, what misconception is new, and what you " +
  'actually edited in the notebook.\n\n' +
  'MAKE THE STEPS CARRY THE MATH. The worked steps are the most valuable thing in this notebook, so ' +
  'break a procedure down finely: four to six small steps that each show their own manipulation beat ' +
  'two big steps that hide the work. Split any step doing two manipulations into two. Write each ' +
  "step's expression as a real before -> after transformation on the actual numbers from the session, " +
  'not a restatement of the sentence.\n\n' +
  'MAKE THE SECTIONS DIFFERENT FROM EACH OTHER. Each section takes a distinct facet of the concept — ' +
  'what it means, the patterns to recognize, the procedure to follow, the traps to avoid — with a ' +
  'distinct icon. Never give a section the same name as its own subsection, never repeat one ' +
  'subsection in the next, and never cover the same ground in two sections: merge them instead.\n\n' +
  'Mistakes are the point of this notebook. For any step the student GOT WRONG (from the outcomes, the ' +
  'highlighted mistakes, or the misconceptions), attach a mistake annotation to that step: their ACTUAL ' +
  'wrong work copied verbatim from the transcript, what went wrong, and what to watch for next time. ' +
  'Never invent or tidy up their attempt — leave it "" if the transcript does not show it. Tag both a ' +
  "step's mistake and the subsection it sits in with the EXACT misconception category from the " +
  'MISCONCEPTIONS list, so the notebook can show how often and when it happened. Every entry in that ' +
  'list deserves a home in the document — one marked "still open from an earlier session" is a standing ' +
  'weakness, so attach it to the step it belongs on (or tag the subsection that covers it) even if ' +
  "today's transcript did not happen to hit it. Leave `studentAttempt` empty for those; only today's " +
  'transcript can tell you what they actually wrote.\n\n' +
  'The revision changelog must be TRUE, not encouraging: put something in `improved` only when the ' +
  'material shows they actually got right what they used to get wrong, `newMisconceptions` only from ' +
  'the misconceptions list you were given, and `noteChanges` only for edits you actually made against ' +
  'the current notebook. Empty lists are the correct answer when nothing changed — a first session has ' +
  'no improvements to report.\n\n' +
  'Revise in place — carry forward what is still true, refine sections and steps rather than ' +
  'duplicating them. Keep only what the sessions actually support — never invent coverage this concept ' +
  'did not get. Reply ONLY by calling the submit_concept_notebook tool.'

// The user message: the current notebook first (what to revise), then this
// concept's session material (the new evidence). Kept plain-text like
// buildStudyKitUserMessage.
function buildNotebookUserMessage(existing: Notebook, slice: ConceptSlice): string {
  const lines: string[] = []

  lines.push(`CONCEPT: ${slice.title} (${slice.conceptKey})`)
  lines.push('')

  lines.push('CURRENT NOTEBOOK (revise this — keep what is still true):')
  if (existing.summary === '' && existing.keyPoints.length === 0 && existing.sections.length === 0) {
    lines.push('(empty — this is the first session on this concept)')
  } else {
    lines.push(`- Overview: ${existing.summary || '(none yet)'}`)
    if (existing.keyPoints.length > 0) {
      lines.push('- Key points:')
      for (const p of existing.keyPoints) lines.push(`    • ${p}`)
    }
    for (const section of existing.sections) {
      lines.push(`- Section "${section.title}" (icon: ${section.icon}):`)
      for (const block of section.subsections) {
        const tag = block.category ? ` {covers: ${block.category}}` : ''
        lines.push(`    ## ${block.heading}${block.expression ? ` [${block.expression}]` : ''}${tag}`)
        for (const p of block.body) lines.push(`        ${p}`)
        if (block.callout) lines.push(`        > ${block.callout}`)
        block.steps.forEach((s, i) => {
          lines.push(`        ${i + 1}. ${s.step}${s.expression ? ` [${s.expression}]` : ''}`)
          if (s.mistake) {
            const attempt = s.mistake.studentAttempt ? ` — they wrote: ${s.mistake.studentAttempt}` : ''
            lines.push(
              `            (known slip${s.mistake.category ? ` · ${s.mistake.category}` : ''}: ` +
                `${s.mistake.whatWentWrong}${attempt})`
            )
          }
        })
      }
    }
  }

  lines.push('')
  lines.push("TODAY'S SESSION ON THIS CONCEPT (in order — [outcome] shows if the step was right/wrong):")
  if (slice.turns.length === 0) {
    lines.push('(no transcript turns recorded for this concept)')
  } else {
    for (const turn of slice.turns) {
      lines.push(`- Turn ${turn.turnIndex} [${turn.outcome}]:`)
      if (turn.studentTranscript) lines.push(`    Student: ${turn.studentTranscript}`)
      if (turn.tutorResponse) lines.push(`    Tutor: ${turn.tutorResponse}`)
      if (turn.misconception) lines.push(`    Mistake here: ${turn.misconception}`)
      // The tutor's highlighted step(s) on this turn — the exact spans it marked
      // and why. This is the richest evidence for a step-level annotation.
      for (const a of turn.annotations) {
        const parts = [a.targetText ? `"${a.targetText}"` : null, a.label, a.note].filter(Boolean)
        if (parts.length > 0) lines.push(`    Tutor highlighted: ${parts.join(' — ')}`)
      }
    }
  }

  if (slice.concept) {
    lines.push('')
    lines.push(
      `OUTCOME THIS SESSION: ${slice.concept.turns} turn(s), ${slice.concept.correct} correct, ` +
        `${slice.concept.incorrect} incorrect.`
    )
  }

  // The tracked misconceptions on this concept — use these EXACT category strings
  // when tagging a step's mistake so the notebook can join the live count/date.
  if (slice.misconceptionsAdded.length > 0 || slice.misconceptionsTracked.length > 0) {
    lines.push('')
    lines.push('MISCONCEPTIONS (attach a step mistake for these; tag it with the exact category string):')
    for (const m of slice.misconceptionsAdded) {
      lines.push(`- category: ${m.category}${m.description ? ` — ${m.description}` : ''} [NEW this session]`)
    }
    // Still-open misconceptions from earlier sessions. Without these the notebook
    // for a long-running concept came back with no flags at all, because the
    // recap only reports what the CURRENT session added.
    for (const m of slice.misconceptionsTracked) {
      lines.push(`- category: ${m.category}${m.description ? ` — ${m.description}` : ''} [still open from an earlier session]`)
    }
  }

  if (slice.misconceptionsResolved.length > 0) {
    lines.push('')
    lines.push('MISCONCEPTIONS THE STUDENT RESOLVED THIS SESSION (reinforce the correct idea in the method):')
    for (const m of slice.misconceptionsResolved) {
      lines.push(`- category: ${m.category}${m.description ? ` — ${m.description}` : ''}`)
    }
  }

  return lines.join('\n')
}

// Runs the forced NOTEBOOK_TOOL call (Anthropic backup path) and validates its
// output. Returns EMPTY_NOTEBOOK (never throws) when the model returns no usable
// tool call — the deterministic fallback. Lets a real API/network error
// propagate to the caller's try/catch (the runStudyKitTool split).
async function runNotebookTool(system: string, userMessage: string): Promise<Notebook> {
  const response = await createClient().messages.create({
    model: NOTEBOOK_MODEL,
    max_tokens: NOTEBOOK_MAX_TOKENS,
    system,
    messages: [{ role: 'user', content: userMessage }],
    tools: [NOTEBOOK_TOOL],
    tool_choice: { type: 'tool', name: NOTEBOOK_TOOL_NAME },
  })

  logTurnUsage('notebook', response.usage) // TEMPORARY (ADR-037) — remove once verified

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === NOTEBOOK_TOOL_NAME
  )

  if (!toolUse || typeof toolUse.input !== 'object' || toolUse.input === null) {
    return EMPTY_NOTEBOOK
  }

  return parseNotebook(toolUse.input)
}

// The GPT-4o-mini mirror (default path): same forced-tool discipline, same
// parseNotebook re-validation, same EMPTY_NOTEBOOK degradation, same
// throw-through on a real API error. The OpenAI-strict schema is DERIVED from
// NOTEBOOK_TOOL (openai-schema.ts), so tool.ts stays the single source of truth.
async function runNotebookToolOpenAI(system: string, userMessage: string): Promise<Notebook> {
  const response = await createOpenAIClient().chat.completions.create({
    model: NOTEBOOK_MODEL_OPENAI,
    max_completion_tokens: NOTEBOOK_MAX_TOKENS,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userMessage },
    ],
    tools: [NOTEBOOK_FN],
    tool_choice: { type: 'function', function: { name: NOTEBOOK_TOOL_NAME } },
  })

  logOpenAIUsage('notebook', response.usage)

  const input = toolCallInput(response, NOTEBOOK_TOOL_NAME)
  if (!input) return EMPTY_NOTEBOOK
  return parseNotebook(input)
}

// Revises one concept's notebook from its existing content + this session's
// slice. The update path (update.ts) is responsible for the cost guard BEFORE
// this call and for the upsert AFTER — this function is only generation +
// validation.
export async function generateConceptNotebook(existing: Notebook, slice: ConceptSlice): Promise<Notebook> {
  const system = NOTEBOOK_SYSTEM
  const user = buildNotebookUserMessage(existing, slice)
  return process.env.NOTEBOOK_PROVIDER === 'anthropic'
    ? runNotebookTool(system, user)
    : runNotebookToolOpenAI(system, user)
}
