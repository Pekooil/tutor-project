// The course catalog — the top-level curriculum vocabulary, replacing the six
// content "strands" (`algebra | geometry | algebra2 | precalc | calculus |
// stats`) that the dashboard, library, charts and onboarding used to group by.
//
// Eleven courses in three categories:
//
//   core        Algebra 1 · Geometry · Algebra 2 · Precalculus
//   ap          AP Precalculus · AP Calculus AB · AP Calculus BC · AP Statistics
//   integrated  Integrated Math 1 · Integrated Math 2 · Integrated Math 3
//
// A course is an ORDERED list of units, and a unit is an ordered list of
// concept keys. Courses overlap heavily and that is the point: Integrated
// Math 2 is a remix of Algebra 1, Geometry and Algebra 2 content rather than
// new mathematics, and AP Calculus BC is AB plus two units. Both are expressed
// by LISTING the same concept keys, never by copying concepts — the keys are
// the join column on `mastery_state`, `reinforcement_schedule` and
// `study_artifact`, so a duplicated key would split one student's mastery of
// one skill into several unrelated records.
//
// Consequences worth knowing:
//   · `conceptKeysOfCourse` is deduplicated and unit-ordered.
//   · `coursesOf` is one-to-many — factoring quadratics belongs to five courses.
//   · `homeCourseOf` is the single-course fallback for display when the student
//     has not told us their course; it is the module that AUTHORS the concept
//     (see `concepts/index.ts`), not a guess from the key prefix, because
//     `calculus.*` spans both AB and BC.
import {
  CONCEPT_KEYS,
  CONCEPT_MODULES,
  CALCULUS_AB_CONCEPTS,
  CALCULUS_BC_CONCEPTS,
  STATISTICS_CONCEPTS,
} from './concepts/index'

export type CourseCategory = 'core' | 'ap' | 'integrated'

export type CourseUnit = {
  /** Display name of the unit, in the course's own language. */
  label: string
  /** Concept keys, in teaching order. Keys may appear in other courses too. */
  concepts: readonly string[]
}

export type Course = {
  key: string
  category: CourseCategory
  /** Full name, as a student would name their class. */
  label: string
  /** Compact name for chips, tiles and narrow columns. */
  short: string
  units: readonly CourseUnit[]
}

export const CATEGORY_ORDER: readonly CourseCategory[] = ['core', 'ap', 'integrated']

export const CATEGORY_LABELS: Record<CourseCategory, string> = {
  core: 'Core courses',
  ap: 'AP courses',
  integrated: 'Integrated math sequence',
}

// ── Shared unit fragments ──────────────────────────────────────────────────
// Named so the courses that genuinely share a block of teaching read as
// sharing it, instead of repeating a key list that could drift apart.

const TRIG_CORE = [
  'precalc.unit-circle.radians',
  'precalc.trig.graphs',
  'precalc.trig.identities',
  'precalc.trig.equations',
  'precalc.trig.inverse',
  'precalc.trig.laws',
] as const

const EXP_LOG_CORE = [
  'algebra2.exponential.functions',
  'algebra2.logarithms.intro',
  'algebra2.logarithms.properties',
] as const

// ── Core courses ───────────────────────────────────────────────────────────

