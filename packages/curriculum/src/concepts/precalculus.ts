// Precalculus content (was `trig-precalc.ts`, renamed with the 11-course
// restructure). The seven original entries are unchanged — live rows reference
// them by key — and the file now covers both precalculus courses:
//
//   `precalculus`      the conventional course: function analysis, trig,
//                      conics, matrices, vectors, sequences, limits intro
//   `ap-precalculus`   the College Board's four units — polynomial/rational,
//                      exponential/log, trig & polar, and functions involving
//                      parameters/vectors/matrices — which drop conics and
//                      limits but add semi-log modelling
//
// The course catalog decides which of these each takes, and both also list
// Algebra 2 keys: a concept is authored in the file of the EARLIEST course
// that teaches it, so function transformations, inverses, piecewise functions,
// polynomial graphing, rational asymptotes, conics and matrix operations all
// live in `algebra2.ts` and are referenced from here rather than re-authored.
//
// `precalc.limits.intuitive` remains the precalc/calc bridge that
// `calculus.limits.formal` builds on. `precalc.parametric.functions` and
// `precalc.polar.graphs` are what Calculus BC's unit 9 builds on.
import type { Concept } from './types'

export const PRECALCULUS_CONCEPTS: readonly Concept[] = [
  // ── Function analysis (AP Precalc's rate-of-change lens) ─────────────────
  {
    key: 'precalc.functions.rates-of-change',
    strand: 'function-analysis',
    title: 'Average rates of change & function behavior',
    strandLabel: 'Function analysis',
    prerequisites: ['algebra.functions.graphs'],
    difficultyPrior: 0.45,
    aliases: ['average rate of change', 'increasing or decreasing', 'concavity of a function', 'rate of change'],
  },

  // ── Exponential & logarithmic modelling (AP Precalc unit 2) ──────────────
  {
    key: 'precalc.exponential.log-modeling',
    strand: 'exponential-logarithmic',
    title: 'Exponential & logarithmic modelling',
    strandLabel: 'Exponential & logarithmic',
    prerequisites: ['algebra2.logarithms.properties'],
    difficultyPrior: 0.55,
    aliases: ['exponential model', 'logarithmic model', 'regression model', 'modelling growth and decay'],
  },
  {
    key: 'precalc.modeling.semi-log',
    strand: 'exponential-logarithmic',
    title: 'Semi-log plots & linearizing data',
    strandLabel: 'Exponential & logarithmic',
    prerequisites: ['precalc.exponential.log-modeling'],
    difficultyPrior: 0.6,
    aliases: ['semi-log plot', 'linearizing exponential data', 'log scale', 'semi log graph'],
  },

  // ── Trigonometry (AP Precalc unit 3) ─────────────────────────────────────
  {
    key: 'precalc.unit-circle.radians',
    strand: 'unit-circle',
    title: 'Unit circle & radian measure',
    strandLabel: 'Unit circle',
    prerequisites: ['geometry.trig.right-triangle'],
    difficultyPrior: 0.5,
    aliases: ['unit circle', 'radians', 'radian measure', 'degrees to radians'],
  },
  {
    key: 'precalc.trig.graphs',
    strand: 'trig-graphs',
    title: 'Trig graphs',
    strandLabel: 'Trig graphs',
    prerequisites: ['precalc.unit-circle.radians'],
    difficultyPrior: 0.55,
    aliases: ['sine graph', 'cosine graph', 'amplitude and period', 'trig graphs'],
  },
  {
    key: 'precalc.trig.identities',
    strand: 'trig-identities',
    title: 'Trig identities',
    strandLabel: 'Trig identities',
    prerequisites: ['precalc.unit-circle.radians'],
    difficultyPrior: 0.6,
    aliases: ['trig identities', 'pythagorean identity', 'sum and difference identities'],
  },
  {
    key: 'precalc.trig.equations',
    strand: 'trig-equations',
    title: 'Trig equations',
    strandLabel: 'Trig equations',
    prerequisites: ['precalc.trig.identities'],
    difficultyPrior: 0.6,
    aliases: ['solving trig equations', 'trig equations'],
  },
  {
    key: 'precalc.trig.inverse',
    strand: 'inverse-trig',
    title: 'Inverse trig functions',
    strandLabel: 'Inverse trig',
    prerequisites: ['precalc.trig.graphs'],
    difficultyPrior: 0.55,
    aliases: ['inverse trig', 'arcsin', 'arccos', 'arctan'],
  },
  {
    key: 'precalc.trig.laws',
    strand: 'non-right-triangles',
    title: 'Law of sines & law of cosines',
    strandLabel: 'Non-right triangles',
    prerequisites: ['geometry.trig.right-triangle', 'precalc.unit-circle.radians'],
    difficultyPrior: 0.55,
    aliases: ['law of sines', 'law of cosines', 'oblique triangle', 'ambiguous case', 'solving any triangle'],
  },

  // ── Polar, parametric, vectors & matrices (AP Precalc unit 4) ────────────
  {
    key: 'precalc.polar.coordinates',
    strand: 'polar',
    title: 'Polar coordinates & conversion',
    strandLabel: 'Polar',
    prerequisites: ['precalc.unit-circle.radians'],
    difficultyPrior: 0.55,
    aliases: ['polar coordinates', 'polar to rectangular', 'rectangular to polar', 'r and theta'],
  },
  {
    key: 'precalc.polar.graphs',
    strand: 'polar',
    title: 'Graphs of polar functions',
    strandLabel: 'Polar',
    prerequisites: ['precalc.polar.coordinates', 'precalc.trig.graphs'],
    difficultyPrior: 0.6,
    aliases: ['polar graph', 'rose curve', 'limacon', 'cardioid', 'graphing polar equations'],
  },
  {
    key: 'precalc.parametric.functions',
    strand: 'parametric',
    title: 'Parametric & implicitly defined functions',
    strandLabel: 'Parametric',
    prerequisites: ['algebra2.functions.inverses', 'precalc.trig.graphs'],
    difficultyPrior: 0.6,
    aliases: ['parametric equations', 'eliminating the parameter', 'implicitly defined function', 'parametrize a curve'],
  },
  {
    key: 'precalc.vectors.operations',
    strand: 'vectors',
    title: 'Vectors',
    strandLabel: 'Vectors',
    prerequisites: ['geometry.coordinate.distance-midpoint'],
    difficultyPrior: 0.5,
    aliases: ['vectors', 'vector addition', 'magnitude and direction'],
  },
  {
    key: 'precalc.matrices.transformations',
    strand: 'matrices',
    title: 'Matrices as transformations & linear systems',
    strandLabel: 'Matrices',
    prerequisites: ['algebra2.matrices.operations', 'precalc.vectors.operations'],
    difficultyPrior: 0.6,
    aliases: ['matrix transformation', 'solving systems with matrices', 'matrix equation', 'transition matrix'],
  },

  // ── The calculus bridge (conventional precalculus only) ──────────────────
  {
    key: 'precalc.limits.intuitive',
    strand: 'limits',
    title: 'Limits (intuitive intro)',
    strandLabel: 'Limits',
    prerequisites: ['algebra.functions.graphs'],
    difficultyPrior: 0.5,
    aliases: ['limits', 'what is a limit', 'approaching a value'],
  },
]
