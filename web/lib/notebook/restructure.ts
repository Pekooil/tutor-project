import 'server-only'
import type Anthropic from '@anthropic-ai/sdk'
import { createClient, logTurnUsage } from '@/lib/ai/claude'
import {
  createClient as createOpenAIClient,
  logUsage as logOpenAIUsage,
  toolCallInput,
} from '@/lib/ai/tutor-openai'
import { toOpenAIFunctionTool } from '@/lib/ai/openai-schema'
import { EMPTY_NOTEBOOK, NOTEBOOK_TOOL, NOTEBOOK_TOOL_NAME, parseNotebook, type Notebook } from './tool'

// ADR-054 (v3): the one-off migration generator. `generate.ts` REVISES a notebook
// against a new session; this RESTRUCTURES an existing one into the v3 document
// shape with no new session evidence at all.
//
// Why a restructure rather than a re-derivation from the transcripts:
//   - It is faithful by construction. The only input is what the notebook
//     already says, and the prompt's single hard rule is "add nothing". A
//     re-derivation would re-interpret old sessions and could quietly change
//     what the student's own notes claim.
//   - It works for EVERY row. A notebook whose `source_session_id` was nulled
//     (the session was deleted) has no transcript to re-derive from, but its
//     content is still true and still worth reshaping.
//   - It is one model call per notebook either way, and this one needs no reads.
//
// What it deliberately cannot recover: `mistake.studentAttempt` (the student's
// verbatim wrong work). v2 never captured it, so there is nothing to restructure
// — the prompt forbids inventing it, the "Your attempt" callout renders the
// explanation without the working, and the next real session on the concept
// fills it in.

const RESTRUCTURE_MODEL = 'claude-haiku-4-5-20251001'
const RESTRUCTURE_MODEL_OPENAI = 'gpt-4o-mini'
const RESTRUCTURE_FN = toOpenAIFunctionTool(NOTEBOOK_TOOL)

// Same ceiling as a v3 generation — the output document is the same size, and a
// truncated tool call parses to a partial notebook (which the caller's anti-loss
// guard then correctly refuses, wasting the call).
const RESTRUCTURE_MAX_TOKENS = 3000

// The prompt is deliberately narrow. Every instruction that would normally
// encourage the model to teach ("refine", "improve", "add what's missing") is
// replaced by a prohibition, because the only correct output here is the same
// notebook in a different shape.
const RESTRUCTURE_SYSTEM =
  "You are migrating a student's existing personal math notebook from an older format into a new one. " +
  'This is a FORMAT MIGRATION, not tutoring and not a rewrite.\n\n' +
  'THE ONE HARD RULE: add no new information. Every fact, rule, step, example, expression and mistake in ' +
  'your output must already be present in the notebook you are given. Do not teach anything extra, do not ' +
  'fill gaps, do not correct the mathematics, do not invent examples, and do not invent what the student ' +
  'did wrong. If the old notebook is thin, the new one is thin.\n\n' +
  'What you MAY do, and should:\n' +
  '- Group the existing key points and explanations into a few titled sections, and give each section the ' +
  'icon that fits it.\n' +
  '- Turn terse bullet fragments into full sentences addressed to the student ("you"), as long as no new ' +
  'claim enters.\n' +
  '- Put the existing procedure in as a subsection\'s ordered steps, keeping the order and the wording\'s ' +
  'meaning.\n' +
  '- Carry each existing step mistake onto the same step, keeping its category string EXACTLY as given.\n' +
  '- Lift one existing sentence per subsection into `callout` when it is clearly the memorable one.\n' +
  '- Keep the existing summary as the overview, lightly reflowed.\n\n' +
  'Two fields must stay empty:\n' +
  '- `studentAttempt` everywhere — the old format never recorded the student\'s actual working, and ' +
  'inventing it would put words in their mouth.\n' +
  '- every list in `revision` — no tutoring session happened here, so nothing improved, no ' +
  'misconception is new, and the only "change" is the format itself, which is not news to the student.\n\n' +
  'Group the material into sections that each cover a DIFFERENT facet, each with a DIFFERENT icon, and ' +
  'never give a section the same name as its own subsection. Where the notebook has a procedure, keep ' +
  'every step, keep the expression that came with it, and put that procedure in exactly ONE block — ' +
  'never copy the same steps into a second block, and never restate a step without its math. If you ' +
  'have material for only one real section, output one section rather than padding to two.\n\n' +
  'Reply ONLY by calling the submit_concept_notebook tool.'

function renderStep(lines: string[], step: Notebook['method'][number], n: number, indent: string): void {
  lines.push(`${indent}${n}. ${step.step}${step.expression ? ` [${step.expression}]` : ''}`)
  if (!step.mistake) return
  lines.push(
    `${indent}    MISTAKE ON THIS STEP (keep it on this step; category must stay exactly ` +
      `"${step.mistake.category ?? ''}"):`
  )
  if (step.mistake.studentAttempt) {
    lines.push(`${indent}        the student actually wrote: ${step.mistake.studentAttempt}`)
  }
  lines.push(`${indent}        what went wrong: ${step.mistake.whatWentWrong}`)
  lines.push(`${indent}        what to watch for: ${step.mistake.watchFor}`)
}

