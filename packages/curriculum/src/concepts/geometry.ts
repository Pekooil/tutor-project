// Geometry content (ADR-032 appendix, extended by the 11-course restructure):
// angles & parallel lines, triangle congruence, similarity, right-triangle
// trig, circles, area & volume, coordinate geometry & transformations — plus
// the six additions below.
//
// The significant one is `geometry.proofs.logic`. Proof is the spine of a
// Geometry course and the graph had no concept for it at all, so a student
// stuck on a two-column proof had nothing to attach mastery to.
// `geometry.circles.equations` is also load-bearing beyond this file: conic
// sections in Algebra 2 build on it.
import type { Concept } from './types'

export const GEOMETRY_CONCEPTS: readonly Concept[] = [
  {
    key: 'geometry.proofs.logic',
    strand: 'proof-and-logic',
    title: 'Proof & logical reasoning',
    strandLabel: 'Proof & logic',
    prerequisites: [],
    difficultyPrior: 0.5,
    aliases: ['two-column proof', 'geometric proof', 'converse', 'conditional statement', 'if then statement', 'counterexample'],
  },
  {
    key: 'geometry.angles.parallel-lines',
    strand: 'angles',
    title: 'Angles & parallel lines',
    strandLabel: 'Angles',
    prerequisites: [],
    difficultyPrior: 0.3,
    aliases: ['parallel lines', 'transversal', 'alternate interior angles', 'corresponding angles'],
  },
  {
    key: 'geometry.triangles.congruence',
    strand: 'triangle-congruence',
    title: 'Triangle congruence',
    strandLabel: 'Triangle congruence',
    prerequisites: ['geometry.angles.parallel-lines'],
    difficultyPrior: 0.4,
    aliases: ['triangle congruence', 'SSS', 'SAS', 'ASA', 'congruent triangles'],
  },
  {
    key: 'geometry.triangles.similarity',
    strand: 'similarity',
    title: 'Similarity',
    strandLabel: 'Similarity',
    prerequisites: ['geometry.triangles.congruence'],
    difficultyPrior: 0.45,
    aliases: ['similar triangles', 'similarity', 'AA similarity', 'scale factor'],
  },
  {
    key: 'geometry.trig.right-triangle',
    strand: 'right-triangle-trig',
    title: 'Right-triangle trig (SOH-CAH-TOA)',
    strandLabel: 'Right-triangle trig',
    prerequisites: ['geometry.triangles.similarity'],
    difficultyPrior: 0.5,
    aliases: ['SOH CAH TOA', 'right triangle trig', 'sine cosine tangent', 'solving right triangles'],
  },
  {
    key: 'geometry.circles.arcs-angles',
    strand: 'circles',
    title: 'Circle arcs & angles',
    strandLabel: 'Circles',
    prerequisites: ['geometry.angles.parallel-lines'],
    difficultyPrior: 0.45,
    aliases: ['arcs', 'inscribed angles', 'central angles', 'circle theorems'],
  },
  {
    key: 'geometry.circles.area-circumference',
    strand: 'circles',
    title: 'Circle area & circumference',
    strandLabel: 'Circles',
    prerequisites: [],
    difficultyPrior: 0.3,
    aliases: ['circumference', 'area of a circle', 'pi', 'circle area'],
  },
  {
    key: 'geometry.measurement.area',
    strand: 'area-volume',
    title: 'Area of polygons',
    strandLabel: 'Area & volume',
    prerequisites: [],
    difficultyPrior: 0.3,
    aliases: ['area of polygons', 'area formulas', 'area of a triangle', 'area of a trapezoid'],
  },
  {
    key: 'geometry.measurement.volume',
    strand: 'area-volume',
    title: 'Volume & surface area of solids',
    strandLabel: 'Area & volume',
    prerequisites: ['geometry.measurement.area'],
    difficultyPrior: 0.45,
    aliases: ['volume', 'surface area', 'prisms and cylinders', 'volume of a solid'],
  },
  {
    key: 'geometry.coordinate.distance-midpoint',
    strand: 'coordinate-geometry',
    title: 'Coordinate geometry',
    strandLabel: 'Coordinate geometry',
    prerequisites: [],
    difficultyPrior: 0.35,
    aliases: ['distance formula', 'midpoint formula', 'coordinate geometry', 'slope of a line'],
  },
  {
    key: 'geometry.transformations.rigid-and-dilation',
    strand: 'transformations',
    title: 'Transformations',
    strandLabel: 'Transformations',
    prerequisites: ['geometry.coordinate.distance-midpoint'],
    difficultyPrior: 0.4,
    aliases: ['transformations', 'reflections', 'rotations', 'dilations', 'translations'],
  },

  // ── Additions (11-course restructure) ────────────────────────────────────
  {
    key: 'geometry.quadrilaterals.properties',
    strand: 'quadrilaterals',
    title: 'Quadrilaterals & polygon properties',
    strandLabel: 'Quadrilaterals',
    prerequisites: ['geometry.triangles.congruence'],
    difficultyPrior: 0.4,
    aliases: ['parallelogram properties', 'rhombus', 'trapezoid', 'interior angle sum', 'proving a quadrilateral'],
  },
  {
    key: 'geometry.circles.equations',
    strand: 'coordinate-geometry',
    title: 'Equations of circles in the coordinate plane',
    strandLabel: 'Coordinate geometry',
    prerequisites: ['geometry.coordinate.distance-midpoint', 'geometry.circles.area-circumference'],
    difficultyPrior: 0.45,
    aliases: ['equation of a circle', 'center and radius form', 'completing the square for a circle'],
  },
  {
    key: 'geometry.constructions.compass',
    strand: 'constructions',
    title: 'Compass & straightedge constructions',
    strandLabel: 'Constructions',
    prerequisites: ['geometry.angles.parallel-lines'],
    difficultyPrior: 0.35,
    aliases: ['compass and straightedge', 'perpendicular bisector construction', 'angle bisector', 'geometric construction'],
  },
  {
    key: 'geometry.solids.cross-sections',
    strand: 'area-volume',
    title: 'Cross sections & solids of revolution',
    strandLabel: 'Area & volume',
    prerequisites: ['geometry.measurement.volume'],
    difficultyPrior: 0.45,
    aliases: ['cross section of a solid', 'solid of revolution', 'slicing a solid', '2D to 3D'],
  },
  {
    key: 'geometry.probability.geometric',
    strand: 'geometric-probability',
    title: 'Geometric probability',
    strandLabel: 'Geometric probability',
    prerequisites: ['geometry.measurement.area', 'stats.probability.rules'],
    difficultyPrior: 0.4,
    aliases: ['geometric probability', 'probability using area', 'dartboard probability'],
  },
]
