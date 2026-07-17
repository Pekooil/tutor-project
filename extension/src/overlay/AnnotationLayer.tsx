import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { AnnotationColorMap } from './Overlay';

// The annotation layer (Sprint 12 Task 6, ADR-022; Sprint 14 Task 8 box-
// primary rendering + label collision layout, ADR-029 amendment; Sprint 15
// "Calyxa Annotations" redesign -- the point + teach system). The ONLY
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
// The redesign's system (design handoff "Calyxa Annotations", README):
// every mark is an ordinal-colored TRIPLE (2px stroke + ~8% tint fill +
// tint pill with deep dark-on-light text -- replacing the old 22% fills and
// white-on-color pills), carries a label pill (the WHAT) and optionally a
// why-note card (the WHY, the teaching payload), enters with the M1
// "draw-on" motion (stroke draws in 480ms, tint fades from ~55%, label
// rises after) and exits with a 240ms opacity fade -- never a shrink.
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
  note?: string;
  step?: number;
};

type AnnotationsEventDetail = { annotations: DrawInstruction[] };

// The prompt-side allow-list (system-prompt.ts's ANNOTATION GUIDANCE block,
// Task 2): "amber" | "blue" | "green" | "red", amber default. An unknown or
// missing color falls back to amber -- never drop a shape for a bad color.
// The redesign maps each legacy semantic color onto the ordinal triple that
// carries the same hue in palette A "Meadow" (green->1, amber->2, blue->3,
// red->4's plum -- the closest calm hue; a hard red must never appear, it
// reads "error"), so the model's explicit-color field keeps working while
// every mark renders from the ONE triple system.
const ALLOWED_COLORS = ['amber', 'blue', 'green', 'red'] as const;
type AllowedColor = (typeof ALLOWED_COLORS)[number];
const DEFAULT_COLOR: AllowedColor = 'amber';

const LEGACY_COLOR_ORDINAL: Record<AllowedColor, string> = {
  green: 'cx-annot-o1',
  amber: 'cx-annot-o2',
  blue: 'cx-annot-o3',
  red: 'cx-annot-o4',
};

function resolveColor(color: string | undefined): AllowedColor {
  return (ALLOWED_COLORS as readonly string[]).includes(color ?? '')
    ? (color as AllowedColor)
    : DEFAULT_COLOR;
}

/**
 * The mark's ordinal triple (Task 8 precedence, unchanged by the redesign):
 * the model's explicit `style.color` always wins when present; only when it
 * is unset does the mark consult the shared per-turn ordinal assignment
 * Overlay.tsx computed for this exact annotation id (Task 7's
 * assignAnnotationColors) -- the same map Transcript.tsx's color-linked
 * text highlight reads, so a turn whose `say` names an annotated term shows
 * the SAME ordinal color on the mark and the phrase. No entry for this id
 * falls back to the amber-hued ordinal (o2) -- never an unstyled mark.
 */
function ordinalClass(instruction: DrawInstruction, annotationColors: AnnotationColorMap | undefined): string {
  if (instruction.style?.color) return LEGACY_COLOR_ORDINAL[resolveColor(instruction.style.color)];
  const slot = annotationColors?.[instruction.id]; // 'annot-1'..'annot-4'
  return slot ? `cx-annot-o${slot.slice('annot-'.length)}` : LEGACY_COLOR_ORDINAL[DEFAULT_COLOR];
}

// ---- design-token geometry (design handoff "Calyxa Annotations") ----

// Label pill: 26px tall, padding 0 11px, 12px/600 (was 22px / white-on-color).
export const LABEL_HEIGHT = 26;
const PILL_PADDING_X = 11;
const LABEL_GAP_PX = 4;
// Why-note card: width <=216px, padding 9px 12px, 12.5px/1.55 text, 6px dot.
const NOTE_WIDTH = 216;
const NOTE_GAP = 8;
const NOTE_LINE_HEIGHT = 19.4; // 12.5px * 1.55
// Box/circle stand-off from the target's own bounding box.
const BOX_INSET = 6;
const CIRCLE_PAD_X = 10;
const CIRCLE_PAD_Y = 6;
// Step badge: 22px circle, the pre-session plan's timeline-circle twin.
const BADGE_RADIUS = 11;
// Entry motion M1 "draw-on": marks arriving together draw one after another
// (the production stand-in for "sequenced with the tutor's speech" when a
// whole turn lands at once -- voice mode already sequences upstream).
const STAGGER_MS = 600;
// Exit is always a 240ms opacity fade -- never a shrink.
const EXIT_MS = 240;

