import { useEffect, useState } from 'react';
import type { AnnotationColorMap } from './Overlay';

// The annotation layer (Sprint 12 Task 6, ADR-022; Sprint 14 Task 8 box-
// primary rendering + label collision layout, ADR-029 amendment). The ONLY
// thing this file does is turn already-resolved draw instructions into SVG
// shapes. Presentational, like Overlay.tsx: no chrome.*, no host-DOM read,
// and deliberately no import from content/annotations.ts (the resolver)
// even for types -- the shapes below are a by-convention re-declaration of
// DrawInstruction/AnnotationsEventDetail, the same pattern messages.ts uses
// for PageEquation/Annotation. Keeping the boundary import-free means this
// component can never accidentally reach for a host-DOM read. The ONE
// exception (Task 8) is a type-only import of AnnotationColorMap from
// Overlay.tsx -- a plain string-keyed record, not a DOM/chrome type, so it
// doesn't touch that boundary; the type-only form also means there's no
// runtime circular dependency with Overlay.tsx's own value import of this
// component (Transcript.tsx already establishes the same pattern for the
// same map).
//
// Coordinates: DrawRect is a getBoundingClientRect()-space rect (viewport
// px). This SVG has no viewBox and is sized to exactly 100vw/100vh via CSS,
// so 1 user unit == 1 css px -- rects drop straight in with no scaling or
// offset math, which is the whole point of drawing inside the shadow root
// that shares the host's coordinate space (ADR-002).

const ANNOTATIONS_EVENT = 'calyxa:annotations';

type AnnotationDrawType = 'highlight' | 'circle' | 'arrow' | 'label' | 'step-indicator';

type DrawRect = { x: number; y: number; w: number; h: number };

type DrawInstruction = {
  id: string;
  type: AnnotationDrawType;
  rect: DrawRect;
  style?: { color?: string; weight?: string };
  label?: string;
  step?: number;
};

type AnnotationsEventDetail = { annotations: DrawInstruction[] };

// The prompt-side allow-list (system-prompt.ts's ANNOTATION GUIDANCE block,
// Task 2): "amber" | "blue" | "green" | "red", amber default. An unknown or
// missing color falls back to amber -- never drop a shape for a bad color.
// Unchanged by Task 8: this is the MODEL'S OWN explicit-color palette
// (style.color), a separate namespace from the per-turn ORDINAL palette
// below -- see boxColorClass's comment for how the two combine.
const ALLOWED_COLORS = ['amber', 'blue', 'green', 'red'] as const;
type AllowedColor = (typeof ALLOWED_COLORS)[number];
const DEFAULT_COLOR: AllowedColor = 'amber';

function resolveColor(color: string | undefined): AllowedColor {
  return (ALLOWED_COLORS as readonly string[]).includes(color ?? '')
    ? (color as AllowedColor)
    : DEFAULT_COLOR;
}

// ---- Sprint 14 Task 8: deterministic label collision layout (ADR-029) ----
//
// Pure over rects -- no DOM measurement beyond the rects/text lengths
// already in the draw list -- so this is unit-testable without a browser
// (Task 9's own jsdom-free precedent, content/annotations.ts's resolver).
// Each label's NATURAL position is exactly LabelPill's old above/below +
// horizontal-clamp logic (moved here so it can be computed for every label
// UP FRONT, before any of them are drawn); a label whose natural position
// would overlap an EARLIER (already-placed) label in this same turn's draw
// order is pushed further in the SAME direction it already faces (further
// above the anchor, or further below it) until it clears every prior
// placement or a bounded number of attempts is spent, at which point it is
// clamped to the viewport and accepted as-is (three ≤MAX_ANNOTATIONS_PER_TURN
// labels is the realistic ceiling, so the bound is generous, not a real
// constraint in practice). A label that moved from its natural spot gets a
// short leader line back to the point on its own anchor box it would have
// hugged, so the reader can still tell which box a stacked label belongs to.

export const LABEL_HEIGHT = 22;
const LABEL_PADDING_X = 8;
const LABEL_GAP_PX = 4;
const MAX_STACK_ATTEMPTS = 8;
const VIEWPORT_MARGIN_PX = 4;