const ALGEBRA_1: Course = {
  key: 'algebra-1',
  category: 'core',
  label: 'Algebra 1',
  short: 'Algebra 1',
  units: [
    {
      label: 'Expressions & equations',
      concepts: [
        'algebra.linear-equations.one-variable',
        'algebra.absolute-value.equations',
        'algebra.ratios.proportions',
        'algebra.ratios.percent',
      ],
    },
    {
      label: 'Linear functions',
      concepts: [
        'algebra.linear-equations.two-variable',
        'algebra.linear.slope-forms',
        'algebra.functions.notation',
        'algebra.functions.graphs',
      ],
    },
    {
      label: 'Inequalities',
      concepts: [
        'algebra.inequalities.linear',
        'algebra.absolute-value.inequalities',
        'algebra.inequalities.systems',
      ],
    },
    { label: 'Systems of equations', concepts: ['algebra.systems.elimination-substitution'] },
    {
      label: 'Exponents & radicals',
      concepts: [
        'algebra.exponents.product-rule',
        'algebra.exponents.power-rule',
        'algebra.radicals.simplifying',
        'algebra.radicals.rational-exponents',
      ],
    },
    {
      label: 'Polynomials & quadratics',
      concepts: ['algebra.polynomials.expanding', 'algebra.quadratics.factoring', 'algebra.quadratics.formula'],
    },
    {
      label: 'Exponential functions & sequences',
      concepts: ['algebra.exponential.growth', 'algebra.sequences.patterns'],
    },
    {
      label: 'Data & statistics',
      concepts: ['stats.descriptive.measures', 'stats.data.displays', 'algebra.data.scatter-plots'],
    },
  ],
}

const GEOMETRY: Course = {
  key: 'geometry',
  category: 'core',
  label: 'Geometry',
  short: 'Geometry',
  units: [
    { label: 'Proof & reasoning', concepts: ['geometry.proofs.logic', 'geometry.constructions.compass'] },
    { label: 'Lines & angles', concepts: ['geometry.angles.parallel-lines'] },
    { label: 'Triangles', concepts: ['geometry.triangles.congruence', 'geometry.triangles.similarity'] },
    { label: 'Right triangles & trigonometry', concepts: ['geometry.trig.right-triangle'] },
    { label: 'Quadrilaterals & polygons', concepts: ['geometry.quadrilaterals.properties'] },
    {
      label: 'Circles',
      concepts: ['geometry.circles.arcs-angles', 'geometry.circles.area-circumference', 'geometry.circles.equations'],
    },
    {
      label: 'Area & volume',
      concepts: ['geometry.measurement.area', 'geometry.measurement.volume', 'geometry.solids.cross-sections'],
    },
    {
      label: 'Coordinate geometry & transformations',
      concepts: ['geometry.coordinate.distance-midpoint', 'geometry.transformations.rigid-and-dilation'],
    },
    { label: 'Probability', concepts: ['stats.probability.rules', 'geometry.probability.geometric'] },
  ],
}

const ALGEBRA_2: Course = {
  key: 'algebra-2',
  category: 'core',
  label: 'Algebra 2',
  short: 'Algebra 2',
  units: [
    {
      label: 'Functions & transformations',
      concepts: [
        'algebra2.functions.transformations',
        'algebra2.functions.inverses',
        'algebra2.functions.piecewise',
      ],
    },
    {
      label: 'Quadratics & complex numbers',
      concepts: ['algebra.quadratics.factoring', 'algebra.quadratics.formula', 'algebra2.complex.numbers'],
    },
    {
      label: 'Polynomial functions',
      concepts: ['algebra2.polynomials.division-factor-theorem', 'algebra2.polynomials.graphing'],
    },
    {
      label: 'Rational & radical functions',
      concepts: [
        'algebra2.rational.simplifying',
        'algebra2.rational.equations',
        'algebra2.rational.asymptotes',
        'algebra2.radical.equations',
      ],
    },
    { label: 'Exponential & logarithmic functions', concepts: [...EXP_LOG_CORE] },
    {
      label: 'Sequences & series',
      concepts: ['algebra2.sequences.arithmetic', 'algebra2.sequences.geometric', 'algebra2.sequences.summation'],
    },
    {
      label: 'Systems, conics & matrices',
      concepts: ['algebra2.systems.nonlinear', 'algebra2.conics.sections', 'algebra2.matrices.operations'],
    },
    { label: 'Statistics', concepts: ['stats.data.displays', 'stats.distributions.normal'] },
  ],
}

