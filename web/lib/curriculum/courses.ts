// The web app's course taxonomy — PURE (no server-only, no Supabase, no model
// calls), so it is directly unit-testable.
//
// History: this replaces `lib/onboarding/item-bank.ts`, which held the six
// content strands (`algebra | geometry | algebra2 | precalc | calculus |
// stats`) recovered from a concept key's dotted prefix. That vocabulary is
// gone: the curriculum's top level is now the eleven COURSES students actually
// enrol in, and course membership is answered by `@calyxa/curriculum`'s
// catalog, not by parsing a key — a prefix cannot tell Calculus AB from BC,
// since both author `calculus.*` keys.
//
// (The file it replaces was itself the last remnant of Sprint 17's cold-start
// diagnostic item bank, retired at public launch; only the strand vocabulary
// had survived, which is what this supersedes.)
import {
  COURSE_ORDER,
  COURSE_LABELS,
  COURSE_SHORT_LABELS,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  COURSES,
  coursesInCategory,
  conceptKeysOfCourse,
  coursesOf,
  homeCourseOf,
  displayCourseOf,
  getCourse,
  unitOfConcept,
} from '@calyxa/curriculum'
import type { Course, CourseCategory, CourseUnit } from '@calyxa/curriculum'

export {
  COURSE_ORDER,
  COURSE_LABELS,
  COURSE_SHORT_LABELS,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  COURSES,
  coursesInCategory,
  conceptKeysOfCourse,
  coursesOf,
  homeCourseOf,
  displayCourseOf,
  getCourse,
  unitOfConcept,
}
export type { Course, CourseCategory, CourseUnit }

/** Label for a course key, falling back to the key so an unrecognized value is
 *  visible rather than blank. */
export function courseLabel(courseKey: string | null | undefined): string {
  if (!courseKey) return 'Unassigned'
  return COURSE_LABELS[courseKey] ?? courseKey
}

/** Short label for chips, tiles and narrow table columns. */
export function courseShortLabel(courseKey: string | null | undefined): string {
  if (!courseKey) return 'Unassigned'
  return COURSE_SHORT_LABELS[courseKey] ?? COURSE_LABELS[courseKey] ?? courseKey
}

/** The course a concept should be DISPLAYED under for this student: their own
 *  course when it teaches the concept, else the course that authors it. A key
 *  outside the graph (a legacy or renamed concept) returns null — callers show
 *  it in a trailing "Other" group rather than dropping it. */
export function courseOfConcept(conceptKey: string, studentCourse?: string | null): string | null {
  return displayCourseOf(conceptKey, studentCourse)
}

/** Course keys in display order, with the student's own course hoisted to the
 *  front. Everything else keeps catalog order, so the dashboard reads
 *  "your course first, then the rest of the curriculum". */
export function courseDisplayOrder(studentCourse?: string | null): readonly string[] {
  if (!studentCourse || !COURSE_ORDER.includes(studentCourse)) return COURSE_ORDER
  return [studentCourse, ...COURSE_ORDER.filter((key) => key !== studentCourse)]
}

// The five values the /start picker stored before the 11-course restructure,
// mapped forward. Accounts created under the old picker keep working without a
// migration: the value is read through here at every use site, so nothing
// rewrites `user_metadata`. `other` intentionally maps to null — the student
// told us their class was not on the list, which is not the same as us not
// having asked.
const LEGACY_MATH_CLASS_TO_COURSE: Record<string, string | null> = {
  algebra1: 'algebra-1',
  algebra2: 'algebra-2',
  geometry: 'geometry',
  precalculus: 'precalculus',
  other: null,
}

/** Resolve whatever the signup flow stored — a current course key, one of the
 *  five legacy `mathClass` values, or nothing — to a course key or null. */
export function courseKeyFromOnboarding(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  if (COURSE_ORDER.includes(value)) return value
  return LEGACY_MATH_CLASS_TO_COURSE[value] ?? null
}

/** Pull the student's course out of a Supabase `user_metadata` blob. The
 *  answers ride in `user_metadata.onboarding` (see /api/auth/signup); an
 *  account created before onboarding existed simply has none. */
export function courseFromUserMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null
  const onboarding = (metadata as { onboarding?: unknown }).onboarding
  if (!onboarding || typeof onboarding !== 'object') return null
  return courseKeyFromOnboarding((onboarding as { mathClass?: unknown }).mathClass)
}