// SVG text has no layout pass to measure against before paint -- a rough
// monospace-ish estimate is generous enough for the short labels the prompt
// guidance caps at 5 words.
export function estimateLabelWidth(text: string): number {
  return Math.max(28, Math.round(text.length * 6.5) + LABEL_PADDING_X * 2);
}

export type LabelBox = {
  id: string;
  anchorRect: DrawRect;
  width: number;
  height: number;
  // step-indicator's badge sits ON the anchor point itself, so its label
  // needs a small rightward offset to clear the badge -- the one case
  // LabelPill already special-cased (offsetForBadge) before this file had
  // a collision pass at all.
  offsetForBadge?: boolean;
};

export type LabelPlacement = {
  id: string;
  x: number;
  y: number;
  // Present only when this label was moved off its natural position by the
  // collision pass -- a short line from the label's near edge back to the
  // anchor point it would otherwise have hugged.
  leader?: { x1: number; y1: number; x2: number; y2: number };
};

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function naturalLabelPosition(
  box: LabelBox,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number; fitsAbove: boolean } {
  const { anchorRect: rect, width, height, offsetForBadge } = box;
  const anchorX = offsetForBadge ? rect.x + 14 : rect.x;
  const fitsAbove = rect.y - height - 6 >= 0;
  const y = fitsAbove ? rect.y - height - 6 : Math.min(rect.y + rect.h + 6, viewportHeight - height);
  const x = Math.max(VIEWPORT_MARGIN_PX, Math.min(anchorX, viewportWidth - width - VIEWPORT_MARGIN_PX));
  return { x, y, fitsAbove };
}

/**
 * boxes MUST be in the turn's own annotation order -- an earlier annotation
 * always keeps its natural position; a later one yields when it collides.
 * Deterministic: the same input (same rects, same order) always produces
 * the same output, no randomness, no timing dependency.
 */
export function layoutLabels(
  boxes: readonly LabelBox[],
  viewportWidth: number,
  viewportHeight: number,
): LabelPlacement[] {
  const placed: { x: number; y: number; width: number; height: number }[] = [];
  const result: LabelPlacement[] = [];

  for (const box of boxes) {
    const natural = naturalLabelPosition(box, viewportWidth, viewportHeight);
    const clampY = (value: number) =>
      Math.max(VIEWPORT_MARGIN_PX, Math.min(value, viewportHeight - box.height - VIEWPORT_MARGIN_PX));
    const x = Math.max(VIEWPORT_MARGIN_PX, Math.min(natural.x, viewportWidth - box.width - VIEWPORT_MARGIN_PX));
    let y = clampY(natural.y);
    let attempts = 0;

    // Clamped INSIDE the loop, not just at the end -- so the overlap check
    // on each attempt runs against the position that will actually be kept
    // if it clears, not an unclamped candidate that might get pulled back
    // onto a spot it already tried (and rejected) near a viewport edge.
    while (
      placed.some((p) => rectsOverlap({ x, y, width: box.width, height: box.height }, p)) &&
      attempts < MAX_STACK_ATTEMPTS
    ) {
      attempts += 1;
      y = clampY(natural.fitsAbove ? y - (box.height + LABEL_GAP_PX) : y + (box.height + LABEL_GAP_PX));
    }

    const stacked = attempts > 0 && y !== natural.y;
    const anchorPointX = box.anchorRect.x + box.anchorRect.w / 2;
    const anchorPointY = natural.fitsAbove ? box.anchorRect.y : box.anchorRect.y + box.anchorRect.h;

    result.push({
      id: box.id,
      x,
      y,
      ...(stacked
        ? {
            leader: {
              x1: x + box.width / 2,
              y1: natural.fitsAbove ? y + box.height : y,
              x2: anchorPointX,
              y2: anchorPointY,
            },
          }
        : {}),
    });

    placed.push({ x, y, width: box.width, height: box.height });
  }

  return result;
}

// True for every draw type LabelPill actually renders something for --
// 'label' always shows a pill (even with empty text, the existing edge
// case); every other type only when the turn set a `label` field.
function willShowLabel(instruction: DrawInstruction): boolean {
  return instruction.type === 'label' || Boolean(instruction.label);
}