const MAX_STACK_ATTEMPTS = 8;
const VIEWPORT_MARGIN_PX = 4;

// SVG text has no layout pass to measure against before paint -- a rough
// estimate is generous enough for the verb-first <=4-word labels the prompt
// guidance demands.
export function estimateLabelWidth(text: string): number {
  return Math.max(28, Math.round(text.length * 6.8) + PILL_PADDING_X * 2);
}

// The note renders as wrapped HTML inside a foreignObject, which needs an
// explicit height before layout -- estimated the same way as label width.
// Inner text column: 216 - 2 border - 24 padding - 14 dot+gap = 176px at
// ~6.2px/char (12.5px system sans) ~= 28 chars/line; <=90-char notes top
// out around 4 lines.
export function estimateNoteHeight(text: string): number {
  const lines = Math.max(1, Math.ceil(text.length / 28));
  return Math.round(lines * NOTE_LINE_HEIGHT) + 20; // + padding (18) + border (2)
}

// ---- Sprint 14 Task 8: deterministic label collision layout (ADR-029) ----
//
// Pure over rects -- no DOM measurement beyond the rects/text lengths
// already in the draw list -- so this is unit-testable without a browser
// (Task 9's own jsdom-free precedent, content/annotations.ts's resolver).
// Each label's NATURAL position is above the anchor when it fits (below
// otherwise), horizontally clamped; a label whose natural position would
// overlap an EARLIER (already-placed) label in this same turn's draw order
// is pushed further in the SAME direction it already faces until it clears
// every prior placement or a bounded number of attempts is spent, at which
// point it is clamped to the viewport and accepted as-is. A label that
// moved from its natural spot gets a leader (the redesign's 1.5px @ 45%
// gentle S-curve with a 3px dot at the mark end) back to the point on its
// own anchor box it would have hugged. The box's width/height now cover the
// pill PLUS the attached why-note when one is present, so the collision
// pass keeps note cards from overlapping too.

export type LabelBox = {
  id: string;
  anchorRect: DrawRect;
  width: number;
  height: number;
  // A badge sitting in the label's row (step-indicator's badge on the
  // anchor point, or the redesign's mark-corner step badge) needs the pill
  // pushed right to clear it -- the px amount differs by case.
  offsetPx?: number;
};

