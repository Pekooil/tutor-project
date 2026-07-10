import { NextResponse } from 'next/server'
import { clientFromBearerOrCookie } from '@/lib/auth/bearer'
import { seedFromAssessment } from '@/lib/onboarding/seed'
import { selectAssessmentItems, type AssessmentResult } from '@/lib/onboarding/item-bank'

// Sprint 17 / Task 3 (ADR-042): the cold-start onboarding endpoint.
//   POST { results } -> seeds the caller's knowledge graph through the existing
//                       FSRS apply path, writes onboarding_completed_at, returns
//                       { seededCount }.
//   GET             -> { needed } : is onboarding still relevant for this user
//                       (calibrating -- zero knowledge_nodes -- AND not yet
//                       completed)? The overlay (Task 7) gates its Onboarding
//                       surface on this. When needed, ALSO returns `items` --
//                       the 8-12 assessment items selectAssessmentItems() picked
//                       (Task 7 addition, flagged: the extension has no
//                       @calyxa/curriculum dependency by design -- titles/prompts
//                       are resolved server-side everywhere else in this
//                       codebase, ADR-024's discipline -- so this is the ONE
//                       place the item bank's output crosses the wire; `needed:
//                       false` omits `items` entirely, same additive-omission
//                       discipline used throughout this codebase).
// Bearer- or cookie-authed (extension overlay uses the bearer token; a web
// caller its cookie). user_id always comes from the authenticated session,
// never the body -- and every write runs under that RLS-scoped client, so a
// caller can only ever seed their OWN nodes.

// The unions seed.ts / the FSRS core accept. Validated here so a malformed body
// is rejected at the boundary rather than seeding garbage (a caller can only
// hurt their own profile via RLS, but a 400 is cleaner than a silent no-op).
const OUTCOMES = ['correct', 'partial', 'incorrect'] as const
const SELF_CONFIDENCES = ['low', 'med', 'high', 'unknown'] as const

function isValidResult(value: unknown): value is AssessmentResult {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.conceptKey === 'string' &&
    typeof record.outcome === 'string' &&
    (OUTCOMES as readonly string[]).includes(record.outcome) &&
    typeof record.selfConfidence === 'string' &&
    (SELF_CONFIDENCES as readonly string[]).includes(record.selfConfidence)
  )
}

export async function POST(request: Request) {
  const auth = await clientFromBearerOrCookie(request)
  if ('error' in auth) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const rawResults = (body as { results?: unknown })?.results
  if (!Array.isArray(rawResults)) {
    return NextResponse.json({ error: 'Expected { results: [...] }.' }, { status: 400 })
  }

  // Keep the well-formed results, drop the rest (an unknown conceptKey is
  // dropped again inside seedFromAssessment against the live curriculum).
  const results = rawResults.filter(isValidResult)

  try {
    const { seededCount } = await seedFromAssessment(auth.supabase, auth.user.id, results)
    return NextResponse.json({ seededCount })
  } catch (error) {
    // Never leak the DB error text; onboarding failing should not hard-block a
    // first run -- the client can fall through to today's live calibration.
    console.error('api/onboarding: seed failed', error)
    return NextResponse.json({ error: 'Could not save your onboarding right now.' }, { status: 502 })
  }
}

export async function GET(request: Request) {
  const auth = await clientFromBearerOrCookie(request)
  if ('error' in auth) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  // "needed" = an empty profile (zero knowledge_nodes -- exactly
  // loadProfile's CALIBRATING_PROFILE trigger) that hasn't run onboarding
  // yet. A single count + one column read, not the full loadProfile.
  // (Note: the plan's InsightStrip.tsx, named as this signal's other
  // consumer, does not exist in this codebase -- retired by the Sprint 14
  // redesign before this sprint started. The overlay's Onboarding.tsx,
  // Task 7, is this signal's only client today.)
  const [{ count, error: countError }, { data: userRow, error: userError }] = await Promise.all([
    auth.supabase
      .from('knowledge_nodes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', auth.user.id)
      .is('deleted_at', null),
    auth.supabase.from('users').select('onboarding_completed_at').eq('id', auth.user.id).maybeSingle(),
  ])

  // Degrade safe: if either read fails, report onboarding NOT needed rather
  // than risk showing the assessment to someone who already has a profile.
  if (countError || userError) {
    return NextResponse.json({ needed: false })
  }

  const hasNodes = (count ?? 0) > 0
  const completed = Boolean((userRow as { onboarding_completed_at: string | null } | null)?.onboarding_completed_at)
  const needed = !hasNodes && !completed

  if (!needed) {
    return NextResponse.json({ needed: false })
  }

  // selectAssessmentItems() is pure/deterministic over @calyxa/curriculum --
  // no per-user input, so it is safe to compute fresh on every check rather
  // than cached; synthetic curriculum data, not user content, so it needs no
  // scrubbing on the way out.
  return NextResponse.json({ needed: true, items: selectAssessmentItems() })
}