export function AnnotationLayer({ annotationColors }: { annotationColors?: AnnotationColorMap }) {
  const [annotations, setAnnotations] = useState<DrawInstruction[]>([]);

  useEffect(() => {
    function onAnnotations(event: Event) {
      const detail = (event as CustomEvent<AnnotationsEventDetail>).detail;
      setAnnotations(detail?.annotations ?? []);
    }
    window.addEventListener(ANNOTATIONS_EVENT, onAnnotations);
    return () => window.removeEventListener(ANNOTATIONS_EVENT, onAnnotations);
  }, []);

  if (annotations.length === 0) return null;

  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0;

  const labelBoxes: LabelBox[] = annotations.filter(willShowLabel).map((instruction) => ({
    id: instruction.id,
    anchorRect: instruction.rect,
    width: estimateLabelWidth(instruction.label ?? ''),
    height: LABEL_HEIGHT,
    offsetForBadge: instruction.type === 'step-indicator',
  }));
  const placements = new Map(layoutLabels(labelBoxes, viewportWidth, viewportHeight).map((p) => [p.id, p]));

  return (
    <svg className="cx-annotation-layer" aria-hidden="true" focusable="false">
      <defs>
        {ALLOWED_COLORS.map((color) => (
          <marker
            key={color}
            id={`cx-annot-arrowhead-${color}`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 Z" className={`cx-annot-marker cx-annot-${color}`} />
          </marker>
        ))}
      </defs>
      {annotations.map((instruction) => (
        <AnnotationShape
          key={instruction.id}
          instruction={instruction}
          placement={placements.get(instruction.id)}
          annotationColors={annotationColors}
        />
      ))}
    </svg>
  );
}

/**
 * The box's OWN stroke color (Task 8, ADR-029 amendment): the model's
 * explicit `style.color` always wins when present (additive -- the
 * existing amber/blue/green/red field and its default are UNCHANGED). Only
 * when the model left it unset does the box additionally consult the
 * shared per-turn ordinal assignment Overlay.tsx computed for this exact
 * annotation id (Task 7's assignAnnotationColors) -- the same map
 * Transcript.tsx's color-linked text highlight already reads, so a turn
 * whose `say` names an annotated term shows the SAME color on the box and
 * the phrase. No entry for this id (annotationColors prop absent, or this
 * particular annotation didn't survive resolution into the map for some
 * reason) falls back to the ordinary amber default -- never an unstyled box.
 */
function boxColorClass(instruction: DrawInstruction, annotationColors: AnnotationColorMap | undefined): string {
  if (instruction.style?.color) return `cx-annot-${resolveColor(instruction.style.color)}`;
  const slot = annotationColors?.[instruction.id];
  return slot ? `cx-annot-box-${slot}` : `cx-annot-${DEFAULT_COLOR}`;
}

function AnnotationShape({
  instruction,
  placement,
  annotationColors,
}: {
  instruction: DrawInstruction;
  placement: LabelPlacement | undefined;
  annotationColors: AnnotationColorMap | undefined;
}) {
  const color = resolveColor(instruction.style?.color);
  const colorClass = `cx-annot-${color}`;
  const { rect, label } = instruction;

  switch (instruction.type) {
    case 'highlight':
      return (
        <g className="cx-annot-in">
          <Highlight
            rect={rect}
            thin={instruction.style?.weight === 'thin'}
            colorClass={colorClass}
            boxColorClass={boxColorClass(instruction, annotationColors)}
          />
          {label && placement && <LabelPill text={label} placement={placement} colorClass={colorClass} />}
        </g>
      );
    case 'circle':
      return (
        <g className="cx-annot-in">
          <ellipse
            cx={rect.x + rect.w / 2}
            cy={rect.y + rect.h / 2}
            rx={rect.w / 2 + 8}
            ry={rect.h / 2 + 8}
            className={`cx-annot-outline ${colorClass}`}
          />
          {label && placement && <LabelPill text={label} placement={placement} colorClass={colorClass} />}
        </g>
      );
    case 'arrow':
      return (
        <g className="cx-annot-in">
          <Arrow rect={rect} colorClass={colorClass} color={color} />
          {label && placement && <LabelPill text={label} placement={placement} colorClass={colorClass} />}
        </g>
      );
    case 'label':
      return (
        <g className="cx-annot-in">
          {placement && <LabelPill text={label ?? ''} placement={placement} colorClass={colorClass} />}
        </g>
      );
    case 'step-indicator':
      return (
        <g className="cx-annot-in">
          <StepBadge rect={rect} step={instruction.step} colorClass={colorClass} />
          {label && placement && <LabelPill text={label} placement={placement} colorClass={colorClass} />}
        </g>
      );
    default:
      return null;
  }
}

// The primary annotation shape (Task 8, ADR-029 amendment): a rounded-rect
// with a colored coat (translucent fill) under a clean outlined stroke
// (cx-annot-box) -- "the outlined box is the primary annotation, circle/arrow
// are special cases". The coat was restored in the Sprint 14 fix pass after
// live feedback that the outline-only box read as less present than the
// earlier color-coated highlight; the outline still carries the layout
// engine's box geometry. `weight: 'thin'` (the §2.5 style hint) is UNCHANGED: still reads
// as an underline hugging the bottom edge, still uses the model's own
// explicit-or-default color (colorClass) rather than the per-turn ordinal
// one -- a filled bar has no "stroke" for the box-stroke rule to apply to.
function Highlight({
  rect,
  thin,
  colorClass,
  boxColorClass,
}: {
  rect: DrawRect;
  thin: boolean;
  colorClass: string;
  boxColorClass: string;
}) {
  if (thin) {
    return (
      <rect
        x={rect.x}
        y={rect.y + rect.h - 3}
        width={rect.w}
        height={3}
        rx={1.5}
        className={`cx-annot-fill-solid ${colorClass}`}
      />
    );
  }
  return (
    <rect
      x={rect.x - 4}
      y={rect.y - 4}
      width={rect.w + 8}
      height={rect.h + 8}
      rx={6}
      className={`cx-annot-box ${boxColorClass}`}
    />
  );
}

// Points at the target's nearest edge (its top-center) from a short offset
// above-right -- there is no "source" point in the schema (an annotation
// names only what to point AT), so the arrow's origin is a fixed offset
// rather than anything derived from page content.
function Arrow({ rect, colorClass, color }: { rect: DrawRect; colorClass: string; color: AllowedColor }) {
  const tipX = rect.x + rect.w / 2;
  const tipY = rect.y - 6;
  const originX = tipX + Math.min(56, rect.w / 2 + 40);
  const originY = tipY - 44;
  return (
    <line
      x1={originX}
      y1={originY}
      x2={tipX}
      y2={tipY}
      className={`cx-annot-stroke ${colorClass}`}
      markerEnd={`url(#cx-annot-arrowhead-${color})`}
    />
  );
}

// A numbered badge for step-by-step walkthroughs, ordered by `step`
// (system-prompt.ts's ANNOTATION GUIDANCE: 1-based, set within one turn).
function StepBadge({ rect, step, colorClass }: { rect: DrawRect; step: number | undefined; colorClass: string }) {
  const cx = rect.x;
  const cy = rect.y;
  return (
    <g>
      <circle cx={cx} cy={cy} r={11} className={`cx-annot-fill-solid ${colorClass}`} />
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" className="cx-annot-badge-text">
        {step ?? ''}
      </text>
    </g>
  );
}

// A small pill at its collision-resolved position (Task 8's layoutLabels,
// computed once for the whole turn in AnnotationLayer above -- this
// component no longer computes its own natural/clamped position). Draws a
// short leader line back to its anchor box FIRST (so the pill visually sits
// on top of the line's near end) whenever the placement says this label
// was moved off its natural spot to avoid overlapping an earlier one.
function LabelPill({
  text,
  placement,
  colorClass,
}: {
  text: string;
  placement: LabelPlacement;
  colorClass: string;
}) {
  const width = estimateLabelWidth(text);
  const { x, y, leader } = placement;

  return (
    <g>
      {leader && (
        <line x1={leader.x1} y1={leader.y1} x2={leader.x2} y2={leader.y2} className={`cx-annot-leader ${colorClass}`} />
      )}
      <rect x={x} y={y} width={width} height={LABEL_HEIGHT} rx={LABEL_HEIGHT / 2} className={`cx-annot-fill-solid ${colorClass}`} />
      <text
        x={x + width / 2}
        y={y + LABEL_HEIGHT / 2}
        textAnchor="middle"
        dominantBaseline="central"
        className="cx-annot-badge-text"
      >
        {text}
      </text>
    </g>
  );
}
