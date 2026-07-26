// Calculus BC-only content — the material AP Calculus BC adds on top of the
// whole of AB. New file with the 11-course restructure; before it, BC could
// not have been claimed at all (no series, no parametric/polar, no advanced
// integration).
//
// BC is a strict superset of AB, so the `ap-calculus-bc` course lists every
// `calculus-ab.ts` concept first and then these. Nothing here is duplicated
// from AB, and every prerequisite below points into AB — which is what makes
// the superset relationship checkable in `courses.test.ts`.
//
// Ordered by where the CED puts each item: BC extensions inside units 6-8,
// then the two BC-only units:
//
//   6 integration (by parts, partial fractions, improper)
//   7 differential equations (Euler, logistic)
//   8 applications (arc length)
//   9 parametric, polar & vector-valued functions
//  10 infinite sequences & series
import type { Concept } from './types'

export const CALCULUS_BC_CONCEPTS: readonly Concept[] = [
  // ── Unit 6 (BC) · Further integration techniques ─────────────────────────
  {
    key: 'calculus.integration.by-parts',
    strand: 'integration-techniques',
    title: 'Integration by parts',
    strandLabel: 'Integration techniques',
    prerequisites: ['calculus.integration.u-substitution', 'calculus.differentiation.product-rule'],
    difficultyPrior: 0.75,
    aliases: ['integration by parts', 'LIATE', 'u dv integration', 'parts formula'],
  },
  {
    key: 'calculus.integration.partial-fractions',
    strand: 'integration-techniques',
    title: 'Integration by partial fractions',
    strandLabel: 'Integration techniques',
    prerequisites: ['calculus.integration.u-substitution', 'algebra2.rational.simplifying'],
    difficultyPrior: 0.75,
    aliases: ['partial fractions', 'partial fraction decomposition', 'integrating a rational function'],
  },
  {
    key: 'calculus.integration.improper',
    strand: 'integration-techniques',
    title: 'Improper integrals',
    strandLabel: 'Integration techniques',
    prerequisites: ['calculus.integration.definite-ftc', 'calculus.limits.asymptotes'],
    difficultyPrior: 0.75,
    aliases: ['improper integral', 'integral to infinity', 'divergent integral', 'discontinuous integrand'],
  },

  // ── Unit 7 (BC) · Differential equations ─────────────────────────────────
  {
    key: 'calculus.differential-equations.euler',
    strand: 'differential-equations',
    title: "Euler's method",
    strandLabel: 'Differential equations',
    prerequisites: ['calculus.differential-equations.intro', 'calculus.applications.linearization'],
    difficultyPrior: 0.75,
    aliases: ["euler's method", 'numerical approximation of a solution', 'step size'],
  },
  {
    key: 'calculus.differential-equations.logistic',
    strand: 'differential-equations',
    title: 'Logistic growth models',
    strandLabel: 'Differential equations',
    prerequisites: ['calculus.differential-equations.exponential-model'],
    difficultyPrior: 0.8,
    aliases: ['logistic growth', 'carrying capacity', 'logistic differential equation'],
  },

  // ── Unit 8 (BC) · Applications of integration ────────────────────────────
  {
    key: 'calculus.integration.arc-length',
    strand: 'applications-of-integration',
    title: 'Arc length & distance travelled',
    strandLabel: 'Applications of integration',
    prerequisites: ['calculus.integration.definite-ftc', 'calculus.applications.motion'],
    difficultyPrior: 0.8,
    aliases: ['arc length', 'length of a curve', 'total distance travelled'],
  },

  // ── Unit 9 · Parametric, polar & vector-valued functions ─────────────────
  {
    key: 'calculus.parametric.calculus',
    strand: 'parametric-polar-vector',
    title: 'Calculus of parametric equations',
    strandLabel: 'Parametric, polar & vector',
    prerequisites: ['calculus.differentiation.chain-rule', 'precalc.parametric.functions'],
    difficultyPrior: 0.8,
    aliases: ['parametric derivative', 'dy/dx parametric', 'second derivative parametric', 'parametric arc length'],
  },
  {
    key: 'calculus.vector-valued.motion',
    strand: 'parametric-polar-vector',
    title: 'Vector-valued functions & planar motion',
    strandLabel: 'Parametric, polar & vector',
    prerequisites: ['calculus.parametric.calculus', 'precalc.vectors.operations'],
    difficultyPrior: 0.8,
    aliases: ['vector valued function', 'planar motion', 'velocity vector', 'speed as a magnitude'],
  },
  {
    key: 'calculus.polar.calculus',
    strand: 'parametric-polar-vector',
    title: 'Calculus in polar coordinates',
    strandLabel: 'Parametric, polar & vector',
    prerequisites: ['calculus.integration.area-between-curves', 'precalc.polar.graphs'],
    difficultyPrior: 0.8,
    aliases: ['polar area', 'area inside a polar curve', 'polar derivative', 'area between polar curves'],
  },

  // ── Unit 10 · Infinite sequences & series ────────────────────────────────
  {
    key: 'calculus.sequences.convergence',
    strand: 'series',
    title: 'Sequences & the idea of convergence',
    strandLabel: 'Infinite series',
    prerequisites: ['calculus.limits.asymptotes', 'algebra2.sequences.geometric'],
    difficultyPrior: 0.7,
    aliases: ['convergent sequence', 'divergent sequence', 'limit of a sequence', 'nth term test'],
  },
  {
    key: 'calculus.series.convergence-tests',
    strand: 'series',
    title: 'Series convergence tests',
    strandLabel: 'Infinite series',
    prerequisites: ['calculus.sequences.convergence', 'calculus.integration.improper'],
    difficultyPrior: 0.85,
    aliases: ['ratio test', 'integral test', 'comparison test', 'p-series', 'geometric series test', 'convergence tests'],
  },
  {
    key: 'calculus.series.alternating-error',
    strand: 'series',
    title: 'Alternating series & error bounds',
    strandLabel: 'Infinite series',
    prerequisites: ['calculus.series.convergence-tests'],
    difficultyPrior: 0.85,
    aliases: ['alternating series test', 'alternating series error bound', 'absolute convergence', 'conditional convergence'],
  },
  {
    key: 'calculus.series.power',
    strand: 'series',
    title: 'Power series & radius of convergence',
    strandLabel: 'Infinite series',
    prerequisites: ['calculus.series.convergence-tests'],
    difficultyPrior: 0.85,
    aliases: ['power series', 'radius of convergence', 'interval of convergence'],
  },
  {
    key: 'calculus.series.taylor-maclaurin',
    strand: 'series',
    title: 'Taylor & Maclaurin series',
    strandLabel: 'Infinite series',
    prerequisites: ['calculus.series.power', 'calculus.differentiation.higher-order'],
    difficultyPrior: 0.9,
    aliases: ['taylor series', 'maclaurin series', 'taylor polynomial', 'series expansion'],
  },
  {
    key: 'calculus.series.lagrange-error',
    strand: 'series',
    title: 'Lagrange error bound',
    strandLabel: 'Infinite series',
    prerequisites: ['calculus.series.taylor-maclaurin', 'calculus.series.alternating-error'],
    difficultyPrior: 0.9,
    aliases: ['lagrange error bound', 'taylor remainder', 'error of a taylor polynomial'],
  },
]
