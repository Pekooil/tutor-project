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

// Sized for one concept's revised notebook (a short summary + a handful of
// reminders + a few titled explanations) — smaller than a full study kit, since
// it is one concept, not the whole session's notes+problems+flashcards.
const NOTEBOOK_MAX_TOKENS = 1000

// The system prompt: the generator's role + the revise-in-place contract.
// Deliberately insists on carrying the existing notebook forward and grounding
// in the session — the two ways a running document most easily drifts (invent
// coverage, or silently drop what was still true).
const NOTEBOOK_SYSTEM =
  'You maintain a student\'s personal notebook for ONE math concept — a living, re-readable study ' +
  'document, like great hand-written notes. You are given their CURRENT notebook for this concept ' +
  '(possibly empty) and what happened in today\'s tutoring session on it: the transcript, the outcome ' +
  'of each turn, the steps the tutor HIGHLIGHTED, and the misconceptions seen.\n\n' +
  'Produce the UPDATED notebook:\n' +
  '- summary: a short running summary of the concept and where the student stands, updated for today.\n' +
  '- mustKnow: the key things the student must know before solving — numbered points, each with its ' +
  'own sub-bullets and, where it helps, ONE short highlighted expression. These are the facts/results, ' +
  'not the procedure.\n' +
  '- method: the ORDERED procedure for solving this type of problem — the steps the student walks ' +
  'through, each with an optional short highlighted expression. For any step the student GOT WRONG ' +
  '(from the outcomes / highlighted mistakes / misconceptions), attach a mistake annotation: what they ' +
  'did wrong and what to watch for next time. Tag it with the EXACT misconception category from the ' +
  'MISCONCEPTIONS list so the notebook can show how often and when it happened.\n\n' +
  'Revise in place — carry forward what is still true, refine steps rather than duplicating them. Keep ' +
  'only what the sessions actually support — never invent coverage this concept did not get. Reply ' +
  'ONLY by calling the submit_concept_notebook tool.'

// The user message: the current notebook first (what to revise), then this
// concept's session material (the new evidence). Kept plain-text like
// buildStudyKitUserMessage.
function buildNotebookUserMessage(existing: Notebook, slice: ConceptSlice): string {
  const lines: string[] = []

  lines.push(`CONCEPT: ${slice.title} (${slice.conceptKey})`)
  lines.push('')

  lines.push('CURRENT NOTEBOOK (revise this — keep what is still true):')
  if (existing.summary === '' && existing.mustKnow.length === 0 && existing.method.length === 0) {
    lines.push('(empty — this is the first session on this concept)')
  } else {
    lines.push(`- Summary: ${existing.summary || '(none yet)'}`)
    if (existing.mustKnow.length > 0) {
      lines.push('- Must know:')
      for (const k of existing.mustKnow) {
        lines.push(`    • ${k.heading}${k.expression ? ` [${k.expression}]` : ''}`)
        for (const p of k.points) lines.push(`        - ${p}`)
      }
    }
    if (existing.method.length > 0) {
      lines.push('- Method:')
      existing.method.forEach((s, i) => {
        lines.push(`    ${i + 1}. ${s.step}${s.expression ? ` [${s.expression}]` : ''}`)
        if (s.mistake) {
          lines.push(
            `        (known slip${s.mistake.category ? ` · ${s.mistake.category}` : ''}: ${s.mistake.whatWentWrong})`
          )
        }
      })
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
  if (slice.misconceptionsAdded.length > 0) {
    lines.push('')
    lines.push('MISCONCEPTIONS (attach a step mistake for these; tag it with the exact category string):')
    for (const m of slice.misconceptionsAdded) {
      lines.push(`- category: ${m.category}${m.description ? ` — ${m.description}` : ''}`)
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