const PRECALCULUS: Course = {
  key: 'precalculus',
  category: 'core',
  label: 'Precalculus',
  short: 'Precalculus',
  units: [
    {
      label: 'Functions & graphs',
      concepts: [
        'algebra2.functions.transformations',
        'algebra2.functions.inverses',
        'algebra2.functions.piecewise',
        'precalc.functions.rates-of-change',
      ],
    },
    {
      label: 'Polynomial & rational functions',
      concepts: ['algebra2.polynomials.graphing', 'algebra2.rational.asymptotes'],
    },
    {
      label: 'Exponential & logarithmic functions',
      concepts: ['algebra2.logarithms.properties', 'precalc.exponential.log-modeling'],
    },
    { label: 'Trigonometry', concepts: [...TRIG_CORE] },
    {
      label: 'Polar & parametric',
      concepts: ['precalc.polar.coordinates', 'precalc.polar.graphs', 'precalc.parametric.functions'],
    },
    {
      label: 'Vectors & matrices',
      concepts: ['precalc.vectors.operations', 'algebra2.matrices.operations', 'precalc.matrices.transformations'],
    },
    { label: 'Conics & series', concepts: ['algebra2.conics.sections', 'algebra2.sequences.summation'] },
    { label: 'Introduction to limits', concepts: ['precalc.limits.intuitive'] },
  ],
}

// ── AP courses ─────────────────────────────────────────────────────────────

// The College Board's four units. Deliberately NOT the same as `precalculus`:
// AP Precalculus does not examine conic sections or limits, and it does add
// semi-log plots and matrices-as-transformations, which a conventional course
// often skips.
const AP_PRECALCULUS: Course = {
  key: 'ap-precalculus',
  category: 'ap',
  label: 'AP Precalculus',
  short: 'AP Precalc',
  units: [
    {
      label: 'Unit 1 · Polynomial & rational functions',
      concepts: [
        'precalc.functions.rates-of-change',
        'algebra2.functions.transformations',
        'algebra2.functions.piecewise',
        'algebra2.polynomials.graphing',
        'algebra2.rational.asymptotes',
      ],
    },
    {
      label: 'Unit 2 · Exponential & logarithmic functions',
      concepts: [
        ...EXP_LOG_CORE,
        'algebra2.sequences.arithmetic',
        'algebra2.sequences.geometric',
        'precalc.exponential.log-modeling',
        'precalc.modeling.semi-log',
      ],
    },
    {
      label: 'Unit 3 · Trigonometric & polar functions',
      concepts: [...TRIG_CORE, 'precalc.polar.coordinates', 'precalc.polar.graphs'],
    },
    {
      label: 'Unit 4 · Functions involving parameters, vectors & matrices',
      concepts: [
        'algebra2.functions.inverses',
        'precalc.parametric.functions',
        'precalc.vectors.operations',
        'algebra2.matrices.operations',
        'precalc.matrices.transformations',
      ],
    },
  ],
}

