// Trig/Precalculus strand (ADR-032 appendix): unit circle & radian measure,
// trig graphs, trig identities, trig equations, inverse trig, vectors, and
// the intuitive limits intro — the precalc/calc bridge `calculus.limits.formal`
// (calculus.ts) builds on.
import type { Concept } from './types'

export const TRIG_PRECALC_CONCEPTS: readonly Concept[] = [
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
    key: 'precalc.vectors.operations',
    strand: 'vectors',
    title: 'Vectors',
    strandLabel: 'Vectors',
    prerequisites: ['geometry.coordinate.distance-midpoint'],
    difficultyPrior: 0.5,
    aliases: ['vectors', 'vector addition', 'magnitude and direction'],
  },
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
