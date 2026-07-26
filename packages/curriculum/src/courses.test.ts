// Course-catalog invariants (11-course restructure). The catalog is the layer
// most likely to rot silently: a renamed concept key, a course that quietly
// stops teaching a unit, or an AB edit that never reaches BC would all produce
// a curriculum that still typechecks and still renders, just wrong. Each of
// those has a guard below.

import { describe, it, expect } from 'vitest'
import {
  COURSES,
  COURSE_ORDER,
  COURSE_LABELS,
  CATEGORY_ORDER,
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
import { CONCEPT_KEYS, prerequisitesOf } from './concepts'

// The eleven courses this restructure exists to cover, exactly.
const EXPECTED_COURSES = [
  'algebra-1',
  'geometry',
  'algebra-2',
  'precalculus',
  'ap-precalculus',
  'ap-calculus-ab',
  'ap-calculus-bc',
  'ap-statistics',
  'integrated-math-1',
  'integrated-math-2',
  'integrated-math-3',
] as const

describe('the course catalog', () => {
  it('is exactly the eleven courses, in category order', () => {
    expect(COURSE_ORDER).toEqual([...EXPECTED_COURSES])
    expect(COURSES).toHaveLength(11)
  })

  it('splits 4 core / 4 AP / 3 integrated', () => {
    expect(coursesInCategory('core').map((c) => c.key)).toEqual([
      'algebra-1',
      'geometry',
      'algebra-2',
      'precalculus',
    ])
    expect(coursesInCategory('ap')).toHaveLength(4)
    expect(coursesInCategory('integrated')).toHaveLength(3)
    // Every course belongs to a known category — no course can be stranded
    // out of the grouped picker by a typo'd category string.
    for (const course of COURSES) expect(CATEGORY_ORDER).toContain(course.category)
  })

  it('gives every course a label, a short label and at least four units', () => {
    for (const course of COURSES) {
      expect(course.label.length).toBeGreaterThan(0)
      expect(course.short.length).toBeGreaterThan(0)
      expect(COURSE_LABELS[course.key]).toBe(course.label)
      expect(course.units.length).toBeGreaterThanOrEqual(4)
      for (const unit of course.units) {
        expect(unit.label.length).toBeGreaterThan(0)
        expect(unit.concepts.length).toBeGreaterThan(0)
      }
    }
  })

  it('names no concept key that does not exist in the graph', () => {
    expect(danglingConceptKeys()).toEqual([])
  })

  it('leaves no concept untaught by any course', () => {
    // A concept no course teaches is unreachable curriculum — it can never be
    // shown, scheduled or generated into a study kit.
    expect(orphanConceptKeys()).toEqual([])
  })

  it('lists no concept twice within one course', () => {
    for (const course of COURSES) {
      const all = course.units.flatMap((unit) => unit.concepts)
      expect(new Set(all).size).toBe(all.length)
    }
  })
})

describe('course membership', () => {
  it('is one-to-many where courses genuinely share content', () => {
    // Factoring quadratics is taught by Algebra 1, Algebra 2 and Integrated
    // Math 2 — one key, several courses, one mastery record.
    const factoring = coursesOf('algebra.quadratics.factoring')
    expect(factoring).toEqual(expect.arrayContaining(['algebra-1', 'algebra-2', 'integrated-math-2']))

    // The integrated sequence re-uses core content rather than defining its own.
    for (const key of conceptKeysOfCourse('integrated-math-2')) {
      expect(coursesOf(key).length).toBeGreaterThan(1)
    }
  })

  it('attributes each concept to the course that authors it', () => {
    expect(homeCourseOf('algebra.quadratics.factoring')).toBe('algebra-1')
    expect(homeCourseOf('geometry.proofs.logic')).toBe('geometry')
    expect(homeCourseOf('algebra2.conics.sections')).toBe('algebra-2')
    expect(homeCourseOf('precalc.trig.laws')).toBe('precalculus')
    expect(homeCourseOf('calculus.integration.u-substitution')).toBe('ap-calculus-ab')
    expect(homeCourseOf('calculus.series.taylor-maclaurin')).toBe('ap-calculus-bc')
    expect(homeCourseOf('stats.inference.chi-square-gof')).toBe('ap-statistics')
    expect(homeCourseOf('not.a.real.key')).toBeNull()
  })

  it('prefers the student’s own course for display when it teaches the concept', () => {
    // An AP Stats student's dashboard should say "AP Statistics" for a
    // concept Algebra 1 happens to author.
    expect(displayCourseOf('stats.descriptive.measures')).toBe('ap-statistics')
    expect(displayCourseOf('stats.descriptive.measures', 'integrated-math-1')).toBe('integrated-math-1')
    // ...and fall back to the home course when their course does not teach it.
    expect(displayCourseOf('calculus.series.power', 'algebra-1')).toBe('ap-calculus-bc')
    expect(displayCourseOf('algebra.quadratics.factoring', 'ap-statistics')).toBe('algebra-1')
  })

  it('locates a concept inside its unit', () => {
    const unit = unitOfConcept('ap-statistics', 'stats.inference.slope')
    expect(unit?.label).toBe('Unit 9 · Inference for slopes')
    expect(unitOfConcept('algebra-1', 'stats.inference.slope')).toBeNull()
    expect(unitOfConcept('no-such-course', 'stats.inference.slope')).toBeNull()
  })
})

describe('AP Calculus BC', () => {
  it('is a strict superset of AB', () => {
    const ab = conceptKeysOfCourse('ap-calculus-ab')
    const bc = new Set(conceptKeysOfCourse('ap-calculus-bc'))
    for (const key of ab) expect(bc.has(key)).toBe(true)
    expect(bc.size).toBeGreaterThan(ab.length)
  })

  it('adds every BC-only concept and no AB concept is BC-only', () => {
    const bc = new Set(conceptKeysOfCourse('ap-calculus-bc'))
    for (const key of CALCULUS_BC_ONLY_KEYS) expect(bc.has(key)).toBe(true)
    const abKeys = new Set(CALCULUS_AB_KEYS)
    for (const key of CALCULUS_BC_ONLY_KEYS) expect(abKeys.has(key)).toBe(false)
  })

  it('teaches the two BC-only units', () => {
    const labels = getCourse('ap-calculus-bc')!.units.map((u) => u.label)
    expect(labels).toEqual(
      expect.arrayContaining([
        'Unit 9 · Parametric, polar & vector-valued functions',
        'Unit 10 · Infinite sequences & series',
      ])
    )
    expect(getCourse('ap-calculus-ab')!.units).toHaveLength(8)
    expect(getCourse('ap-calculus-bc')!.units).toHaveLength(10)
  })
})

describe('AP Statistics', () => {
  it('covers all nine College Board units', () => {
    expect(getCourse('ap-statistics')!.units).toHaveLength(9)
  })

  it('teaches the whole inference half, not just descriptive statistics', () => {
    // The gap this restructure closed: before it, the graph stopped at the
    // normal distribution and the course could not have been honestly claimed.
    const keys = new Set(conceptKeysOfCourse('ap-statistics'))
    for (const key of [
      'stats.sampling-distributions.proportion',
      'stats.sampling-distributions.mean',
      'stats.inference.ci-proportion',
      'stats.inference.test-proportion',
      'stats.inference.errors-power',
      'stats.inference.ci-mean',
      'stats.inference.test-mean',
      'stats.inference.chi-square-gof',
      'stats.inference.chi-square-independence',
      'stats.inference.slope',
    ]) {
      expect(keys.has(key)).toBe(true)
    }
    // Every statistics concept authored is actually taught by the course.
    for (const key of STATISTICS_KEYS) expect(coursesOf(key).length).toBeGreaterThan(0)
  })
})

describe('the integrated sequence', () => {
  it('spans algebra, geometry and statistics in every year', () => {
    // The defining property of integrated math: each year mixes the strands a
    // traditional sequence separates. If a year lost its geometry, it would
    // have quietly become Algebra 1/2 under another name.
    for (const key of ['integrated-math-1', 'integrated-math-2', 'integrated-math-3']) {
      const keys = conceptKeysOfCourse(key)
      expect(keys.some((k) => k.startsWith('algebra'))).toBe(true)
      expect(keys.some((k) => k.startsWith('stats.'))).toBe(true)
    }
    for (const key of ['integrated-math-1', 'integrated-math-2']) {
      expect(conceptKeysOfCourse(key).some((k) => k.startsWith('geometry.'))).toBe(true)
    }
  })

  it('introduces no concept of its own', () => {
    // Integrated math is a re-ordering of core content; anything unique to it
    // would be a concept the core courses are missing.
    for (const key of ['integrated-math-1', 'integrated-math-2', 'integrated-math-3']) {
      for (const conceptKey of conceptKeysOfCourse(key)) {
        expect(['integrated-math-1', 'integrated-math-2', 'integrated-math-3']).not.toContain(
          homeCourseOf(conceptKey)
        )
      }
    }
  })
})

describe('prerequisite reachability', () => {
  it('never sends a student to a concept no course teaches', () => {
    for (const key of CONCEPT_KEYS) {
      for (const prereq of prerequisitesOf(key)) {
        expect(coursesOf(prereq).length).toBeGreaterThan(0)
      }
    }
  })

  it('keeps each course’s prerequisites within the course or earlier ones', () => {
    // A prerequisite may sit outside the course (Calculus depends on
    // precalculus) but it must exist in the graph and be taught somewhere —
    // a dangling or untaught prerequisite is a dead end in the tutor's
    // remediation path.
    const known = new Set(CONCEPT_KEYS)
    for (const course of COURSES) {
      for (const key of conceptKeysOfCourse(course.key)) {
        for (const prereq of prerequisitesOf(key)) {
          expect(known.has(prereq)).toBe(true)
        }
      }
    }
  })
})
