import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getConcept } from '@calyxa/curriculum'
import type { Assessment } from '@/lib/ai/envelope'
import { computeNodeUpdate, RESOLUTION_STREAK } from './apply'
import { KNOWN_CONCEPT_KEYS } from './types'

// Turn-time event pings (Sprint 13, ADR-026): facts about what THIS turn's
// FSRS apply will do, computed prospectively so they can ride the turn
// response -- the only delivery that is "immediately after the answer" --
// while the real apply still runs off the critical path (after(), ADR-019).
// The LLM plays no part here: no envelope field, no prompt work, no
// grounding gate. Drift-proofing is structural, not hopeful: this module
// runs the SAME computeNodeUpdate (same row read, same input assembly, same
// pure updateKnowledgeNode) the apply itself runs seconds later, and turns
// are serialized by the extension's background worker, so the inputs read
// here are the inputs the apply will read.
//
// Exactly TWO event kinds, by contract (ADR-026's asymmetry):
//   mastery-up             -- the update crosses one of the model's own
//                             named upward MasteryState boundaries
//   misconception-resolved -- this correct answer completes an active
//                             misconception's RESOLUTION_STREAK
// Explicitly silent: in-state mastery ticks (the routine adjustment on
// nearly every answer), confidence_band upticks (the band rises
// mechanically with observation count -- pinging it would fire on a
// schedule, not on merit), unseen->* transitions (first contact is not an
// improvement), and NEWLY DETECTED misconceptions (persisted quietly by the
// apply exactly as before; they surface only in the session-end recap --
// celebrating progress mid-session helps, announcing "new gap detected"
// mid-struggle does the opposite).

export type TurnPingKind = 'mastery-up' | 'misconception-resolved'

// Display-ready (ADR-024's server-rendered-display rule): `title` is the
// curriculum display name, `label` the full toast copy -- QUALITATIVE, no
// numbers, so even a theoretical prospective/actual divergence can never
// show a wrong figure.
export type TurnPing = {
  kind: TurnPingKind
  conceptKey: string
  title: string
  label: string
}

// The named upward state transitions (deriveState's own thresholds --
// @calyxa/learning-model constants, not new magic numbers).
const MASTERY_UP_TRANSITIONS: ReadonlySet<string> = new Set([
  'weak->learning',
  'forgotten->learning',
  'learning->mastered',
  'weak->mastered',
  'forgotten->mastered',
])

type ActiveMisconceptionStreakRow = {
  id: string
  category: string
  consecutive_correct: number
}

// "sign-errors" / "algebra.sign_errors" -> "sign errors" for toast copy.
function humanizeCategory(category: string): string {
  return category.replace(/[-_.]/g, ' ').replace(/\s+/g, ' ').trim()
}

// Prospectively derives this turn's pings from the assessed concept's
// current rows. Gradable assessments only; two small indexed reads for the
// ONE concept, in parallel; any failure degrades to no pings -- a lost
// toast, never a failed or slowed turn.
export async function computeTurnPings(
  supabase: SupabaseClient,
  userId: string,
  assessment: Assessment,
  responseLatencyMs: number | null
): Promise<TurnPing[]> {
  const { conceptKey, outcome, reasoningQuality, selfConfidence, misconceptionCategory } = assessment

  if (!conceptKey || !KNOWN_CONCEPT_KEYS.includes(conceptKey)) return []
  if (outcome === 'none') return []

  try {
    const [nodeComputation, misconceptionsResult] = await Promise.all([
      computeNodeUpdate(supabase, userId, conceptKey, {
        outcome,
        reasoningQuality,
        selfConfidence,
        ...(responseLatencyMs !== null ? { responseLatencyMs } : {}),
      }),
      supabase
        .from('misconceptions')
        .select('id, category, consecutive_correct')
        .eq('user_id', userId)
        .eq('concept_key', conceptKey)
        .eq('status', 'active')
        .is('deleted_at', null),
    ])

    const title = getConcept(conceptKey)?.title ?? conceptKey
    const pings: TurnPing[] = []

    // Mirrors applyInteraction's resolution branch EXACTLY: it only runs
    // when no misconception was flagged this turn AND the answer was a
    // sound correct -- and a row resolves when its streak reaches
    // RESOLUTION_STREAK with this answer counted.
    if (!misconceptionCategory && outcome === 'correct' && reasoningQuality === 'sound') {
      const activeRows = (misconceptionsResult.data ?? []) as ActiveMisconceptionStreakRow[]
      const resolving = activeRows.find((row) => row.consecutive_correct + 1 >= RESOLUTION_STREAK)

      if (resolving) {
        pings.push({
          kind: 'misconception-resolved',
          conceptKey,
          title,
          label: `Gap closed: ${humanizeCategory(resolving.category)}`,
        })
      }
    }

    const transition = `${nodeComputation.priorState}->${nodeComputation.next.state}`
    if (MASTERY_UP_TRANSITIONS.has(transition)) {
      pings.push({
        kind: 'mastery-up',
        conceptKey,
        title,
        label: nodeComputation.next.state === 'mastered' ? `Mastered: ${title}` : `Leveled up: ${title}`,
      })
    }

    return pings
  } catch (err) {
    console.debug('[learning/events] computeTurnPings degraded to no pings', err)
    return []
  }
}
