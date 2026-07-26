import 'server-only'
import { getConcept } from '@calyxa/curriculum'

// The common-misconception catalog (Darcy's ask, 2026-07-17): when a student
// has NO recorded history for the check-in's confirmed concept (cold start,
// or everything resolved), the sticking-point chip previously fell back to
// the fixed generic trio ("Setting up the equation" / ...). This catalog
// replaces that with an ACTUAL frequent misconception for the concept —
// curated teacher-knowledge content, one entry per curriculum concept,
// phrased exactly like recorded misconception descriptions (lowercase-
// leaning, chip-length) so session-flow.ts's capitalize/display pipeline
// treats both identically.
//
// Grounding discipline: these are CURRICULUM content, not student history —
// they ride the wire as a SEPARATE `commonSticking` field (never mixed into
// `stickingCandidates`), so the extension's `personalized` flag stays honest
// ("recorded from your recent sessions" can never label a catalog entry; the
// existing "a common first place to check" copy is exactly what these are).
//
// Server-only like the rest of @calyxa/curriculum's consumers — the catalog
// never ships in the extension bundle (ADR-006 discipline; the extension
// receives resolved display strings over the wire).
const CATALOG: Record<string, readonly string[]> = {
  'algebra.absolute-value.equations': [
    'forgetting the negative case',
    'dropping the absolute value bars too early',
    'giving solutions when |x| equals a negative',
  ],
  'algebra.absolute-value.inequalities': [
    'mixing up when it splits into "and" vs "or"',
    'forgetting to flip the inequality on the negative case',
    'keeping the bars while solving',
  ],
  'algebra.exponents.power-rule': [
    'adding the exponents instead of multiplying',
    'multiplying the base by the exponent',
    'applying the power to only part of the product',
  ],
  'algebra.exponents.product-rule': [
    'multiplying the exponents instead of adding',
    'combining powers of different bases',
    'losing the reciprocal on a negative exponent',
  ],
  'algebra.functions.graphs': [
    'mixing up the x- and y-intercepts',
    'confusing the slope with the y-intercept',
    'reading the graph at the wrong variable',
  ],
  'algebra.functions.notation': [
    'treating f(x) as f times x',
    'not substituting the input everywhere x appears',
    'mixing up the input and the output',
  ],
  'algebra.inequalities.linear': [
    'forgetting to flip the sign when multiplying by a negative',
    'shading the wrong side of the boundary',
    'treating the inequality like an equation at the end',
  ],
  'algebra.linear-equations.one-variable': [
    'not distributing the negative across both terms',
    'moving a term without changing its sign',
    'dividing only one side by the coefficient',
  ],
  'algebra.linear-equations.two-variable': [
    'mixing up the slope and the y-intercept',
    'sign slips when isolating y',
    'swapping x and y when plotting points',
  ],
  'algebra.polynomials.expanding': [
    'dropping the negative when distributing',
    'missing the middle term when squaring a binomial',
    'multiplying the exponents instead of adding',
  ],
  'algebra.quadratics.factoring': [
    'sign errors in the factor pair',
    'picking numbers that add to b but do not multiply to c',
    'forgetting to set each factor equal to zero',
  ],
  'algebra.quadratics.formula': [
    'dropping the negative on -b',
    'leaving b^2 - 4ac partly outside the square root',
    'dividing only the root by 2a',
  ],
  'algebra.radicals.rational-exponents': [
    'flipping which part is the root and which is the power',
    'treating the fraction exponent as division',
    'losing the reciprocal on a negative exponent',
  ],
  'algebra.radicals.simplifying': [
    'adding radicals that are not like terms',
    'taking the root of each term in a sum',
    'missing a perfect-square factor',
  ],
  'algebra.ratios.percent': [
    'using the wrong base for the percent',
    'moving the decimal the wrong way',
    'adding percents taken of different wholes',
  ],
  'algebra.ratios.proportions': [
    'setting the ratio up upside down',
    'mixing units across the two sides',
    'adding instead of scaling',
  ],
  'algebra.systems.elimination-substitution': [
    'multiplying only part of an equation before eliminating',
    'substituting back into the equation you just solved',
    'sign slips when subtracting the equations',
  ],
  'algebra2.complex.numbers': [
    'treating i^2 as +1 instead of -1',
    'combining real and imaginary parts together',
    'forgetting the conjugate when dividing',
  ],
  'algebra2.exponential.functions': [
    'mixing up the growth rate and the growth factor',
    'multiplying the base by the exponent',
    'treating exponential growth like linear growth',
  ],
  'algebra2.logarithms.intro': [
    'mixing up the base and the argument',
    'forgetting a log is the exponent',
    'taking the log of a negative or zero',
  ],
  'algebra2.logarithms.properties': [
    'turning log(a + b) into log a + log b',
    'forgetting to bring the exponent down',
    'dividing the logs instead of subtracting them',
  ],
  'algebra2.polynomials.division-factor-theorem': [
    'sign error on the divisor in synthetic division',
    'skipping the placeholder for a missing term',
    'mixing up the remainder and a factor',
  ],
  'algebra2.rational.equations': [
    'not checking for extraneous solutions',
    'clearing the denominators on only one side',
    'losing a domain restriction',
  ],
  'algebra2.rational.simplifying': [
    'canceling terms instead of factors',
    'canceling across a plus sign',
    'dropping the domain restriction after canceling',
  ],
  'algebra2.sequences.arithmetic': [
    'using n instead of n - 1 in the formula',
    'mixing up the first term and the common difference',
    'confusing the term number with the term value',
  ],
  'algebra2.sequences.geometric': [
    'adding the ratio instead of multiplying by it',
    'using n instead of n - 1 in the exponent',
    'using the arithmetic formula by mistake',
  ],
  'algebra2.systems.nonlinear': [
    'stopping at one intersection point',
    'losing a solution after squaring',
    'substituting into the wrong equation',
  ],
  'calculus.applications.curve-sketching': [
    "reading f'' information off f'",
    "calling every zero of f' a max or a min",
    'confusing concavity with increasing and decreasing',
  ],
  'calculus.applications.optimization': [
    'differentiating before using the constraint',
    'skipping the endpoints',
    'not verifying the critical point is a max or a min',
  ],
  'calculus.applications.related-rates': [
    'plugging in values before differentiating',
    'missing the chain rule on a changing variable',
    'mixing up the given rate and the asked rate',
  ],
  'calculus.derivatives.as-limit': [
    'dropping the limit too early',
    'algebra slips expanding f(x + h)',
    'canceling h before factoring it out',
  ],
  'calculus.differential-equations.intro': [
    'forgetting + C after integrating',
    'moving a variable across without separating fully',
    'ignoring the initial condition',
  ],
  'calculus.differentiation.chain-rule': [
    "forgetting the inner function's derivative",
    'differentiating only the outside',
    'using the wrong inner derivative',
  ],
  'calculus.differentiation.implicit': [
    'forgetting dy/dx when differentiating y',
    'treating y as a constant',
    'not collecting the dy/dx terms before solving',
  ],
  'calculus.differentiation.power-rule': [
    'forgetting to reduce the exponent by one',
    "keeping a constant term's derivative",
    'sign slips with negative exponents',
  ],
  'calculus.differentiation.product-rule': [
    'multiplying the two derivatives together',
    'dropping one of the two terms',
    'sign slips combining the terms',
  ],
  'calculus.differentiation.quotient-rule': [
    'flipping the order in the numerator',
    'forgetting to square the denominator',
    'treating it like the product rule',
  ],
  'calculus.integration.antiderivatives': [
    'forgetting + C',
    'reducing the exponent instead of raising it',
    'not dividing by the new exponent',
  ],
  'calculus.integration.area-between-curves': [
    'subtracting the curves in the wrong order',
    'missing where the curves cross',
    'using the wrong interval',
  ],
  'calculus.integration.definite-ftc': [
    'forgetting to subtract F(a)',
    'sign slips evaluating at a negative bound',
    'adding + C to a definite integral',
  ],
  'calculus.integration.u-substitution': [
    'forgetting to substitute for dx',
    "leaving x's inside a u integral",
    'not changing the bounds with the substitution',
  ],
  'calculus.integration.volumes': [
    'mixing up the disk and shell setups',
    'squaring the wrong radius',
    'dropping the pi',
  ],
  'calculus.limits.formal': [
    'plugging in when the form is 0/0',
    "treating the limit as the function's value there",
    'mixing up the one-sided limits',
  ],
  'geometry.angles.parallel-lines': [
    'mixing up alternate and corresponding angles',
    'calling supplementary angles equal',
    'using an angle pair that needs parallel lines without them',
  ],
  'geometry.circles.arcs-angles': [
    'confusing central and inscribed angles',
    'doubling or halving the wrong angle',
    'mixing up arc measure and arc length',
  ],
  'geometry.circles.area-circumference': [
    'mixing up the radius and the diameter',
    'confusing the area and circumference formulas',
    'squaring the diameter instead of the radius',
  ],
  'geometry.coordinate.distance-midpoint': [
    'subtracting the coordinates in mixed order',
    'forgetting to square the differences',
    'averaging when the question asks for distance',
  ],
  'geometry.measurement.area': [
    'mixing up perimeter and area',
    'forgetting the 1/2 in the triangle formula',
    'using the slant side as the height',
  ],
  'geometry.measurement.volume': [
    'mixing up volume and surface area',
    'forgetting the 1/3 for cones and pyramids',
    'using the wrong dimension for the height',
  ],
  'geometry.transformations.rigid-and-dilation': [
    'rotating in the wrong direction',
    'dilating from the wrong center',
    'reflecting over the wrong axis',
  ],
  'geometry.triangles.congruence': [
    'using SSA as if it proved congruence',
    'matching corresponding parts in the wrong order',
    'confusing congruence with similarity',
  ],
  'geometry.triangles.similarity': [
    'adding to side lengths instead of scaling',
    'pairing non-corresponding sides in the ratio',
    'treating similar as congruent',
  ],
  'geometry.trig.right-triangle': [
    'mixing up the opposite and adjacent sides',
    'picking sine when it should be cosine',
    'using the wrong inverse to find the angle',
  ],
  'precalc.limits.intuitive': [
    "treating the limit as the value at the point",
    'giving up at 0/0 instead of simplifying',
    'mixing up the one-sided limits',
  ],
  'precalc.trig.equations': [
    'finding only one solution in the interval',
    'dividing away sin x and losing solutions',
    'working in degrees when the problem is in radians',
  ],
  'precalc.trig.graphs': [
    'mixing up the amplitude and the period',
    'shifting the graph the wrong direction',
    'flipping the period formula',
  ],
  'precalc.trig.identities': [
    'turning sin(a + b) into sin a + sin b',
    'substituting an identity that does not match',
    'squaring both sides without tracking solutions',
  ],
  'precalc.trig.inverse': [
    'treating sin^-1 x as 1/sin x',
    'expecting angles outside the restricted range',
    'mixing up which ratio the inverse takes',
  ],
  'precalc.unit-circle.radians': [
    'mixing up degrees and radians',
    'wrong sign for the quadrant',
    'swapping the sine and cosine coordinates',
  ],
  'precalc.vectors.operations': [
    'adding magnitudes instead of components',
    'mixing up the dot product with scalar multiplication',
    'measuring the direction angle from the wrong axis',
  ],
  'stats.descriptive.measures': [
    'using the mean when outliers call for the median',
    'mixing up standard deviation and variance',
    'reading the range as spread around the mean',
  ],
  'stats.distributions.normal': [
    'skipping the z-score conversion',
    'reading the table for the wrong tail',
    'flipping the sign on z',
  ],
  'stats.probability.conditional': [
    'flipping P(A|B) and P(B|A)',
    'treating dependent events as independent',
    'forgetting to shrink the sample space',
  ],
  'stats.probability.counting': [
    'using permutations when order does not matter',
    'double-counting outcomes',
    'adding choices that should multiply',
  ],
  'stats.probability.rules': [
    'adding probabilities of overlapping events',
    'multiplying without checking independence',
    'sign slips with the complement rule',
  ],
  'stats.random-variables.expected-value': [
    'averaging the outcomes without their probabilities',
    'weighting by the wrong probability',
    'expecting the expected value to be a possible outcome',
  ],

  // ── Added with the 11-course restructure ─────────────────────────────────
  // The graph roughly doubled (66 → 148 concepts) to cover AP Statistics'
  // inference half, Calculus BC, and the function-analysis/conics/matrices
  // material the core courses were missing. Same discipline as the entries
  // above: curated teacher knowledge, one entry set per concept, chip-length
  // and lowercase-leaning. The catalog test requires EVERY curriculum concept
  // to resolve, so a new concept cannot ship without a real first-place-to-
  // check — which is the point: an empty chip would be worse than the generic
  // trio this catalog replaced.

  // Algebra 1
  'algebra.linear.slope-forms': [
    'mixing up the slope and the intercept',
    'losing the sign when rearranging into point-slope form',
    'using the reciprocal, not the negative reciprocal',
  ],
  'algebra.exponential.growth': [
    'adding the growth rate each step instead of multiplying',
    'treating a growth factor as a fixed amount',
    'reading an exponential table as if it were linear',
  ],
  'algebra.sequences.patterns': [
    'confusing the recursive and explicit formulas',
    'starting the index at the wrong term',
    'assuming every pattern is arithmetic',
  ],
  'algebra.data.scatter-plots': [
    'reading correlation as causation',
    'fitting the line to the end points only',
    'extrapolating far past the data',
  ],

  // Geometry
  'geometry.proofs.logic': [
    'assuming what the proof is meant to show',
    'confusing a statement with its converse',
    'skipping the reason for a step',
  ],
  'geometry.quadrilaterals.properties': [
    'assuming a parallelogram without proving it',
    'mixing up rhombus and rectangle properties',
    'using the interior angle sum for the wrong number of sides',
  ],
  'geometry.constructions.compass': [
    'changing the compass width partway through',
    'measuring with a ruler instead of constructing',
    'drawing the arc too short to cross',
  ],
  'geometry.solids.cross-sections': [
    'picturing the cross section as the whole solid',
    'slicing along the wrong axis',
    'assuming every cross section is the same size',
  ],
  'geometry.probability.geometric': [
    'comparing lengths when the problem is about area',
    'forgetting to divide by the total region',
    'assuming a favourable region must be a simple shape',
  ],

  // Algebra 2
  'algebra2.functions.transformations': [
    'shifting the wrong way for an inside change',
    'mixing up horizontal and vertical stretches',
    'applying the transformations in the wrong order',
  ],
  'algebra2.functions.inverses': [
    'treating the inverse as the reciprocal',
    'composing in the wrong order',
    'forgetting to restrict the domain',
  ],
  'algebra2.functions.piecewise': [
    'using the wrong piece for the input',
    'ignoring whether an endpoint is included',
    'evaluating every piece instead of choosing one',
  ],
  'algebra2.radical.equations': [
    'not checking for extraneous solutions',
    'squaring term by term instead of squaring both sides',
    'losing the domain restriction on an even root',
  ],
  'algebra2.conics.sections': [
    'mixing up which denominator belongs to a and which to b',
    'confusing an ellipse with a hyperbola from the sign',
    'forgetting to complete the square before reading the center',
  ],
  'algebra2.matrices.operations': [
    'assuming matrix multiplication commutes',
    'multiplying entry by entry instead of row by column',
    'multiplying matrices whose dimensions do not match',
  ],

  // Precalculus / AP Precalculus
  'precalc.functions.rates-of-change': [
    'reading an average rate of change as an instantaneous one',
    'confusing increasing with concave up',
    'dividing the change in x by the change in y',
  ],
  'precalc.exponential.log-modeling': [
    'fitting a linear model to clearly exponential data',
    'mixing up the initial value and the growth factor',
    'reporting a model without checking it against the data',
  ],
  'precalc.modeling.semi-log': [
    'log-scaling the wrong axis',
    'reading the semi-log slope as the growth factor',
    'assuming a straight semi-log plot means linear growth',
  ],
  'precalc.polar.coordinates': [
    'mixing up which of r and theta comes first',
    'losing the quadrant when converting with arctan',
    'assuming a point has only one polar representation',
  ],
  'precalc.polar.graphs': [
    'plotting polar equations as if they were rectangular',
    'missing petals by using too small a theta interval',
    'ignoring where r is negative',
  ],
  'precalc.parametric.functions': [
    'eliminating the parameter and losing the domain',
    'ignoring the direction the curve is traced',
    'treating t as if it were x',
  ],
  'precalc.matrices.transformations': [
    'applying the transformations in the wrong order',
    'multiplying the matrices in the wrong order',
    'using the inverse when the determinant is zero',
  ],

  // Calculus BC
  'calculus.parametric.calculus': [
    'dividing dy/dt by dx/dt in the wrong order',
    'forgetting to divide by dx/dt a second time',
    'using the rectangular arc-length formula',
  ],
  'calculus.vector-valued.motion': [
    'confusing speed with velocity',
    'adding the components instead of taking the magnitude',
    'differentiating the magnitude instead of the components',
  ],
  'calculus.polar.calculus': [
    'forgetting the one-half in the polar area formula',
    'integrating over the wrong theta interval',
    'using the rectangular area formula on a polar curve',
  ],
  'calculus.sequences.convergence': [
    'concluding a series converges because its terms go to zero',
    'confusing the terms with the partial sums',
    'assuming a bounded sequence must converge',
  ],
  'calculus.series.convergence-tests': [
    'using a test whose conditions are not met',
    'mixing up the p-series and geometric-series thresholds',
    'concluding convergence when the ratio test gives 1',
  ],
  'calculus.series.alternating-error': [
    'using the alternating bound on any series',
    'using the wrong term for the bound',
    'confusing absolute with conditional convergence',
  ],
  'calculus.series.power': [
    'forgetting to test the endpoints of the interval',
    'confusing the radius with the interval of convergence',
    'centering the series at the wrong value',
  ],
  'calculus.series.taylor-maclaurin': [
    'forgetting the factorial in the denominator',
    'expanding about the wrong center',
    'dropping the power of (x - a)',
  ],
  'calculus.series.lagrange-error': [
    'using the nth derivative instead of the (n+1)st',
    'not maximizing the derivative over the whole interval',
    'forgetting the factorial in the remainder',
  ],

  // AP Statistics — units 1-3 (data & collection)
  'stats.data.displays': [
    'describing center and spread but never the shape',
    'reading a histogram as if the bars were categories',
    'calling a distribution skewed toward the tall side',
  ],
  'stats.data.position': [
    'treating a z-score as a percentage',
    'assuming a percentile is a percent correct',
    'using the outlier rule without computing the IQR',
  ],
  'stats.data.two-way-tables': [
    'confusing a marginal with a conditional distribution',
    'conditioning on the wrong variable',
    'comparing counts when the group sizes differ',
  ],
  'stats.regression.scatterplots-correlation': [
    'reading correlation as causation',
    'assuming a strong r means the model is linear',
    'letting an outlier drive the correlation',
  ],
  'stats.regression.least-squares': [
    'interpreting the slope without units or context',
    'reading the intercept as meaningful outside the data',
    'confusing r with r-squared',
  ],
  'stats.regression.residuals': [
    'reading a clear pattern in the residual plot as a good fit',
    'confusing an outlier with an influential point',
    'computing the residual as predicted minus actual',
  ],
  'stats.sampling.methods': [
    'assuming a large sample is representative',
    'confusing stratified with cluster sampling',
    'assuming a voluntary response sample is random',
  ],
  'stats.experiments.design': [
    'confusing random assignment with random selection',
    'calling an observational study an experiment',
    'leaving a confounding variable unaddressed',
  ],
  'stats.scope.inference': [
    'generalizing to a population the sample was not drawn from',
    'claiming causation without random assignment',
    'ignoring how subjects were selected',
  ],

  // AP Statistics — units 5-9 (sampling distributions & inference)
  'stats.sampling-distributions.proportion': [
    'confusing p-hat with p',
    'skipping the large-counts condition',
    'using sigma as the standard error',
  ],
  'stats.sampling-distributions.mean': [
    'applying the CLT to the population itself',
    'forgetting to divide the standard deviation by the root of n',
    'assuming the sample size fixes a skewed population',
  ],
  'stats.inference.ci-proportion': [
    'saying there is a 95% chance p is in this interval',
    'interpreting the interval as covering 95% of individuals',
    'using z when the conditions are not met',
  ],
  'stats.inference.test-proportion': [
    'writing the hypotheses about the sample',
    'reading the p-value as the probability the null is true',
    'accepting the null rather than failing to reject it',
  ],
  'stats.inference.errors-power': [
    'swapping Type I and Type II errors',
    'thinking lowering alpha has no cost',
    'treating power as the probability of being right',
  ],
  'stats.inference.two-proportions': [
    'forgetting to pool for the test but not the interval',
    'checking conditions for only one of the two groups',
    'subtracting the proportions in a different order than stated',
  ],
  'stats.inference.ci-mean': [
    'using z instead of t when sigma is unknown',
    'using n instead of n-1 for the degrees of freedom',
    'interpreting the interval as about individual values',
  ],
  'stats.inference.test-mean': [
    'treating paired data as two independent samples',
    'stating the hypotheses about the sample mean',
    'skipping the normality or large-sample condition',
  ],
  'stats.inference.two-means': [
    'pooling the variances without justification',
    'pairing samples that are actually independent',
    'reversing the order of subtraction midway',
  ],
  'stats.inference.chi-square-gof': [
    'using proportions instead of counts',
    'ignoring the expected-count condition',
    'using the wrong degrees of freedom',
  ],
  'stats.inference.chi-square-independence': [
    'confusing a test for homogeneity with one for independence',
    'computing the expected counts from the wrong marginal',
    'using rows times columns for the degrees of freedom',
  ],
  'stats.inference.slope': [
    'reading the wrong row of the regression output',
    'using the standard deviation, not the standard error',
    'concluding causation from a significant slope',
  ],
}

// The concept family ("strand.topic") — the same first-two-segments read
// predict.ts's related-concept tier uses.
function familyOf(conceptKey: string): string {
  return conceptKey.split('.').slice(0, 2).join('.')
}

/**
 * Up to `limit` curated common misconceptions for one concept — the
 * cold-start replacement for the extension's fixed generic sticking chips.
 * Exact concept entry first; an unknown key (future curriculum growth)
 * degrades to entries borrowed from same-family concepts, then []. Only
 * called with a resolved curriculum key, but every branch is total — this
 * can never throw on a stale key.
 */
export function commonMisconceptionsFor(conceptKey: string, limit = 3): string[] {
  const exact = CATALOG[conceptKey]
  if (exact) return exact.slice(0, limit)

  // Same-family borrow: only meaningful for keys the catalog predates.
  if (!getConcept(conceptKey)) return []
  const family = familyOf(conceptKey)
  const borrowed: string[] = []
  for (const [key, entries] of Object.entries(CATALOG)) {
    if (familyOf(key) !== family) continue
    for (const entry of entries) {
      if (borrowed.length < limit && !borrowed.includes(entry)) borrowed.push(entry)
    }
    if (borrowed.length >= limit) break
  }
  return borrowed
}
