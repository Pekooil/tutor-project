import 'server-only'
import type Anthropic from '@anthropic-ai/sdk'
import { getConcept } from '@calyxa/curriculum'
import { createClient, logTurnUsage } from '@/lib/ai/claude'
import type { SessionSource } from './source'
import {
  EMPTY_STUDY_KIT,
  STUDY_KIT_TOOL,
  STUDY_KIT_TOOL_NAME,
  parseStudyKit,
  type StudyKit,
} from './tool'

// Sprint 21 / Task 4 (ADR-049): the study-kit generator -- a NEW forced-tool
// Claude call, a sibling of runSessionStartTool (claude.ts), NOT the tutoring
// turn. It reuses claude.ts's createClient (the exact ANTHROPIC_API_KEY-checked
// construction) but owns its own model/max_tokens and prompt here, because the
// prompt is study-domain: there is no system-prompt.ts block for "turn a
// finished session into a study kit". The read it prompts from
// (loadSessionSource, Task 3) is the SAME per-session material the recap shows,
// so a kit can never disagree with what the student was already told.
//
// The call is forced through STUDY_KIT_TOOL (strict:true) exactly the way
// runTutorTurn forces ENVELOPE_TOOL, and its output runs through parseStudyKit
// for the semantic re-validation strict:true can't do. ADR-049 decision 2's
// deterministic fallback lives here: an absent/unparseable tool call degrades
// to EMPTY_STUDY_KIT (the route then persists nothing and shows the
// placeholder) -- never a throw, never a half-parsed kit. A genuine
// network/SDK failure DOES throw, to the route's try/catch (a 502), the same
// split runTutorTurn takes.

// Same Haiku model the tutoring turn uses (web/lib/ai/claude.ts MODEL) -- the
// production provider/model is locked to Anthropic Haiku (no GPT migration),
// and a kit is a structured-extraction task Haiku handles well. Defined here,
// not imported, mirroring how the opening scan defines its own OPENING_SCAN_MODEL
// const rather than reaching into claude.ts's private MODEL.
const STUDY_KIT_MODEL = 'claude-haiku-4-5-20251001'

// Sized for the whole kit's OUTPUT (up to MAX_NOTES notes + MAX_PROBLEMS worked
// problems + MAX_FLASHCARDS cards) in one call -- several times a turn's
// ≤3-sentence 600-token reply. STUDY_KIT_CENTS (cost-model.ts) is the flat
// estimate that tracks this larger budget.
const STUDY_KIT_MAX_TOKENS = 1500

// Title-resolve a concept key with the raw-key fallback the recap/overview
// routes use -- a stale key must never break prompt assembly.
function titleFor(conceptKey: string): string {
  return getConcept(conceptKey)?.title ?? conceptKey
}

// The system prompt: the generator's role + the grounding contract. Deliberately
// insists on NEW practice problems (not the session's own restated) and on
// concepts the session actually covered -- the two ways a kit most easily drifts
// from the session it claims to summarize (the plan's top risk).
const STUDY_KIT_SYSTEM =
  'You turn one completed math tutoring session into a study kit the student keeps: study notes, ' +
  'new practice problems, and flashcards. You are given the session\'s transcript, the concepts the ' +
  'student practiced, and any misconceptions touched.\n\n' +
  'Ground everything in THIS session:\n' +
  '- notes: capture the METHOD the student worked through, one step per note, in order -- something ' +
  'they can re-read to redo the method themselves.\n' +
  '- problems: 2-3 NEW problems on the SAME concepts (never the session\'s own problem restated), ' +
  'each with a correct worked solution.\n' +
  '- flashcards: 3-5 cards on the key facts or steps from the session.\n\n' +
  'Do not invent concepts the session did not cover. Tag each new problem with the concept it ' +
  'practices, using only the concept keys listed in the session material. Reply ONLY by calling the ' +
  'submit_study_kit tool.'

// The user message: the session material loadSessionSource assembled, rendered
// as plain text for the prompt. Ordered transcript first (the narrative the
// notes/problems are grounded in), then the concepts practiced (the allowed
// concept-key set + the outcome stats), then the misconceptions touched (what
// to reinforce). Concept keys are printed verbatim so the model can echo them
// into each problem's concept_key.
function buildStudyKitUserMessage(source: SessionSource): string {
  const lines: string[] = []

  lines.push('SESSION TRANSCRIPT (in order):')
  if (source.turns.length === 0) {
    lines.push('(no transcript turns recorded)')
  } else {
    for (const turn of source.turns) {
      const tag = turn.conceptKey ? `${turn.conceptKey}, ${turn.outcome}` : turn.outcome
      lines.push(`- Turn ${turn.turnIndex} [${tag}]:`)
      if (turn.studentTranscript) lines.push(`    Student: ${turn.studentTranscript}`)
      if (turn.tutorResponse) lines.push(`    Tutor: ${turn.tutorResponse}`)
    }
  }

  lines.push('')
  lines.push('CONCEPTS PRACTICED (use these concept keys, and only these, for problem tags):')
  if (source.concepts.length === 0) {
    lines.push('(none)')
  } else {
    for (const c of source.concepts) {
      lines.push(
        `- ${c.conceptKey} (${c.title}) — ${c.turns} turn(s), ${c.correct} correct, ${c.incorrect} incorrect`
      )
    }
  }

  const misconceptions = source.misconceptionsAdded
  if (misconceptions.length > 0) {
    lines.push('')
    lines.push('MISCONCEPTIONS TO REINFORCE:')
    for (const m of misconceptions) {
      lines.push(`- ${titleFor(m.conceptKey)}: ${m.category}${m.description ? ` — ${m.description}` : ''}`)
    }
  }

  if (source.misconceptionsResolved.length > 0) {
    lines.push('')
    lines.push('MISCONCEPTIONS THE STUDENT RESOLVED THIS SESSION (reinforce the correct idea):')
    for (const m of source.misconceptionsResolved) {
      lines.push(`- ${titleFor(m.conceptKey)}: ${m.category}${m.description ? ` — ${m.description}` : ''}`)
    }
  }

  return lines.join('\n')
}

// Runs the forced STUDY_KIT_TOOL call and validates its output. Returns
// EMPTY_STUDY_KIT (never throws) when the model returns no usable tool call --
// the deterministic fallback. Lets a real API/network error propagate to the
// caller's try/catch, the runTutorTurn split. Isolated from generateStudyKit's
// prompt assembly so the call shape stays a thin mirror of claude.ts's runners.
async function runStudyKitTool(system: string, userMessage: string): Promise<StudyKit> {
  const response = await createClient().messages.create({
    model: STUDY_KIT_MODEL,
    max_tokens: STUDY_KIT_MAX_TOKENS,
    system,
    messages: [{ role: 'user', content: userMessage }],
    tools: [STUDY_KIT_TOOL],
    tool_choice: { type: 'tool', name: STUDY_KIT_TOOL_NAME },
  })

  logTurnUsage('study-kit', response.usage) // TEMPORARY (ADR-037) -- remove once verified

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === STUDY_KIT_TOOL_NAME
  )

  if (!toolUse || typeof toolUse.input !== 'object' || toolUse.input === null) {
    return EMPTY_STUDY_KIT
  }

  return parseStudyKit(toolUse.input)
}

// Turns one session's material into a validated study kit. The route
// (Task 4) is responsible for the cost guard BEFORE this call and for
// persistence AFTER -- this function is only the generation + validation.
export async function generateStudyKit(source: SessionSource): Promise<StudyKit> {
  return runStudyKitTool(STUDY_KIT_SYSTEM, buildStudyKitUserMessage(source))
}
