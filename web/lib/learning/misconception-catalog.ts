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