const AP_CALCULUS_AB: Course = {
  key: 'ap-calculus-ab',
  category: 'ap',
  label: 'AP Calculus AB',
  short: 'AP Calc AB',
  units: [
    {
      label: 'Unit 1 · Limits & continuity',
      concepts: ['calculus.limits.formal', 'calculus.limits.asymptotes', 'calculus.limits.squeeze-ivt'],
    },
    {
      label: 'Unit 2 · Differentiation: definition & basic rules',
      concepts: [
        'calculus.derivatives.as-limit',
        'calculus.differentiation.power-rule',
        'calculus.differentiation.product-rule',
        'calculus.differentiation.quotient-rule',
        'calculus.differentiation.trig',
        'calculus.differentiation.exp-log',
      ],
    },
    {
      label: 'Unit 3 · Composite, implicit & inverse functions',
      concepts: [
        'calculus.differentiation.chain-rule',
        'calculus.differentiation.implicit',
        'calculus.differentiation.inverse-functions',
        'calculus.differentiation.higher-order',
      ],
    },
    {
      label: 'Unit 4 · Contextual applications of differentiation',
      concepts: [
        'calculus.applications.motion',
        'calculus.applications.related-rates',
        'calculus.applications.linearization',
        'calculus.limits.lhopital',
      ],
    },
    {
      label: 'Unit 5 · Analytical applications of differentiation',
      concepts: [
        'calculus.applications.mvt',
        'calculus.applications.curve-sketching',
        'calculus.applications.optimization',
      ],
    },
    {
      label: 'Unit 6 · Integration & accumulation of change',
      concepts: [
        'calculus.integration.riemann-sums',
        'calculus.integration.antiderivatives',
        'calculus.integration.definite-ftc',
        'calculus.integration.u-substitution',
      ],
    },
    {
      label: 'Unit 7 · Differential equations',
      concepts: ['calculus.differential-equations.intro', 'calculus.differential-equations.exponential-model'],
    },
    {
      label: 'Unit 8 · Applications of integration',
      concepts: [
        'calculus.integration.average-value',
        'calculus.integration.area-between-curves',
        'calculus.integration.volumes-cross-sections',
        'calculus.integration.volumes',
      ],
    },
  ],
}

// BC is a strict superset of AB: units 1-5 are identical, units 6-8 gain the
// BC techniques, and units 9-10 are BC-only. `courses.test.ts` asserts the
// superset relationship holds, so an AB edit can never silently drop out of BC.
const AP_CALCULUS_BC: Course = {
  key: 'ap-calculus-bc',
  category: 'ap',
  label: 'AP Calculus BC',
  short: 'AP Calc BC',
  units: [
    ...AP_CALCULUS_AB.units.slice(0, 5),
    {
      label: 'Unit 6 · Integration & accumulation of change',
      concepts: [
        ...AP_CALCULUS_AB.units[5].concepts,
        'calculus.integration.by-parts',
        'calculus.integration.partial-fractions',
        'calculus.integration.improper',
      ],
    },
    {
      label: 'Unit 7 · Differential equations',
      concepts: [
        ...AP_CALCULUS_AB.units[6].concepts,
        'calculus.differential-equations.euler',
        'calculus.differential-equations.logistic',
      ],
    },
    {
      label: 'Unit 8 · Applications of integration',
      concepts: [...AP_CALCULUS_AB.units[7].concepts, 'calculus.integration.arc-length'],
    },
    {
      label: 'Unit 9 · Parametric, polar & vector-valued functions',
      concepts: [
        'precalc.parametric.functions',
        'calculus.parametric.calculus',
        'calculus.vector-valued.motion',
        'precalc.polar.graphs',
        'calculus.polar.calculus',
      ],
    },
    {
      label: 'Unit 10 · Infinite sequences & series',
      concepts: [
        'calculus.sequences.convergence',
        'calculus.series.convergence-tests',
        'calculus.series.alternating-error',
        'calculus.series.power',
        'calculus.series.taylor-maclaurin',
        'calculus.series.lagrange-error',
      ],
    },
  ],
}

