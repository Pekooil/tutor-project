import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import type { TurnMessage } from './claude'
import { CONCEPT_KEYS } from '@calyxa/curriculum'
import type { ConceptObservation, SessionSummary } from '@/lib/learning/types'

const MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 500 // a compact JSON summary, not a chat reply -- PLAN.md §2.5's per-turn budget does not apply here

const EMPTY_SUMMARY: SessionSummary = { observations: [] }

function createClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set — the Claude proxy cannot run without it.')
  }

  return new Anthropic({ apiKey })
}

const SUMMARISER_SYSTEM_PROMPT = `You analyse a finished math-tutoring session transcript and summarise what the
student practiced. Respond with ONLY a JSON object, no prose, no markdown fences, in this exact shape:

{ "observations": [ { "conceptKey": string, "outcome": "correct" | "partial" | "incorrect" | "none", "reasoningQuality": "sound" | "shallow" | "none", "selfConfidence": "low" | "med" | "high" | "unknown", "misconception"?: { "category": string, "description"?: string } } ] }

Rules:
- "conceptKey" MUST be exactly one of these known keys (skip anything that does not clearly match one):
${CONCEPT_KEYS.map((key) => `  - ${key}`).join('\n')}
- "outcome" reflects the student's final attempt on that concept this session: "correct",
  "partial", "incorrect", or "none" if the concept was only discussed, never attempted.
- "reasoningQuality" grades how the student explained THIS concept this session: "sound" if they
  showed correct mathematical reasoning (even if the final answer slipped), "shallow" if they
  guessed or gave no real justification for a correct answer, "none" if they never explained their
  thinking at all.
- "selfConfidence" reflects how confident the student sounded about their answer on this concept:
  "low", "med", "high", or "unknown" if it can't be told from the transcript.
- Only include "misconception" when the student showed a clear, repeated error pattern (e.g. a
  sign error). "category" is a short dotted.snake_case label, e.g. "sign_error.distribution".
- If nothing in the transcript matches a known concept, return { "observations": [] }.`

function buildTranscriptPrompt(transcript: TurnMessage[]): string {
  return transcript.map((m) => `${m.role}: ${m.content}`).join('\n')
}

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return fenced ? fenced[1] : trimmed
}

function isValidOutcome(value: unknown): value is ConceptObservation['outcome'] {
  return value === 'correct' || value === 'partial' || value === 'incorrect' || value === 'none'
}

function isValidReasoningQuality(value: unknown): value is ConceptObservation['reasoningQuality'] {
  return value === 'sound' || value === 'shallow' || value === 'none'
}

function isValidSelfConfidence(value: unknown): value is ConceptObservation['selfConfidence'] {
  return value === 'low' || value === 'med' || value === 'high' || value === 'unknown'
}

// Defensive parse: anything that isn't the exact expected shape is dropped
// rather than thrown -- a malformed/partial model response degrades to
// fewer observations, never an exception (ADR-015).
function parseSummary(raw: string): SessionSummary {
  try {
    const parsed = JSON.parse(stripCodeFence(raw))

    if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.observations)) {
      return EMPTY_SUMMARY
    }

    const observations: ConceptObservation[] = []

    for (const candidate of parsed.observations) {
      if (typeof candidate !== 'object' || candidate === null) continue

      const { conceptKey, outcome, reasoningQuality, selfConfidence, misconception } = candidate as Record<
        string,
        unknown
      >

      if (typeof conceptKey !== 'string' || !CONCEPT_KEYS.includes(conceptKey)) continue
      if (!isValidOutcome(outcome)) continue

      const observation: ConceptObservation = {
        conceptKey,
        outcome,
        reasoningQuality: isValidReasoningQuality(reasoningQuality) ? reasoningQuality : 'none',
        selfConfidence: isValidSelfConfidence(selfConfidence) ? selfConfidence : 'unknown',
      }

      if (typeof misconception === 'object' && misconception !== null) {
        const { category, description } = misconception as Record<string, unknown>
        if (typeof category === 'string' && category.length > 0) {
          observation.misconception = {
            category,
            ...(typeof description === 'string' ? { description } : {}),
          }
        }
      }

      observations.push(observation)
    }

    return { observations }
  } catch {
    return EMPTY_SUMMARY
  }
}

// The second sanctioned Anthropic SDK call site (ADR-008, confined to
// /web/lib/ai) -- one call per session end, never per turn (ADR-015). Never
// throws: a transcript-less session, a provider failure, or an unparsable
// reply all degrade to the empty summary so a flaky summariser never blocks
// session end (Task 5 treats this as best-effort).
export async function summariseSession({ transcript }: { transcript: TurnMessage[] }): Promise<SessionSummary> {
  if (transcript.length === 0) {
    return EMPTY_SUMMARY
  }

  try {
    const response = await createClient().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SUMMARISER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildTranscriptPrompt(transcript) }],
    })

    const textBlock = response.content.find((block) => block.type === 'text')
    const raw = textBlock?.type === 'text' ? textBlock.text : ''

    return parseSummary(raw)
  } catch {
    return EMPTY_SUMMARY
  }
}