// The whole prompt input: the notebook as it stands. Rendered in the same plain
// outline style buildNotebookUserMessage uses for the "current notebook" block,
// so the two prompts read the same shape to the model.
//
// It has to handle BOTH input formats, because `force` re-runs this against rows
// that are already v3. `existing.mustKnow` / `existing.method` are a DERIVED v2
// projection of a v3 notebook — flattening every step into one list and dropping
// the callouts and the section grouping entirely. Feeding a v3 row through that
// projection asks the model to regroup material it can no longer see the shape
// of, which is exactly how a re-run loses steps. So when real sections exist,
// serialize THEM.
function buildRestructureMessage(existing: Notebook, title: string, conceptKey: string): string {
  const lines: string[] = []

  lines.push(`CONCEPT: ${title} (${conceptKey})`)
  lines.push('')
  lines.push('THE NOTEBOOK TO RESTRUCTURE (this is the ONLY source — add nothing to it):')
  lines.push(`- Overview: ${existing.summary || '(none)'}`)

  if (existing.keyPoints.length > 0) {
    lines.push('- Key points:')
    for (const point of existing.keyPoints) lines.push(`    • ${point}`)
  }

  if (existing.sections.length > 0) {
    // Already a document — reshape the sections, keeping every block and step.
    for (const section of existing.sections) {
      lines.push(`- Section "${section.title}" (icon: ${section.icon}):`)
      for (const block of section.subsections) {
        const tag = block.category ? ` {covers misconception: ${block.category}}` : ''
        lines.push(`    ## ${block.heading}${block.expression ? ` [${block.expression}]` : ''}${tag}`)
        for (const paragraph of block.body) lines.push(`        ${paragraph}`)
        if (block.callout) lines.push(`        > ${block.callout}`)
        if (block.steps.length > 0) {
          lines.push(`        PROCEDURE (${block.steps.length} steps — keep every one):`)
          block.steps.forEach((step, i) => renderStep(lines, step, i + 1, '        '))
        }
      }
    }
  } else {
    // The v2 case: flat key points plus one flat procedure.
    if (existing.mustKnow.length > 0) {
      lines.push('- Things the student must know:')
      for (const item of existing.mustKnow) {
        lines.push(`    • ${item.heading}${item.expression ? ` [${item.expression}]` : ''}`)
        for (const point of item.points) lines.push(`        - ${point}`)
      }
    }

    if (existing.method.length > 0) {
      lines.push(`- The procedure, in order (${existing.method.length} steps — keep every one):`)
      existing.method.forEach((step, i) => renderStep(lines, step, i + 1, '    '))
    }
  }

  return lines.join('\n')
}

async function runRestructureTool(system: string, userMessage: string): Promise<Notebook> {
  const response = await createClient().messages.create({
    model: RESTRUCTURE_MODEL,
    max_tokens: RESTRUCTURE_MAX_TOKENS,
    system,
    messages: [{ role: 'user', content: userMessage }],
    tools: [NOTEBOOK_TOOL],
    tool_choice: { type: 'tool', name: NOTEBOOK_TOOL_NAME },
  })

  logTurnUsage('notebook-restructure', response.usage)

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === 'tool_use' && block.name === NOTEBOOK_TOOL_NAME
  )

  if (!toolUse || typeof toolUse.input !== 'object' || toolUse.input === null) {
    return EMPTY_NOTEBOOK
  }

  return parseNotebook(toolUse.input)
}

async function runRestructureToolOpenAI(system: string, userMessage: string): Promise<Notebook> {
  const response = await createOpenAIClient().chat.completions.create({
    model: RESTRUCTURE_MODEL_OPENAI,
    max_completion_tokens: RESTRUCTURE_MAX_TOKENS,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userMessage },
    ],
    tools: [RESTRUCTURE_FN],
    tool_choice: { type: 'function', function: { name: NOTEBOOK_TOOL_NAME } },
  })

  logOpenAIUsage('notebook-restructure', response.usage)

  const input = toolCallInput(response, NOTEBOOK_TOOL_NAME)
  if (!input) return EMPTY_NOTEBOOK
  return parseNotebook(input)
}

/** Re-expresses one already-parsed notebook in the v3 document shape. Same
 *  provider switch as the generator (NOTEBOOK_PROVIDER=anthropic → the Haiku
 *  backup path); degrades to EMPTY_NOTEBOOK on an unusable tool call and throws
 *  through on a real API error, so the caller decides what to do. */
export async function restructureNotebook(
  existing: Notebook,
  title: string,
  conceptKey: string
): Promise<Notebook> {
  const user = buildRestructureMessage(existing, title, conceptKey)
  const restructured =
    process.env.NOTEBOOK_PROVIDER === 'anthropic'
      ? await runRestructureTool(RESTRUCTURE_SYSTEM, user)
      : await runRestructureToolOpenAI(RESTRUCTURE_SYSTEM, user)

  // Enforced here as well as asked for in the prompt: a reformat has no session
  // behind it, so it can never truthfully report an improvement, a new
  // misconception, or a change the student would care about. The changelog stays
  // null until a real session revises the notebook.
  return { ...restructured, revision: null }
}