const AP_STATISTICS: Course = {
  key: 'ap-statistics',
  category: 'ap',
  label: 'AP Statistics',
  short: 'AP Stats',
  units: [
    {
      label: 'Unit 1 · Exploring one-variable data',
      concepts: [
        'stats.descriptive.measures',
        'stats.data.displays',
        'stats.data.position',
        'stats.distributions.normal',
      ],
    },
    {
      label: 'Unit 2 · Exploring two-variable data',
      concepts: [
        'stats.data.two-way-tables',
        'stats.regression.scatterplots-correlation',
        'stats.regression.least-squares',
        'stats.regression.residuals',
      ],
    },
    {
      label: 'Unit 3 · Collecting data',
      concepts: ['stats.sampling.methods', 'stats.experiments.design', 'stats.scope.inference'],
    },
    {
      label: 'Unit 4 · Probability, random variables & distributions',
      concepts: [
        'stats.probability.rules',
        'stats.probability.counting',
        'stats.probability.conditional',
        'stats.probability.simulation',
        'stats.random-variables.expected-value',
        'stats.random-variables.combining',
        'stats.random-variables.binomial',
        'stats.random-variables.geometric',
      ],
    },
    {
      label: 'Unit 5 · Sampling distributions',
      concepts: ['stats.sampling-distributions.proportion', 'stats.sampling-distributions.mean'],
    },
    {
      label: 'Unit 6 · Inference for proportions',
      concepts: [
        'stats.inference.ci-proportion',
        'stats.inference.test-proportion',
        'stats.inference.errors-power',
        'stats.inference.two-proportions',
      ],
    },
    {
      label: 'Unit 7 · Inference for means',
      concepts: ['stats.inference.ci-mean', 'stats.inference.test-mean', 'stats.inference.two-means'],
    },
    {
      label: 'Unit 8 · Chi-square inference',
      concepts: ['stats.inference.chi-square-gof', 'stats.inference.chi-square-independence'],
    },
    { label: 'Unit 9 · Inference for slopes', concepts: ['stats.inference.slope'] },
  ],
}

// ── Integrated math sequence ───────────────────────────────────────────────
// These three are remixes, not new mathematics: every key below is authored in
// a core-course module. The sequence front-loads statistics and puts geometry
// alongside algebra each year, which is exactly what the unit ordering shows.

const INTEGRATED_MATH_1: Course = {
  key: 'integrated-math-1',
  category: 'integrated',
  label: 'Integrated Math 1',
  short: 'Int Math 1',
  units: [
    {
      label: 'Linear equations & inequalities',
      concepts: [
        'algebra.linear-equations.one-variable',
        'algebra.linear-equations.two-variable',
        'algebra.linear.slope-forms',
        'algebra.inequalities.linear',
      ],
    },
    {
      label: 'Functions & sequences',
      concepts: ['algebra.functions.notation', 'algebra.functions.graphs', 'algebra.sequences.patterns'],
    },
    {
      label: 'Systems',
      concepts: ['algebra.systems.elimination-substitution', 'algebra.inequalities.systems'],
    },
    {
      label: 'Exponential functions',
      concepts: ['algebra.exponents.product-rule', 'algebra.exponents.power-rule', 'algebra.exponential.growth'],
    },
    {
      label: 'One- & two-variable statistics',
      concepts: [
        'stats.descriptive.measures',
        'stats.data.displays',
        'algebra.data.scatter-plots',
        'stats.data.two-way-tables',
      ],
    },
    {
      label: 'Transformations & congruence',
      concepts: [
        'geometry.transformations.rigid-and-dilation',
        'geometry.angles.parallel-lines',
        'geometry.triangles.congruence',
      ],
    },
    { label: 'Coordinate geometry', concepts: ['geometry.coordinate.distance-midpoint'] },
  ],
}

