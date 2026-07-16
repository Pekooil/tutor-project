import { NextResponse } from 'next/server'
import { getConcept } from '@calyxa/curriculum'
import { clientFromBearer } from '@/lib/auth/bearer'
import { loadProfile } from '@/lib/learning/profile-read'

// The first read-only surface onto the learning profile (Sprint 13, ADR-024/025).
// Every prior consumer of `loadProfile` (the turn route) injects it into a
// prompt; this route serializes the SAME read for DISPLAY -- no new query
// shape, no new table, no topic bias (this is "where you are overall," not
// the turn's page-relevant read, so no topicKeys are passed). Concept keys
// are resolved to their curriculum `title` here, server-side, so the
// extension never imports @calyxa/curriculum and never re-derives display
// text client-side (ADR-024's server-rendered-display decision). No write,
// no model call, no free-tier interaction -- a plain authenticated read.

// Falls back to the raw key if a concept somehow isn't in the curriculum
// graph (e.g. a stale knowledge_nodes row from a since-removed concept) --
// this endpoint must never 500 on curriculum drift; a raw key beats a
// broken overview.
function titleFor(conceptKey: string): string {
  return getConcept(conceptKey)?.title ?? conceptKey
}

export async function GET(request: Request) {
  const auth = await clientFromBearer(request)

  if ('error' in auth) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  // No topicKeys: the overview is the user-level "where you are," not a
  // page-biased read -- the turn route keeps its own bias (ADR-021)
  // unaffected by this endpoint, which deliberately takes no page input.
  const profile = await loadProfile(auth.supabase, { userId: auth.user.id })

  // loadProfile degrades to the empty "calibrating" profile (masteryNodes:
  // [], activeMisconceptions: [], no dueForReview) on a fresh user or any
  // query failure -- an empty masteryNodes list is exactly that signal,
  // the same check the prompt's calibrating fallback relies on.
  const calibrating = profile.masteryNodes.length === 0

  return NextResponse.json({
    calibrating,
    mastery: profile.masteryNodes.map((node) => ({
      conceptKey: node.conceptKey,
      title: titleFor(node.conceptKey),
      mastery: node.mastery,
      state: node.state,
      confidenceBand: node.confidenceBand,
      // Sprint 15 fix pass round 2: lets the overlay's overview card sort
      // by recency ("top 3 recently updated topics") client-side.
      lastPracticedAt: node.lastPracticedAt ?? null,
    })),
    weakSpots: profile.activeMisconceptions.map((misconception) => ({
      conceptKey: misconception.conceptKey,
      title: titleFor(misconception.conceptKey),
      category: misconception.category,
      description: misconception.description,
    })),
    dueForReview: (profile.dueForReview ?? []).map((item) => ({
      conceptKey: item.conceptKey,
      title: titleFor(item.conceptKey),
      reason: item.reason,
    })),
  })
}
