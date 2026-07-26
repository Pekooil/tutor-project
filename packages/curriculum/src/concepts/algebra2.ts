// Algebra 2 content (ADR-032 appendix, extended by the 11-course
// restructure): polynomial division & factor theorem, rational expressions &
// equations, exponential functions, logarithms & properties, sequences &
// series, complex numbers, nonlinear systems — plus the function-analysis,
// conics and matrix material added below.
//
// Those additions are authored HERE, not in `precalculus.ts`, under the rule
// the restructure uses throughout: a concept lives in the file of the EARLIEST
// course that teaches it, and later courses list its key. Algebra 2 is where a
// student first meets function transformations, inverses, piecewise functions,
// polynomial graphing, rational asymptotes, conics and matrices; Precalculus,
// AP Precalculus and Integrated Math 3 all reference these same keys, so a
// student who masters transformations in Algebra 2 does not start from zero
// when they reach Precalculus.
import type { Concept } from './types'

export const ALGEBRA2_CONCEPTS: readonly Concept[] = [
  {
    key: 'algebra2.polynomials.division-factor-theorem',
    strand: 'polynomial-division',
    title: 'Polynomial division & factor theorem',
    strandLabel: 'Polynomial division',
    prerequisites: ['algebra.quadratics.factoring'],
    difficultyPrior: 0.55,
    aliases: ['polynomial division', 'synthetic division', 'factor theorem', 'remainder theorem'],
  },
  {
    key: 'algebra2.rational.simplifying',
    strand: 'rational-expressions',
    title: 'Simplifying rational expressions',
    strandLabel: 'Rational expressions',
    prerequisites: ['algebra2.polynomials.division-factor-theorem'],
    difficultyPrior: 0.5,
    aliases: ['rational expressions', 'simplifying fractions with variables', 'common denominators'],
  },
  {
    key: 'algebra2.rational.equations',
    strand: 'rational-expressions',
    title: 'Solving rational equations',
    strandLabel: 'Rational expressions',
    prerequisites: ['algebra2.rational.simplifying'],
    difficultyPrior: 0.6,
    aliases: ['rational equations', 'cross multiplying equations', 'extraneous solutions'],
  },
  {
    key: 'algebra2.exponential.functions',
    strand: 'exponential-functions',
    title: 'Exponential functions',
    strandLabel: 'Exponential functions',
    prerequisites: ['algebra.radicals.rational-exponents'],
    difficultyPrior: 0.5,
    aliases: ['exponential growth', 'exponential decay', 'exponential functions', 'compound interest'],
  },
  {
    key: 'algebra2.logarithms.intro',
    strand: 'logarithms',
    title: 'Introduction to logarithms',
    strandLabel: 'Logarithms',
    prerequisites: ['algebra2.exponential.functions'],
    difficultyPrior: 0.55,
    aliases: ['logarithms', 'log base', 'converting log to exponential form'],
  },
  {
    key: 'algebra2.logarithms.properties',
    strand: 'logarithms',
    title: 'Logarithm properties & change of base',
    strandLabel: 'Logarithms',
    prerequisites: ['algebra2.logarithms.intro'],
    difficultyPrior: 0.6,
    aliases: ['log rules', 'log properties', 'change of base', 'expanding logarithms'],
  },
  {
    key: 'algebra2.sequences.arithmetic',
    strand: 'sequences-series',
    title: 'Arithmetic sequences & series',
    strandLabel: 'Sequences & series',
    prerequisites: [],
    difficultyPrior: 0.4,
    aliases: ['arithmetic sequence', 'arithmetic series', 'common difference'],
  },
  {
    key: 'algebra2.sequences.geometric',
    strand: 'sequences-series',
    title: 'Geometric sequences & series',
    strandLabel: 'Sequences & series',
    prerequisites: ['algebra2.sequences.arithmetic'],
    difficultyPrior: 0.5,
    aliases: ['geometric sequence', 'geometric series', 'common ratio'],
  },
  {
    key: 'algebra2.complex.numbers',
    strand: 'complex-numbers',
    title: 'Complex numbers',
    strandLabel: 'Complex numbers',
    prerequisites: ['algebra.quadratics.formula'],
    difficultyPrior: 0.55,
    aliases: ['complex numbers', 'imaginary numbers', 'i squared', 'complex conjugate'],
  },
  {
    key: 'algebra2.systems.nonlinear',
    strand: 'nonlinear-systems',
    title: 'Nonlinear systems',
    strandLabel: 'Nonlinear systems',
    prerequisites: ['algebra.systems.elimination-substitution', 'algebra.quadratics.factoring'],
    difficultyPrior: 0.6,
    aliases: ['nonlinear systems', 'system with a parabola', 'quadratic-linear system'],
  },

  // ── Function analysis (referenced by both precalculus courses) ───────────
  {
    key: 'algebra2.functions.transformations',
    strand: 'function-analysis',
    title: 'Transformations of functions',
    strandLabel: 'Function analysis',
    prerequisites: ['algebra.functions.graphs'],
    difficultyPrior: 0.4,
    aliases: ['function transformations', 'shifts and stretches', 'parent functions', 'horizontal shift', 'vertical stretch'],
  },
  {
    key: 'algebra2.functions.inverses',
    strand: 'function-analysis',
    title: 'Composition & inverse functions',
    strandLabel: 'Function analysis',
    prerequisites: ['algebra.functions.notation'],
    difficultyPrior: 0.45,
    aliases: ['composite functions', 'f of g of x', 'inverse function', 'one-to-one', 'finding an inverse'],
  },
  {
    key: 'algebra2.functions.piecewise',
    strand: 'function-analysis',
    title: 'Piecewise & step functions',
    strandLabel: 'Function analysis',
    prerequisites: ['algebra.functions.graphs'],
    difficultyPrior: 0.4,
    aliases: ['piecewise function', 'step function', 'graphing piecewise', 'evaluating piecewise'],
  },

  // ── Graphing polynomials & rationals ─────────────────────────────────────
  {
    key: 'algebra2.polynomials.graphing',
    strand: 'polynomial-division',
    title: 'Polynomial graphs, zeros & end behavior',
    strandLabel: 'Polynomial division',
    prerequisites: ['algebra2.polynomials.division-factor-theorem', 'algebra2.functions.transformations'],
    difficultyPrior: 0.5,
    aliases: ['end behavior', 'multiplicity of a zero', 'polynomial graph', 'degree and leading coefficient'],
  },
  {
    key: 'algebra2.rational.asymptotes',
    strand: 'rational-expressions',
    title: 'Graphing rational functions: asymptotes & holes',
    strandLabel: 'Rational expressions',
    prerequisites: ['algebra2.rational.simplifying', 'algebra2.polynomials.graphing'],
    difficultyPrior: 0.55,
    aliases: ['rational function graph', 'vertical asymptote', 'horizontal asymptote', 'hole in a graph', 'slant asymptote'],
  },
  {
    key: 'algebra2.radical.equations',
    strand: 'radical-functions',
    title: 'Radical functions & equations',
    strandLabel: 'Radical functions',
    prerequisites: ['algebra.radicals.rational-exponents', 'algebra2.functions.transformations'],
    difficultyPrior: 0.5,
    aliases: ['radical equations', 'solving with square roots', 'extraneous solution', 'square root function'],
  },

  // ── Sequences, conics & matrices ─────────────────────────────────────────
  {
    key: 'algebra2.sequences.summation',
    strand: 'sequences-series',
    title: 'Sigma notation & series sums',
    strandLabel: 'Sequences & series',
    prerequisites: ['algebra2.sequences.geometric'],
    difficultyPrior: 0.5,
    aliases: ['sigma notation', 'summation notation', 'partial sum', 'infinite geometric series'],
  },
  {
    key: 'algebra2.conics.sections',
    strand: 'conic-sections',
    title: 'Conic sections',
    strandLabel: 'Conic sections',
    prerequisites: ['algebra2.systems.nonlinear', 'geometry.circles.equations'],
    difficultyPrior: 0.6,
    aliases: ['conic sections', 'ellipse', 'hyperbola', 'parabola as a conic', 'completing the square for conics'],
  },
  {
    key: 'algebra2.matrices.operations',
    strand: 'matrices',
    title: 'Matrix operations & inverses',
    strandLabel: 'Matrices',
    prerequisites: ['algebra.systems.elimination-substitution'],
    difficultyPrior: 0.55,
    aliases: ['matrix multiplication', 'matrix inverse', 'determinant', 'identity matrix'],
  },
]