const INTEGRATED_MATH_2: Course = {
  key: 'integrated-math-2',
  category: 'integrated',
  label: 'Integrated Math 2',
  short: 'Int Math 2',
  units: [
    {
      label: 'Quadratic functions',
      concepts: [
        'algebra.polynomials.expanding',
        'algebra.quadratics.factoring',
        'algebra.quadratics.formula',
        'algebra2.functions.transformations',
      ],
    },
    {
      label: 'Radicals & complex numbers',
      concepts: [
        'algebra.radicals.simplifying',
        'algebra.radicals.rational-exponents',
        'algebra2.complex.numbers',
      ],
    },
    {
      label: 'Absolute value & piecewise functions',
      concepts: [
        'algebra.absolute-value.equations',
        'algebra.absolute-value.inequalities',
        'algebra2.functions.piecewise',
      ],
    },
    { label: 'Proof & quadrilaterals', concepts: ['geometry.proofs.logic', 'geometry.quadrilaterals.properties'] },
    {
      label: 'Similarity & right-triangle trigonometry',
      concepts: ['geometry.triangles.similarity', 'geometry.trig.right-triangle'],
    },
    {
      label: 'Circles',
      concepts: ['geometry.circles.arcs-angles', 'geometry.circles.area-circumference', 'geometry.circles.equations'],
    },
    {
      label: 'Area & volume',
      concepts: ['geometry.measurement.area', 'geometry.measurement.volume', 'geometry.solids.cross-sections'],
    },
    {
      label: 'Probability',
      concepts: [
        'stats.probability.rules',
        'stats.probability.counting',
        'stats.probability.conditional',
        'geometry.probability.geometric',
      ],
    },
  ],
}

const INTEGRATED_MATH_3: Course = {
  key: 'integrated-math-3',
  category: 'integrated',
  label: 'Integrated Math 3',
  short: 'Int Math 3',
  units: [
    {
      label: 'Polynomial functions',
      concepts: ['algebra2.polynomials.division-factor-theorem', 'algebra2.polynomials.graphing'],
    },
    {
      label: 'Rational & radical functions',
      concepts: [
        'algebra2.rational.simplifying',
        'algebra2.rational.equations',
        'algebra2.rational.asymptotes',
        'algebra2.radical.equations',
      ],
    },
    { label: 'Exponential & logarithmic functions', concepts: [...EXP_LOG_CORE] },
    {
      label: 'Sequences & series',
      concepts: ['algebra2.sequences.arithmetic', 'algebra2.sequences.geometric', 'algebra2.sequences.summation'],
    },
    {
      label: 'Trigonometric functions',
      concepts: [
        'precalc.unit-circle.radians',
        'precalc.trig.graphs',
        'precalc.trig.identities',
        'precalc.trig.laws',
      ],
    },
    {
      label: 'Functions & modelling',
      concepts: [
        'algebra2.functions.transformations',
        'algebra2.functions.inverses',
        'precalc.functions.rates-of-change',
      ],
    },
    { label: 'Systems & conics', concepts: ['algebra2.systems.nonlinear', 'algebra2.conics.sections'] },
    {
      label: 'Statistics & inference',
      concepts: [
        'stats.sampling.methods',
        'stats.experiments.design',
        'stats.distributions.normal',
        'stats.regression.least-squares',
        'stats.scope.inference',
      ],
    },
  ],
}

// ── Catalog & accessors ────────────────────────────────────────────────────

/** All eleven courses, grouped by category in `CATEGORY_ORDER`. The order here
 *  is the display order everywhere and the tie-break order for `coursesOf`. */
export const COURSES: readonly Course[] = [
  ALGEBRA_1,
  GEOMETRY,
  ALGEBRA_2,
  PRECALCULUS,
  AP_PRECALCULUS,
  AP_CALCULUS_AB,
  AP_CALCULUS_BC,
  AP_STATISTICS,
  INTEGRATED_MATH_1,
  INTEGRATED_MATH_2,
  INTEGRATED_MATH_3,
]

export const COURSE_ORDER: readonly string[] = COURSES.map((course) => course.key)

export const COURSE_LABELS: Record<string, string> = Object.fromEntries(
  COURSES.map((course) => [course.key, course.label])
)

export const COURSE_SHORT_LABELS: Record<string, string> = Object.fromEntries(
  COURSES.map((course) => [course.key, course.short])
)

const COURSES_BY_KEY: ReadonlyMap<string, Course> = new Map(COURSES.map((course) => [course.key, course]))

export function getCourse(key: string): Course | undefined {
  return COURSES_BY_KEY.get(key)
}

export function coursesInCategory(category: CourseCategory): readonly Course[] {
  return COURSES.filter((course) => course.category === category)
}

