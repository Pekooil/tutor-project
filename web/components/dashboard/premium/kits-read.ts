import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getConcept } from '@calyxa/curriculum'
import { courseLabel, homeCourseOf } from '@/lib/curriculum/courses'

// Study kits (Sprint 21, study_artifact) grouped for the premium "Study kits"
// list view. RLS-scoped, never throws. A "kit" is the set of artifacts sharing
// a session_id (notes/problems/flashcards generated from one session); a
// session-less artifact stands alone. Payload internals aren't parsed here — the
// list shows which artifact kinds a kit produced, matching the design's tags.

type ArtifactRow = {
  id: string
  session_id: string | null
  kind: 'notes' | 'problems' | 'flashcards'
  concept_keys: string[] | null
  created_at: string
}

export type StudyKit = {
  key: string
  /** URL-safe id for the kit viewer route (`/kits/[href]`): the session id, or
   *  the artifact id for a session-less kit (no `artifact:` grouping prefix). */
  href: string
  title: string
  meta: string
  /** Every concept this kit covers (union across its rows) — for concept→kit glue. */
  conceptKeys: string[]
  kinds: { notes: boolean; problems: boolean; flashcards: boolean }
  createdAt: string
}

// Most-recent kit whose concepts include `conceptKey` → its viewer href, or null.
// Used by the concept/misconception detail views + the Overview "Practice next"
// list to link a weak concept straight to the kit that practices it.
export function kitHrefForConcept(kits: StudyKit[], conceptKey: string): string | null {
  for (const kit of kits) {
    if (kit.conceptKeys.includes(conceptKey)) return kit.href
  }
  return null
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export async function loadStudyKits(supabase: SupabaseClient): Promise<StudyKit[]> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return []

    const { data, error } = await supabase
      .from('study_artifact')
      .select('id, session_id, kind, concept_keys, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error || !data) return []

    const groups = new Map<string, ArtifactRow[]>()
    for (const row of data as ArtifactRow[]) {
      const groupKey = row.session_id ?? `artifact:${row.id}`
      const list = groups.get(groupKey)
      if (list) list.push(row)
      else groups.set(groupKey, [row])
    }

    const kits: StudyKit[] = []
    for (const [groupKey, rows] of groups) {
      const conceptKey = rows.map((r) => r.concept_keys?.[0]).find(Boolean)
      const concept = conceptKey ? getConcept(conceptKey) : null
      const courseKey = conceptKey ? homeCourseOf(conceptKey) : null
      const strandLabel = courseKey ? courseLabel(courseKey) : (concept?.strandLabel ?? 'Study session')
      const newest = rows.reduce((a, b) => (a.created_at > b.created_at ? a : b))
      const conceptKeys = [...new Set(rows.flatMap((r) => r.concept_keys ?? []))]
      kits.push({
        key: groupKey,
        // Route by the raw session id (or the artifact id for a session-less
        // kit); loadStudyKit resolves either form.
        href: rows[0].session_id ?? rows[0].id,
        title: concept?.title ?? 'Study kit',
        meta: `From your ${shortDate(newest.created_at)} session · ${strandLabel}`,
        conceptKeys,
        kinds: {
          notes: rows.some((r) => r.kind === 'notes'),
          problems: rows.some((r) => r.kind === 'problems'),
          flashcards: rows.some((r) => r.kind === 'flashcards'),
        },
        createdAt: newest.created_at,
      })
    }

    // Newest kit first (by the group's most-recent artifact).
    return kits
  } catch {
    return []
  }
}
