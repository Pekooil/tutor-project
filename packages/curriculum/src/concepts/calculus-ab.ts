// Calculus AB content (was `calculus.ts`, renamed with the 11-course
// restructure). Every original key is unchanged — live rows reference them —
// and the gaps that made AB incomplete are filled around them, ordered by the
// AP Calculus CED units 1-8:
//
//   1 limits & continuity · 2 differentiation: definition & basic rules
//   3 composite, implicit & inverse · 4 contextual applications
//   5 analytical applications · 6 integration & accumulation
//   7 differential equations · 8 applications of integration
//
// The largest gap this closes: derivatives of the transcendental functions
// (trig, e^x, ln x, inverse trig) were entirely absent, so the graph could
// only describe polynomial differentiation. Riemann sums, the Mean Value
// Theorem, motion, linearization, average value and L'Hopital were missing too.
//
// `calculus.limits.formal` still builds on `precalc.limits.intuitive` — the
// precalc/calc bridge. BC-only material lives in `calculus-bc.ts`; the
// `ap-calculus-bc` course lists this file's concepts and then that file's.
import type { Concept } from './types'

export const CALCULUS_AB_CONCEPTS: readonly Concept[] = [
  // ── Unit 1 · Limits & continuity ─────────────────────────────────────────
  {
    key: 'calculus.limits.formal',
    strand: 'limits',
    title: 'Limits & continuity',
    strandLabel: 'Limits',
    prerequisites: ['precalc.limits.intuitive'],
    difficultyPrior: 0.55,
    aliases: ['limits', 'continuity', 'limit laws', 'epsilon delta'],
  },
  {
    key: 'calculus.limits.asymptotes',
    strand: 'limits',
    title: 'Infinite limits & asymptotic behavior',
    strandLabel: 'Limits',
    prerequisites: ['calculus.limits.formal'],
    difficultyPrior: 0.55,
    aliases: ['limits at infinity', 'vertical asymptote', 'horizontal asymptote', 'end behavior of a limit'],
  },
  {
    key: 'calculus.limits.squeeze-ivt',
    strand: 'limits',
    title: 'Squeeze theorem & the Intermediate Value Theorem',
    strandLabel: 'Limits',
    prerequisites: ['calculus.limits.formal'],
    difficultyPrior: 0.6,
    aliases: ['squeeze theorem', 'sandwich theorem', 'intermediate value theorem', 'IVT'],
  },

  // ── Unit 2 · Differentiation: definition & fundamental properties ────────
  {
    key: 'calculus.derivatives.as-limit',
    strand: 'derivatives',
    title: 'The derivative as a limit',
    strandLabel: 'Derivatives',
    prerequisites: ['calculus.limits.formal'],
    difficultyPrior: 0.6,
    aliases: ['derivative definition', 'difference quotient', 'derivative as a limit'],
  },
  {
    key: 'calculus.differentiation.power-rule',
    strand: 'differentiation-rules',
    title: 'Power rule for derivatives',
    strandLabel: 'Differentiation rules',
    prerequisites: ['calculus.derivatives.as-limit'],
    difficultyPrior: 0.55,
    aliases: ['power rule derivative', 'differentiating polynomials'],
  },
  {
    key: 'calculus.differentiation.product-rule',
    strand: 'differentiation-rules',
    title: 'Product rule',
    strandLabel: 'Differentiation rules',
    prerequisites: ['calculus.differentiation.power-rule'],
    difficultyPrior: 0.6,
    aliases: ['product rule derivative', 'differentiating a product'],
  },
  {
    key: 'calculus.differentiation.quotient-rule',
    strand: 'differentiation-rules',
    title: 'Quotient rule',
    strandLabel: 'Differentiation rules',
    prerequisites: ['calculus.differentiation.power-rule'],
    difficultyPrior: 0.6,
    aliases: ['quotient rule derivative', 'differentiating a fraction'],
  },
  {
    key: 'calculus.differentiation.trig',
    strand: 'differentiation-rules',
    title: 'Derivatives of trigonometric functions',
    strandLabel: 'Differentiation rules',
    prerequisites: ['calculus.differentiation.power-rule', 'precalc.trig.graphs'],
    difficultyPrior: 0.6,
    aliases: ['derivative of sine', 'derivative of cosine', 'derivative of tangent', 'trig derivatives'],
  },
  {
    key: 'calculus.differentiation.exp-log',
    strand: 'differentiation-rules',
    title: 'Derivatives of exponential & logarithmic functions',
    strandLabel: 'Differentiation rules',
    prerequisites: ['calculus.differentiation.power-rule', 'algebra2.logarithms.properties'],
    difficultyPrior: 0.6,
    aliases: ['derivative of e^x', 'derivative of ln x', 'exponential derivative', 'log derivative'],
  },

  // ── Unit 3 · Composite, implicit & inverse functions ─────────────────────
  {
    key: 'calculus.differentiation.chain-rule',
    strand: 'chain-rule',
    title: 'Chain rule',
    strandLabel: 'Chain rule',
    prerequisites: ['calculus.differentiation.product-rule', 'calculus.differentiation.quotient-rule'],
    difficultyPrior: 0.65,
    aliases: ['chain rule', 'composite function derivative'],
  },
  {
    key: 'calculus.differentiation.implicit',
    strand: 'implicit-differentiation',
    title: 'Implicit differentiation',
    strandLabel: 'Implicit differentiation',
    prerequisites: ['calculus.differentiation.chain-rule'],
    difficultyPrior: 0.7,
    aliases: ['implicit differentiation', 'differentiating both sides'],
  },
  {
    key: 'calculus.differentiation.inverse-functions',
    strand: 'implicit-differentiation',
    title: 'Derivatives of inverse & inverse trig functions',
    strandLabel: 'Implicit differentiation',
    prerequisites: ['calculus.differentiation.implicit', 'precalc.trig.inverse'],
    difficultyPrior: 0.7,
    aliases: ['derivative of an inverse function', 'derivative of arcsin', 'derivative of arctan', 'inverse trig derivatives'],
  },
  {
    key: 'calculus.differentiation.higher-order',
    strand: 'implicit-differentiation',
    title: 'Higher-order derivatives',
    strandLabel: 'Implicit differentiation',
    prerequisites: ['calculus.differentiation.chain-rule'],
    difficultyPrior: 0.55,
    aliases: ['second derivative', 'higher order derivatives', 'f double prime'],
  },

  // ── Unit 4 · Contextual applications of differentiation ──────────────────
  {
    key: 'calculus.applications.motion',
    strand: 'applications-of-derivatives',
    title: 'Motion: position, velocity & acceleration',
    strandLabel: 'Applications of derivatives',
    prerequisites: ['calculus.differentiation.higher-order'],
    difficultyPrior: 0.6,
    aliases: ['particle motion', 'velocity and acceleration', 'position function', 'speeding up or slowing down'],
  },
  {
    key: 'calculus.applications.related-rates',
    strand: 'applications-of-derivatives',
    title: 'Related rates',
    strandLabel: 'Applications of derivatives',
    prerequisites: ['calculus.differentiation.implicit'],
    difficultyPrior: 0.75,
    aliases: ['related rates', 'rates of change problems'],
  },
  {
    key: 'calculus.applications.linearization',
    strand: 'applications-of-derivatives',
    title: 'Linearization & tangent line approximation',
    strandLabel: 'Applications of derivatives',
    prerequisites: ['calculus.differentiation.chain-rule'],
    difficultyPrior: 0.6,
    aliases: ['linear approximation', 'tangent line approximation', 'linearization', 'local linearity'],
  },
  {
    key: 'calculus.limits.lhopital',
    strand: 'applications-of-derivatives',
    title: "L'Hopital's rule",
    strandLabel: 'Applications of derivatives',
    prerequisites: ['calculus.limits.asymptotes', 'calculus.differentiation.chain-rule'],
    difficultyPrior: 0.65,
    aliases: ["l'hopital's rule", 'lhopital', 'indeterminate form', 'zero over zero'],
  },

  // ── Unit 5 · Analytical applications of differentiation ──────────────────
  {
    key: 'calculus.applications.mvt',
    strand: 'applications-of-derivatives',
    title: 'Mean Value & Extreme Value Theorems',
    strandLabel: 'Applications of derivatives',
    prerequisites: ['calculus.differentiation.power-rule', 'calculus.limits.squeeze-ivt'],
    difficultyPrior: 0.65,
    aliases: ['mean value theorem', 'MVT', 'extreme value theorem', "rolle's theorem"],
  },
  {
    key: 'calculus.applications.curve-sketching',
    strand: 'applications-of-derivatives',
    title: 'Curve sketching',
    strandLabel: 'Applications of derivatives',
    prerequisites: ['calculus.differentiation.chain-rule'],
    difficultyPrior: 0.65,
    aliases: ['curve sketching', 'increasing decreasing', 'concavity', 'first and second derivative test'],
  },
  {
    key: 'calculus.applications.optimization',
    strand: 'applications-of-derivatives',
    title: 'Optimization',
    strandLabel: 'Applications of derivatives',
    prerequisites: ['calculus.differentiation.chain-rule'],
    difficultyPrior: 0.75,
    aliases: ['optimization', 'maximize minimize', 'optimization problems'],
  },

  // ── Unit 6 · Integration & accumulation of change ────────────────────────
  {
    key: 'calculus.integration.riemann-sums',
    strand: 'antiderivatives',
    title: 'Riemann sums & accumulation',
    strandLabel: 'Antiderivatives',
    prerequisites: ['calculus.limits.formal'],
    difficultyPrior: 0.6,
    aliases: ['riemann sum', 'left and right sums', 'trapezoidal rule', 'accumulation of change', 'midpoint sum'],
  },
  {
    key: 'calculus.integration.antiderivatives',
    strand: 'antiderivatives',
    title: 'Antiderivatives & indefinite integrals',
    strandLabel: 'Antiderivatives',
    prerequisites: ['calculus.differentiation.power-rule'],
    difficultyPrior: 0.55,
    aliases: ['antiderivatives', 'indefinite integral', 'integration basics'],
  },
  {
    key: 'calculus.integration.definite-ftc',
    strand: 'definite-integrals',
    title: 'Definite integrals & the Fundamental Theorem of Calculus',
    strandLabel: 'Definite integrals',
    prerequisites: ['calculus.integration.antiderivatives', 'calculus.integration.riemann-sums'],
    difficultyPrior: 0.65,
    aliases: ['definite integral', 'fundamental theorem of calculus', 'FTC'],
  },
  {
    key: 'calculus.integration.u-substitution',
    strand: 'u-substitution',
    title: 'u-substitution',
    strandLabel: 'u-substitution',
    prerequisites: ['calculus.differentiation.chain-rule', 'calculus.integration.antiderivatives'],
    difficultyPrior: 0.7,
    aliases: ['u-sub', 'u substitution', 'substitution integration'],
  },

  // ── Unit 7 · Differential equations ──────────────────────────────────────
  {
    key: 'calculus.differential-equations.intro',
    strand: 'differential-equations',
    title: 'Introduction to differential equations',
    strandLabel: 'Differential equations',
    prerequisites: ['calculus.integration.antiderivatives'],
    difficultyPrior: 0.75,
    aliases: ['differential equations', 'separable equations', 'slope fields'],
  },
  {
    key: 'calculus.differential-equations.exponential-model',
    strand: 'differential-equations',
    title: 'Exponential growth & decay models',
    strandLabel: 'Differential equations',
    prerequisites: ['calculus.differential-equations.intro', 'calculus.differentiation.exp-log'],
    difficultyPrior: 0.7,
    aliases: ['exponential growth model', 'exponential decay model', 'dy/dt = ky', 'half life'],
  },

  // ── Unit 8 · Applications of integration ─────────────────────────────────
  {
    key: 'calculus.integration.average-value',
    strand: 'applications-of-integration',
    title: 'Average value of a function',
    strandLabel: 'Applications of integration',
    prerequisites: ['calculus.integration.definite-ftc'],
    difficultyPrior: 0.6,
    aliases: ['average value of a function', 'mean value theorem for integrals'],
  },
  {
    key: 'calculus.integration.area-between-curves',
    strand: 'applications-of-integration',
    title: 'Area between curves',
    strandLabel: 'Applications of integration',
    prerequisites: ['calculus.integration.definite-ftc'],
    difficultyPrior: 0.7,
    aliases: ['area between curves', 'area between two functions'],
  },
  {
    key: 'calculus.integration.volumes-cross-sections',
    strand: 'applications-of-integration',
    title: 'Volumes with known cross sections',
    strandLabel: 'Applications of integration',
    prerequisites: ['calculus.integration.area-between-curves'],
    difficultyPrior: 0.75,
    aliases: ['volume by cross sections', 'known cross sections', 'square cross section', 'semicircular cross section'],
  },
  {
    key: 'calculus.integration.volumes',
    strand: 'applications-of-integration',
    title: 'Volumes of revolution',
    strandLabel: 'Applications of integration',
    prerequisites: ['calculus.integration.area-between-curves'],
    difficultyPrior: 0.8,
    aliases: ['volumes of revolution', 'disk method', 'washer method'],
  },
]