const COURSE_CONCEPTS: ReadonlyMap<string, readonly string[]> = new Map(
  COURSES.map((course) => [
    course.key,
    [...new Set(course.units.flatMap((unit) => unit.concepts))] as readonly string[],
  ])
)

/** Every concept key a course teaches, deduplicated, in unit order. */
export function conceptKeysOfCourse(courseKey: string): readonly string[] {
  return COURSE_CONCEPTS.get(courseKey) ?? []
}

const CONCEPT_TO_COURSES = (() => {
  const map = new Map<string, string[]>()
  for (const course of COURSES) {
    for (const key of conceptKeysOfCourse(course.key)) {
      const list = map.get(key)
      if (list) list.push(course.key)
      else map.set(key, [course.key])
    }
  }
  return map as ReadonlyMap<string, readonly string[]>
})()

/** Every course that teaches this concept, in `COURSE_ORDER`. One-to-many by
 *  design — `algebra.quadratics.factoring` is taught by five of the eleven. */
export function coursesOf(conceptKey: string): readonly string[] {
  return CONCEPT_TO_COURSES.get(conceptKey) ?? []
}

const CONCEPT_TO_HOME = (() => {
  const map = new Map<string, string>()
  for (const module of CONCEPT_MODULES) {
    for (const concept of module.concepts) map.set(concept.key, module.courseKey)
  }
  return map as ReadonlyMap<string, string>
})()

/** The course that AUTHORS this concept — the single-course attribution used
 *  for display when the student has not selected a course. Falls back to the
 *  first course that teaches it, then to `null` for an unknown key. */
export function homeCourseOf(conceptKey: string): string | null {
  return CONCEPT_TO_HOME.get(conceptKey) ?? coursesOf(conceptKey)[0] ?? null
}

/** The course to attribute a concept to for a student taking `courseKey`:
 *  their own course when it teaches the concept, otherwise the home course.
 *  This is what keeps an AP Stats student's dashboard saying "AP Statistics"
 *  for a concept Algebra 1 happens to author. */
export function displayCourseOf(conceptKey: string, courseKey?: string | null): string | null {
  if (courseKey && coursesOf(conceptKey).includes(courseKey)) return courseKey
  return homeCourseOf(conceptKey)
}

/** The unit a concept sits in within a course, or null if the course does not
 *  teach it. */
export function unitOfConcept(courseKey: string, conceptKey: string): CourseUnit | null {
  const course = getCourse(courseKey)
  if (!course) return null
  return course.units.find((unit) => unit.concepts.includes(conceptKey)) ?? null
}

/** Concept keys referenced by a course but absent from the graph. Empty in a
 *  healthy build; `courses.test.ts` asserts that. Exported so a future
 *  data-authoring script can check its own work without importing the test. */
export function danglingConceptKeys(): readonly string[] {
  const known = new Set(CONCEPT_KEYS)
  const missing = new Set<string>()
  for (const course of COURSES) {
    for (const key of conceptKeysOfCourse(course.key)) {
      if (!known.has(key)) missing.add(key)
    }
  }
  return [...missing]
}

/** Concept keys in the graph that no course teaches — dead curriculum. Empty
 *  in a healthy build. */
export function orphanConceptKeys(): readonly string[] {
  return CONCEPT_KEYS.filter((key) => coursesOf(key).length === 0)
}

// Re-exported so consumers can reason about the AB ⊂ BC relationship and the
// statistics module without reaching into `./concepts/*` paths directly.
export const CALCULUS_AB_KEYS: readonly string[] = CALCULUS_AB_CONCEPTS.map((c) => c.key)
export const CALCULUS_BC_ONLY_KEYS: readonly string[] = CALCULUS_BC_CONCEPTS.map((c) => c.key)
export const STATISTICS_KEYS: readonly string[] = STATISTICS_CONCEPTS.map((c) => c.key)