export type LabelPlacement = {
  id: string;
  x: number;
  y: number;
  // Present only when this label was moved off its natural position by the
  // collision pass -- the leader from the label's near edge back to the
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
  const { anchorRect: rect, width, height, offsetPx } = box;
  const anchorX = rect.x + (offsetPx ?? 0);
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
// case); every other type only when the turn set a `label` field. The
// redesign makes labels REQUIRED prompt-side ("no naked shapes"), but a
// mark that arrives without one still draws -- never drop a shape for a
// missing pill.
function willShowLabel(instruction: DrawInstruction): boolean {
  return instruction.type === 'label' || Boolean(instruction.label);
}

function labelBoxFor(instruction: DrawInstruction): LabelBox {
  const pillWidth = estimateLabelWidth(instruction.label ?? '');
  const note = instruction.note;
  return {
    id: instruction.id,
    anchorRect: instruction.rect,
    width: note ? Math.max(pillWidth, NOTE_WIDTH) : pillWidth,
    height: LABEL_HEIGHT + (note ? NOTE_GAP + estimateNoteHeight(note) : 0),
    // step-indicator's badge sits ON the anchor point itself; a mark-corner
    // step badge (any other type with `step` set) sits above the mark's
    // top-left -- both need the pill pushed right to clear the 22px circle.
    ...(instruction.type === 'step-indicator'
      ? { offsetPx: 14 }
      : instruction.step !== undefined
        ? { offsetPx: BADGE_RADIUS * 2 + 6 }
        : {}),
  };
}

// ---- entry/exit lifecycle (redesign: draw-on in, 240ms fade out) ----
//
// The controller replaces the whole draw list on every dispatch. To honor
// "exit is always a 240ms opacity fade" the layer keeps marks that just
// left the list mounted for EXIT_MS with the .cx-annot-out class before
// dropping them. A mark whose id survives a dispatch keeps its mounted
// group (rect updates in place -- re-anchor scroll passes must NOT replay
// the draw-on), which is why each mark carries a generation stamp: the same
// id re-arriving AFTER it started exiting is a genuinely new mark and gets
// a fresh key (and a fresh draw-on).

type RenderedMark = {
  instruction: DrawInstruction;
  gen: number;
  entryIndex: number; // position among the marks that entered together -> stagger delay
  exiting: boolean;
  ordinal: string; // frozen at entry so an exiting mark never flashes a new turn's color
};

export function AnnotationLayer({ annotationColors }: { annotationColors?: AnnotationColorMap }) {
  const [marks, setMarks] = useState<RenderedMark[]>([]);
  const genRef = useRef(0);
  const colorsRef = useRef(annotationColors);
  colorsRef.current = annotationColors;
  // Last computed placement per mark id -- exiting marks keep rendering
  // their label where it last stood instead of re-entering the collision
  // pass against the new turn's labels.
  const placementsRef = useRef(new Map<string, LabelPlacement>());
  // Per-explanation drag offsets, keyed by the SAME gen:id key the mark uses
  // for its React key -- so an exiting mark keeps its offset (same gen) while
  // a genuinely new mark reusing an id (fresh gen) starts un-dragged. Only
  // the explanation (label pill + why-note) is draggable; every shape stays
  // inert. The pruning effect below drops keys once a mark is fully gone.
  const [dragOffsets, setDragOffsets] = useState<Map<string, { dx: number; dy: number }>>(new Map());

  const handleDrag = useCallback((key: string, offset: { dx: number; dy: number } | undefined) => {
    setDragOffsets((prev) => {
      const next = new Map(prev);
      if (offset) next.set(key, offset);
      else next.delete(key);
      return next;
    });
  }, []);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    function onAnnotations(event: Event) {
      const detail = (event as CustomEvent<AnnotationsEventDetail>).detail;
      const next = detail?.annotations ?? [];

      setMarks((prev) => {
        const nextIds = new Set(next.map((d) => d.id));
        const liveById = new Map(prev.filter((m) => !m.exiting).map((m) => [m.instruction.id, m]));
        const merged: RenderedMark[] = [];

        // Marks leaving the list start (or continue) their exit fade; a
        // previously-exiting mark whose id is back in the list is simply
        // dropped here -- its replacement below gets a fresh generation.
        for (const mark of prev) {
          if (nextIds.has(mark.instruction.id)) continue;
          merged.push(mark.exiting ? mark : { ...mark, exiting: true });
        }

        let entryIndex = 0;
        for (const instruction of next) {
          const existing = liveById.get(instruction.id);
          if (existing) {
            // Same mark, updated rect (re-anchor) -- keep key, ordinal, and
            // entry state so nothing replays.
            merged.push({ ...existing, instruction });
          } else {
            genRef.current += 1;
            merged.push({
              instruction,
              gen: genRef.current,
              entryIndex: entryIndex++,
              exiting: false,
              ordinal: ordinalClass(instruction, colorsRef.current),
            });
          }
        }

        return merged;
      });

      // One sweep per dispatch clears every mark that is exiting by then.
      timers.push(
        setTimeout(() => {
          setMarks((prev) => (prev.some((m) => m.exiting) ? prev.filter((m) => !m.exiting) : prev));
        }, EXIT_MS + 20),
      );
    }

    window.addEventListener(ANNOTATIONS_EVENT, onAnnotations);
    return () => {
      window.removeEventListener(ANNOTATIONS_EVENT, onAnnotations);
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);

  // Drop drag offsets whose mark is fully gone (past its exit sweep) so the
  // map can't grow unbounded over a long session.
  useEffect(() => {
    setDragOffsets((prev) => {
      if (prev.size === 0) return prev;
      const liveKeys = new Set(marks.map((m) => `${m.gen}:${m.instruction.id}`));
      let changed = false;
      const next = new Map<string, { dx: number; dy: number }>();
      for (const [key, value] of prev) {
        if (liveKeys.has(key)) next.set(key, value);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [marks]);

  if (marks.length === 0) return null;

  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0;

  const activeMarks = marks.filter((m) => !m.exiting);
  const labelBoxes = activeMarks.map((m) => m.instruction).filter(willShowLabel).map(labelBoxFor);
  const placements = new Map(layoutLabels(labelBoxes, viewportWidth, viewportHeight).map((p) => [p.id, p]));
  for (const [id, placement] of placements) placementsRef.current.set(id, placement);

  return (
    <svg className="cx-annotation-layer" aria-hidden="true" focusable="false">
      {marks.map((mark) => {
        const markKey = `${mark.gen}:${mark.instruction.id}`;
        return (
          <AnnotationMark
            key={markKey}
            mark={mark}
            annotationColors={annotationColors}
            placement={
              mark.exiting ? placementsRef.current.get(mark.instruction.id) : placements.get(mark.instruction.id)
            }
            dragKey={markKey}
            dragOffset={dragOffsets.get(markKey)}
            onDrag={handleDrag}
          />
        );
      })}
    </svg>
  );
}

function AnnotationMark({
  mark,
  placement,
  annotationColors,
  dragKey,
  dragOffset,
  onDrag,
}: {
  mark: RenderedMark;
  placement: LabelPlacement | undefined;
  annotationColors: AnnotationColorMap | undefined;
  dragKey: string;
  dragOffset: { dx: number; dy: number } | undefined;
  onDrag: (key: string, offset: { dx: number; dy: number } | undefined) => void;
}) {
  const { instruction, exiting, entryIndex } = mark;
  // Live marks re-resolve every render (the per-turn map can land a beat
  // after the draw event); exiting ones keep the ordinal they entered with.
  const ordinal = exiting ? mark.ordinal : ordinalClass(instruction, annotationColors);
  const { rect, label, note, step } = instruction;

  const meta = (
    <g className="cx-annot-meta">
      {step !== undefined && instruction.type !== 'step-indicator' && (
        <StepBadge cx={rect.x - BOX_INSET + BADGE_RADIUS - 6} cy={rect.y - BOX_INSET - BADGE_RADIUS - 5} step={step} />
      )}
      {willShowLabel(instruction) && placement && (
        <LabelPill
          text={label ?? ''}
          note={note}
          placement={placement}
          anchorRect={rect}
          dragKey={dragKey}
          dragOffset={dragOffset}
          onDrag={onDrag}
          exiting={exiting}
        />
      )}
    </g>
  );

  return (
    <g
      className={`cx-annot-mark ${ordinal}${exiting ? ' cx-annot-out' : ''}`}
      style={{ '--cx-annot-delay': `${entryIndex * STAGGER_MS}ms` } as CSSProperties}
    >
      {instruction.type === 'highlight' &&
        (instruction.style?.weight === 'thin' ? <Underline rect={rect} /> : <Box rect={rect} />)}
      {instruction.type === 'circle' && <Circle rect={rect} />}
      {instruction.type === 'arrow' && <Arrow rect={rect} />}
      {instruction.type === 'step-indicator' && <StepBadge cx={rect.x} cy={rect.y} step={step} />}
      {meta}
    </g>
  );
}

// Box -- group a region (the DEFAULT mark): rounded rect, rx 10, 2px
// stroke, ~8% tint shape-fill behind it, drawn BOX_INSET px outside the
// target's own bounding box. Stroke and fill are separate elements so the
// M1 draw-on can sequence them (stroke draws, fill fades in from ~55%).
function Box({ rect }: { rect: DrawRect }) {
  const x = rect.x - BOX_INSET;
  const y = rect.y - BOX_INSET;
  const w = rect.w + BOX_INSET * 2;
  const h = rect.h + BOX_INSET * 2;
  return (
    <>
      <rect className="cx-annot-shape-fill" x={x} y={y} width={w} height={h} rx={10} />
      <rect className="cx-annot-shape-stroke" x={x} y={y} width={w} height={h} rx={10} pathLength={1} />
    </>
  );
}

// Circle -- pin one term: ellipse, ~10px horizontal / ~6px vertical padding
// beyond the target.
function Circle({ rect }: { rect: DrawRect }) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const rx = rect.w / 2 + CIRCLE_PAD_X;
  const ry = rect.h / 2 + CIRCLE_PAD_Y;
  return (
    <>
      <ellipse className="cx-annot-shape-fill" cx={cx} cy={cy} rx={rx} ry={ry} />
      <ellipse className="cx-annot-shape-stroke" cx={cx} cy={cy} rx={rx} ry={ry} pathLength={1} />
    </>
  );
}

// Underline -- inline phrase (the `weight: 'thin'` style hint): a rounded-cap
// pen stroke just below the text plus a soft tint block over the phrase
// itself. Redrawn 2026-07-16 (Darcy's ask): the bar is no longer a straight
// filled rect -- it overshoots the phrase by a few px on each side and bows
// gently downward with slightly uneven ends, like a real underline swept by
// hand, and it draws on with the same dash trick as every other stroke.
function Underline({ rect }: { rect: DrawRect }) {
  const startX = rect.x - 7;
  const endX = rect.x + rect.w + 7;
  const midX = (startX + endX) / 2;
  const y = rect.y + rect.h + 2.5;
  return (
    <>
      <rect
        className="cx-annot-underline-tint"
        x={rect.x - 3}
        y={rect.y - 2}
        width={rect.w + 6}
        height={rect.h + 4}
        rx={4.5}
      />
      <path
        className="cx-annot-underline-bar"
        d={`M ${startX},${y + 0.5} Q ${midX},${y + 3.5} ${endX},${y - 0.5}`}
        pathLength={1}
      />
    </>
  );
}

// Arrow -- connect two ideas: a naturally curved cubic path, 2px round
// caps, a small open two-segment head at the tip and a 3px dot at the
// origin. Points at the target's top-center from an offset above-right --
// there is no "source" point in the schema (an annotation names only what
// to point AT), so the origin is a fixed offset rather than anything
// derived from page content. Redrawn 2026-07-16 (Darcy's ask): the sweep is
// LONGER and bows through a cubic (leaves the origin drifting down-left,
// arrives at the tip vertically -- the last control point sits directly
// above the tip, which is also what lets the head hardcode a downward
// arrival) instead of the old short quarter-turn that read as two straight
// legs.
function Arrow({ rect }: { rect: DrawRect }) {
  const tipX = rect.x + rect.w / 2;
  const tipY = rect.y - 6;
  const originX = tipX + Math.min(88, rect.w / 2 + 62);
  const originY = tipY - 60;
  return (
    <>
      <circle className="cx-annot-dot" cx={originX} cy={originY} r={3} />
      <path
        className="cx-annot-shape-stroke"
        d={`M ${originX},${originY} C ${originX - 34},${originY + 12} ${tipX},${tipY - 38} ${tipX},${tipY}`}
        pathLength={1}
      />
      <path
        className="cx-annot-arrow-head"
        d={`M ${tipX - 5},${tipY - 7} L ${tipX},${tipY} L ${tipX + 5},${tipY - 7}`}
      />
    </>
  );
}

// Step badge -- numbered walkthroughs: a 22px circle, tint bg, 1.5px
// ordinal stroke, deep-text number -- intentionally the twin of the
// pre-session plan's timeline circles (and no longer the old white-on-solid
// disc). Renders both as the whole mark ('step-indicator') and as the
// corner badge any other mark with `step` set carries.
function StepBadge({ cx, cy, step }: { cx: number; cy: number; step: number | undefined }) {
  return (
    <g>
      <circle className="cx-annot-badge-bg" cx={cx} cy={cy} r={BADGE_RADIUS} />
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" className="cx-annot-badge-num">
        {step ?? ''}
      </text>
    </g>
  );
}

// The leader's rendered path (2026-07-16 ask): a single quadratic bowed
// perpendicular to the mark→pill line, so it reads as one naturally curved
// stroke from ANY approach angle -- the old mid-x cubic collapsed to a dead-
// straight segment whenever the pill sat directly above or below its mark.
// The bow scales with distance (capped) so short hops stay subtle and long
// leaders sweep visibly.
function leaderPathD(leader: { x1: number; y1: number; x2: number; y2: number }): string {
  const dx = leader.x1 - leader.x2;
  const dy = leader.y1 - leader.y2;
  const length = Math.hypot(dx, dy) || 1;
  const bow = Math.min(26, length * 0.22);
  const controlX = (leader.x1 + leader.x2) / 2 + (-dy / length) * bow;
  const controlY = (leader.y1 + leader.y2) / 2 + (dx / length) * bow;
  return `M ${leader.x2},${leader.y2} Q ${controlX},${controlY} ${leader.x1},${leader.y1}`;
}

// The leader from a displaced explanation back to its mark: it starts at the
// top/bottom edge midpoint of the target box (whichever side the pill sits
// on) and ends on the pill's facing edge. Recomputed live from the pill's
// CURRENT position -- so it tracks a user drag the same way it drew the
// collision pass's automatic displacement. Rendered through leaderPathD's
// bowed quadratic, same as the collision leader's look.
function computePillLeader(
  anchor: DrawRect,
  x: number,
  y: number,
  width: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const anchorCenterX = anchor.x + anchor.w / 2;
  const anchorCenterY = anchor.y + anchor.h / 2;
  const above = y + LABEL_HEIGHT / 2 <= anchorCenterY;
  return {
    // pill end: near the horizontal point on the facing edge, clamped so the
    // line meets the pill rather than empty space when dragged far sideways.
    x1: Math.max(x, Math.min(anchorCenterX, x + width)),
    y1: above ? y + LABEL_HEIGHT : y,
    // mark end: the top or bottom edge midpoint of the target box.
    x2: anchorCenterX,
    y2: above ? anchor.y : anchor.y + anchor.h,
  };
}

// Label pill (the WHAT -- required on every mark) + optional why-note card
// (the WHY). Pill: 26px tall, tint bg, 1px tint-border, deep 12px/600 text --
// dark-on-light per brand rule. Note: white card, ordinal dot, <=90-char
// teaching payload, rendered as wrapped HTML in a foreignObject (SVG text
// doesn't wrap).
//
// The explanation (pill + note) is the ONLY draggable annotation part: a
// reader who finds it covering the text or figure it points at can pull it
// aside, and the moment it leaves its anchor a leader line is drawn so the
// link to the mark is never lost (the same wayfinding the collision pass
// uses when it has to move a label itself). The shapes -- frame, underline,
// circle, arrow, badge -- stay inert (pointer-events: none on the layer),
// so a drag can only ever move the words, never the mark on the work.
//
// Drag is pointer-capture based (matching Overlay.tsx's panel drag): deltas
// are 1:1 with SVG user units because the layer is sized to exactly
// 100vw/100vh (1 unit == 1 css px), so clientX/Y deltas drop straight into
// the offset. The leader draws FIRST (outside the interactive group, so it
// stays inert) and the pill paints on top of its near end.
function LabelPill({
  text,
  note,
  placement,
  anchorRect,
  dragKey,
  dragOffset,
  onDrag,
  exiting,
}: {
  text: string;
  note: string | undefined;
  placement: LabelPlacement;
  anchorRect: DrawRect;
  dragKey: string;
  dragOffset: { dx: number; dy: number } | undefined;
  onDrag: (key: string, offset: { dx: number; dy: number } | undefined) => void;
  exiting: boolean;
}) {
  const width = estimateLabelWidth(text);
  const dx = dragOffset?.dx ?? 0;
  const dy = dragOffset?.dy ?? 0;
  const x = placement.x + dx;
  const y = placement.y + dy;

  const dragState = useRef<{ startX: number; startY: number; baseDx: number; baseDy: number } | null>(null);
  const [grabbing, setGrabbing] = useState(false);

  const handlePointerDown = (event: ReactPointerEvent) => {
    if (exiting) return; // don't grab a mark that's already fading out
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragState.current = { startX: event.clientX, startY: event.clientY, baseDx: dx, baseDy: dy };
    setGrabbing(true);
  };
  const handlePointerMove = (event: ReactPointerEvent) => {
    const state = dragState.current;
    if (!state) return;
    onDrag(dragKey, {
      dx: state.baseDx + (event.clientX - state.startX),
      dy: state.baseDy + (event.clientY - state.startY),
    });
  };
  const endDrag = (event: ReactPointerEvent) => {
    if (!dragState.current) return;
    dragState.current = null;
    setGrabbing(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  // A leader is drawn whenever the explanation sits away from its anchor --
  // either the collision pass moved it (placement.leader) or the user dragged
  // it. Computed from the pill's live position so it tracks the drag.
  const displaced = dx !== 0 || dy !== 0 || Boolean(placement.leader);
  const leader = displaced ? computePillLeader(anchorRect, x, y, width) : undefined;

  return (
    <>
      {leader && (
        <g className="cx-annot-leader-group">
          <path className="cx-annot-leader" d={leaderPathD(leader)} />
          <circle className="cx-annot-leader-dot" cx={leader.x2} cy={leader.y2} r={3} />
        </g>
      )}
      <g
        className={`cx-annot-explanation${grabbing ? ' cx-annot-grabbing' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <rect className="cx-annot-pill-bg" x={x} y={y} width={width} height={LABEL_HEIGHT} rx={LABEL_HEIGHT / 2} />
        <text
          x={x + width / 2}
          y={y + LABEL_HEIGHT / 2}
          textAnchor="middle"
          dominantBaseline="central"
          className="cx-annot-pill-text"
        >
          {text}
        </text>
        {note && (
          <foreignObject x={x} y={y + LABEL_HEIGHT + NOTE_GAP} width={NOTE_WIDTH} height={estimateNoteHeight(note)}>
            <div className="cx-annot-note">
              <span className="cx-annot-note-dot" />
              <span>{note}</span>
            </div>
          </foreignObject>
        )}
      </g>
    </>
  );
}
