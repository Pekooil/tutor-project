// Public surface of @calyxa/curriculum (pure — no server-only, no Supabase,
// no model calls). Two layers:
//
//   CONCEPTS   the graph — one entry per skill, globally unique key, the join
//              column on mastery_state / reinforcement_schedule /
//              study_artifact. `topic.ts` derives its detection table from
//              `aliases` at import time (ADR-032).
//
//   COURSES    the eleven courses students actually enrol in, in three
//              categories, each an ordered list of units over those same keys.
//              This replaced the six content "strands" as the top-level
//              grouping vocabulary; courses overlap, concepts do not.
export { CONCEPTS, CONCEPT_KEYS, getConcept, prerequisitesOf } from './concepts'
export type { Concept } from './concepts'

export {
  COURSES,
  COURSE_ORDER,
  COURSE_LABELS,
  COURSE_SHORT_LABELS,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  getCourse,
  coursesInCategory,
  conceptKeysOfCourse,
  coursesOf,
  homeCourseOf,
  displayCourseOf,
  unitOfConcept,
  danglingConceptKeys,
  orphanConceptKeys,
  CALCULUS_AB_KEYS,
  CALCULUS_BC_ONLY_KEYS,
  STATISTICS_KEYS,
} from './courses'
export type { Course, CourseUnit, CourseCategory } from './courses'
