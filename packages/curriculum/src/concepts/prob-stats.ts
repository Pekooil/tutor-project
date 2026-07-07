// Probability & Statistics strand (ADR-032 appendix): descriptive
// statistics, probability rules & counting, conditional probability, random
// variables & expected value, normal distribution basics. HS-level intro
// stats/probability — no non-math subject enters the graph (V1 scope).
import type { Concept } from './types'

export const PROB_STATS_CONCEPTS: readonly Concept[] = [
  {
    key: 'stats.descriptive.measures',
    strand: 'descriptive-statistics',
    title: 'Descriptive statistics',
    strandLabel: 'Descriptive statistics',
    prerequisites: [],
    difficultyPrior: 0.3,
    aliases: ['mean median mode', 'descriptive statistics', 'standard deviation', 'measures of spread'],
  },
  {
    key: 'stats.probability.rules',
    strand: 'probability',
    title: 'Probability rules',
    strandLabel: 'Probability',
    prerequisites: [],
    difficultyPrior: 0.35,
    aliases: ['probability rules', 'independent events', 'mutually exclusive'],
  },
  {
    key: 'stats.probability.counting',
    strand: 'probability',
    title: 'Counting principles',
    strandLabel: 'Probability',
    prerequisites: ['stats.probability.rules'],
    difficultyPrior: 0.45,
    aliases: ['permutations', 'combinations', 'counting principle', 'factorial'],
  },
  {
    key: 'stats.probability.conditional',
    strand: 'conditional-probability',
    title: 'Conditional probability',
    strandLabel: 'Conditional probability',
    prerequisites: ['stats.probability.rules'],
    difficultyPrior: 0.5,
    aliases: ['conditional probability', 'bayes theorem', 'given that'],
  },
  {
    key: 'stats.random-variables.expected-value',
    strand: 'random-variables',
    title: 'Random variables & expected value',
    strandLabel: 'Random variables',
    prerequisites: ['stats.probability.rules'],
    difficultyPrior: 0.5,
    aliases: ['random variables', 'expected value', 'probability distribution'],
  },
  {
    key: 'stats.distributions.normal',
    strand: 'normal-distribution',
    title: 'Normal distribution basics',
    strandLabel: 'Normal distribution',
    prerequisites: ['stats.descriptive.measures'],
    difficultyPrior: 0.55,
    aliases: ['normal distribution', 'bell curve', 'z-score'],
  },
]
