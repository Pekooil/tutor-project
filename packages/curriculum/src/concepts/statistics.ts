// Statistics content (was `prob-stats.ts`, renamed with the 11-course
// restructure). The six original entries are unchanged — live mastery_state /
// reinforcement_schedule / study_artifact rows reference them by key — and the
// file now carries the whole AP Statistics syllabus around them, ordered by the
// College Board's nine units:
//
//   1 one-variable data · 2 two-variable data · 3 collecting data
//   4 probability & random variables · 5 sampling distributions
//   6 inference: proportions · 7 inference: means
//   8 inference: chi-square · 9 inference: slopes
//
// Before this file, the graph stopped at the normal distribution — the entire
// inference half of AP Stats was missing, so `ap-statistics` could not have
// been honestly claimed as a supported course.
//
// The non-AP courses take the descriptive/probability head of this file only:
// Algebra 1 and Integrated Math 1 use one/two-variable data, Integrated Math 3
// adds sampling and the idea of a margin of error, and no non-AP course
// reaches the inference units.
import type { Concept } from './types'

export const STATISTICS_CONCEPTS: readonly Concept[] = [
  // ── Unit 1 · Exploring one-variable data ─────────────────────────────────
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
    key: 'stats.data.displays',
    strand: 'descriptive-statistics',
    title: 'Displaying & describing distributions',
    strandLabel: 'Descriptive statistics',
    prerequisites: ['stats.descriptive.measures'],
    difficultyPrior: 0.3,
    aliases: ['histogram', 'boxplot', 'dot plot', 'stemplot', 'shape center spread', 'skewed distribution'],
  },
  {
    key: 'stats.data.position',
    strand: 'descriptive-statistics',
    title: 'Percentiles, z-scores & position',
    strandLabel: 'Descriptive statistics',
    prerequisites: ['stats.data.displays'],
    difficultyPrior: 0.4,
    aliases: ['percentile', 'z-score', 'standardizing', 'quartiles', 'outlier rule'],
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

  // ── Unit 2 · Exploring two-variable data ─────────────────────────────────
  {
    key: 'stats.data.two-way-tables',
    strand: 'two-variable-data',
    title: 'Two-way tables & categorical association',
    strandLabel: 'Two-variable data',
    prerequisites: ['stats.data.displays'],
    difficultyPrior: 0.35,
    aliases: ['two-way table', 'marginal distribution', 'conditional distribution', 'segmented bar chart'],
  },
  {
    key: 'stats.regression.scatterplots-correlation',
    strand: 'two-variable-data',
    title: 'Scatterplots & correlation',
    strandLabel: 'Two-variable data',
    prerequisites: ['stats.data.displays'],
    difficultyPrior: 0.4,
    aliases: ['scatterplot', 'correlation coefficient', 'r value', 'direction form strength'],
  },
  {
    key: 'stats.regression.least-squares',
    strand: 'two-variable-data',
    title: 'Least-squares regression lines',
    strandLabel: 'Two-variable data',
    prerequisites: ['stats.regression.scatterplots-correlation'],
    difficultyPrior: 0.5,
    aliases: ['least squares regression', 'line of best fit', 'LSRL', 'slope interpretation', 'r squared'],
  },
  {
    key: 'stats.regression.residuals',
    strand: 'two-variable-data',
    title: 'Residuals, influence & departures from linearity',
    strandLabel: 'Two-variable data',
    prerequisites: ['stats.regression.least-squares'],
    difficultyPrior: 0.55,
    aliases: ['residual plot', 'residuals', 'influential point', 'high leverage', 'transforming to achieve linearity'],
  },

  // ── Unit 3 · Collecting data ─────────────────────────────────────────────
  {
    key: 'stats.sampling.methods',
    strand: 'collecting-data',
    title: 'Sampling methods & bias',
    strandLabel: 'Collecting data',
    prerequisites: [],
    difficultyPrior: 0.35,
    aliases: ['simple random sample', 'stratified sample', 'cluster sample', 'sampling bias', 'convenience sample'],
  },
  {
    key: 'stats.experiments.design',
    strand: 'collecting-data',
    title: 'Experimental design',
    strandLabel: 'Collecting data',
    prerequisites: ['stats.sampling.methods'],
    difficultyPrior: 0.45,
    aliases: ['experimental design', 'control group', 'blocking', 'random assignment', 'confounding', 'placebo'],
  },
  {
    key: 'stats.scope.inference',
    strand: 'collecting-data',
    title: 'Scope of inference & causation',
    strandLabel: 'Collecting data',
    prerequisites: ['stats.experiments.design'],
    difficultyPrior: 0.5,
    aliases: ['scope of inference', 'correlation is not causation', 'generalizing to a population'],
  },

  // ── Unit 4 · Probability, random variables & distributions ───────────────
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
    key: 'stats.probability.simulation',
    strand: 'probability',
    title: 'Simulation & randomness',
    strandLabel: 'Probability',
    prerequisites: ['stats.probability.rules'],
    difficultyPrior: 0.4,
    aliases: ['simulation', 'random digit table', 'estimating probability by simulation'],
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
    key: 'stats.random-variables.combining',
    strand: 'random-variables',
    title: 'Combining & transforming random variables',
    strandLabel: 'Random variables',
    prerequisites: ['stats.random-variables.expected-value'],
    difficultyPrior: 0.55,
    aliases: ['combining random variables', 'sum of random variables', 'variance adds', 'transforming a random variable'],
  },
  {
    key: 'stats.random-variables.binomial',
    strand: 'random-variables',
    title: 'Binomial distributions',
    strandLabel: 'Random variables',
    prerequisites: ['stats.random-variables.expected-value', 'stats.probability.counting'],
    difficultyPrior: 0.55,
    aliases: ['binomial distribution', 'binomial probability', 'n choose k', 'binompdf'],
  },
  {
    key: 'stats.random-variables.geometric',
    strand: 'random-variables',
    title: 'Geometric distributions',
    strandLabel: 'Random variables',
    prerequisites: ['stats.random-variables.binomial'],
    difficultyPrior: 0.55,
    aliases: ['geometric distribution', 'first success', 'geometric probability'],
  },

  // ── Unit 5 · Sampling distributions ──────────────────────────────────────
  {
    key: 'stats.sampling-distributions.proportion',
    strand: 'sampling-distributions',
    title: 'Sampling distribution of a sample proportion',
    strandLabel: 'Sampling distributions',
    prerequisites: ['stats.distributions.normal', 'stats.random-variables.binomial', 'stats.sampling.methods'],
    difficultyPrior: 0.65,
    aliases: ['sampling distribution of p-hat', 'sample proportion', 'large counts condition'],
  },
  {
    key: 'stats.sampling-distributions.mean',
    strand: 'sampling-distributions',
    title: 'Sampling distribution of a sample mean & the CLT',
    strandLabel: 'Sampling distributions',
    prerequisites: ['stats.distributions.normal', 'stats.random-variables.combining', 'stats.sampling.methods'],
    difficultyPrior: 0.65,
    aliases: ['central limit theorem', 'CLT', 'sampling distribution of x-bar', 'standard error of the mean'],
  },

  // ── Unit 6 · Inference for proportions ───────────────────────────────────
  {
    key: 'stats.inference.ci-proportion',
    strand: 'inference-proportions',
    title: 'Confidence intervals for a proportion',
    strandLabel: 'Inference: proportions',
    prerequisites: ['stats.sampling-distributions.proportion'],
    difficultyPrior: 0.65,
    aliases: ['confidence interval for p', 'margin of error', 'one-proportion z-interval', 'critical value'],
  },
  {
    key: 'stats.inference.test-proportion',
    strand: 'inference-proportions',
    title: 'Significance tests for a proportion',
    strandLabel: 'Inference: proportions',
    prerequisites: ['stats.inference.ci-proportion'],
    difficultyPrior: 0.7,
    aliases: ['one-proportion z-test', 'null hypothesis', 'p-value', 'hypothesis test', 'significance level'],
  },
  {
    key: 'stats.inference.errors-power',
    strand: 'inference-proportions',
    title: 'Type I & Type II errors and power',
    strandLabel: 'Inference: proportions',
    prerequisites: ['stats.inference.test-proportion'],
    difficultyPrior: 0.7,
    aliases: ['type I error', 'type II error', 'power of a test', 'false positive false negative'],
  },
  {
    key: 'stats.inference.two-proportions',
    strand: 'inference-proportions',
    title: 'Comparing two proportions',
    strandLabel: 'Inference: proportions',
    prerequisites: ['stats.inference.test-proportion'],
    difficultyPrior: 0.7,
    aliases: ['two-proportion z-test', 'two-sample proportions', 'difference of proportions'],
  },

  // ── Unit 7 · Inference for means ─────────────────────────────────────────
  {
    key: 'stats.inference.ci-mean',
    strand: 'inference-means',
    title: 'Confidence intervals for a mean',
    strandLabel: 'Inference: means',
    prerequisites: ['stats.sampling-distributions.mean'],
    difficultyPrior: 0.65,
    aliases: ['one-sample t-interval', 'confidence interval for a mean', 't distribution', 'degrees of freedom'],
  },
  {
    key: 'stats.inference.test-mean',
    strand: 'inference-means',
    title: 'Significance tests for a mean',
    strandLabel: 'Inference: means',
    prerequisites: ['stats.inference.ci-mean', 'stats.inference.test-proportion'],
    difficultyPrior: 0.7,
    aliases: ['one-sample t-test', 't-test for a mean', 'paired t-test'],
  },
  {
    key: 'stats.inference.two-means',
    strand: 'inference-means',
    title: 'Comparing two means',
    strandLabel: 'Inference: means',
    prerequisites: ['stats.inference.test-mean'],
    difficultyPrior: 0.75,
    aliases: ['two-sample t-test', 'difference of means', 'two-sample t-interval'],
  },

  // ── Unit 8 · Inference for categorical data: chi-square ──────────────────
  {
    key: 'stats.inference.chi-square-gof',
    strand: 'inference-chi-square',
    title: 'Chi-square goodness-of-fit test',
    strandLabel: 'Inference: chi-square',
    prerequisites: ['stats.inference.test-proportion'],
    difficultyPrior: 0.7,
    aliases: ['chi-square goodness of fit', 'chi square test', 'expected counts'],
  },
  {
    key: 'stats.inference.chi-square-independence',
    strand: 'inference-chi-square',
    title: 'Chi-square tests for homogeneity & independence',
    strandLabel: 'Inference: chi-square',
    prerequisites: ['stats.inference.chi-square-gof', 'stats.data.two-way-tables'],
    difficultyPrior: 0.75,
    aliases: ['chi-square test for independence', 'test for homogeneity', 'chi-square two-way table'],
  },

  // ── Unit 9 · Inference for quantitative data: slopes ─────────────────────
  {
    key: 'stats.inference.slope',
    strand: 'inference-slopes',
    title: 'Inference for the slope of a regression line',
    strandLabel: 'Inference: slopes',
    prerequisites: ['stats.regression.residuals', 'stats.inference.test-mean'],
    difficultyPrior: 0.8,
    aliases: ['inference for slope', 't-test for slope', 'regression output table', 'confidence interval for slope'],
  },
]
