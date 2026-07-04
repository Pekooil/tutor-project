import { useEffect, useState } from 'react';

// The annotation layer (Sprint 12 Task 6, ADR-022) -- the ONLY thing this
// file does is turn already-resolved draw instructions into SVG shapes.
// Presentational, like Overlay.tsx: no chrome.*, no host-DOM read, and
// deliberately no import from content/annotations.ts (the resolver) even
// for types -- the shapes below are a by-convention re-declaration of
// DrawInstruction/AnnotationsEventDetail, the same pattern messages.ts uses
// for PageEquation/Annotation. Keeping the boundary import-free means this
// component can never accidentally reach for a host-DOM read.
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
const ALLOWED_COLORS = ['amber', 'blue', 'green', 'red'] as const;
type AllowedColor = (typeof ALLOWED_COLORS)[number];
const DEFAULT_COLOR: AllowedColor = 'amber';

function resolveColor(color: string | undefined): AllowedColor {
  return (ALLOWED_COLORS as readonly string[]).includes(color ?? '')
    ? (color as AllowedColor)
    : DEFAULT_COLOR;
}

export function AnnotationLayer() {
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
        <AnnotationShape key={instruction.id} instruction={instruction} />
      ))}
    </svg>
  );
}

function AnnotationShape({ instruction }: { instruction: DrawInstruction }) {
  const color = resolveColor(instruction.style?.color);
  const colorClass = `cx-annot-${color}`;
  const { rect, label } = instruction;

  switch (instruction.type) {
    case 'highlight':
      return (
        <g className="cx-annot-in">
          <Highlight rect={rect} thin={instruction.style?.weight === 'thin'} colorClass={colorClass} />
          {label && <LabelPill text={label} rect={rect} colorClass={colorClass} />}
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
          {label && <LabelPill text={label} rect={rect} colorClass={colorClass} />}
        </g>
      );
    case 'arrow':
      return (
        <g className="cx-annot-in">
          <Arrow rect={rect} colorClass={colorClass} color={color} />
          {label && <LabelPill text={label} rect={rect} colorClass={colorClass} />}
        </g>
      );
    case 'label':
      return (
        <g className="cx-annot-in">
          <LabelPill text={label ?? ''} rect={rect} colorClass={colorClass} />
        </g>
      );
    case 'step-indicator':
      return (
        <g className="cx-annot-in">
          <StepBadge rect={rect} step={instruction.step} colorClass={colorClass} />
          {label && <LabelPill text={label} rect={rect} colorClass={colorClass} offsetForBadge />}
        </g>
      );
    default:
      return null;
  }
}

// A translucent rounded rect covering the target. `weight: 'thin'` (the
// §2.5 style hint) reads as an underline instead: a slim bar hugging the
// bottom edge rather than a fill over the whole rect -- what the sprint plan
// calls "thin weight reads as underline".
function Highlight({ rect, thin, colorClass }: { rect: DrawRect; thin: boolean; colorClass: string }) {
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
      className={`cx-annot-fill ${colorClass}`}
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

// A small pill adjacent to the rect, auto-flipped to stay in-viewport: above
// by default, below when there isn't room above; clamped horizontally so it
// never runs off either edge. Width is estimated from character count --
// SVG text has no layout pass to measure against before paint, and a rough
// monospace-ish estimate is generous enough for the short labels the prompt
// guidance caps at 5 words.
function LabelPill({
  text,
  rect,
  colorClass,
  offsetForBadge,
}: {
  text: string;
  rect: DrawRect;
  colorClass: string;
  offsetForBadge?: boolean;
}) {
  const height = 22;
  const paddingX = 8;
  const width = Math.max(28, Math.round(text.length * 6.5) + paddingX * 2);
  const anchorX = offsetForBadge ? rect.x + 14 : rect.x;

  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0;

  const fitsAbove = rect.y - height - 6 >= 0;
  const y = fitsAbove ? rect.y - height - 6 : Math.min(rect.y + rect.h + 6, viewportHeight - height);
  const x = Math.max(4, Math.min(anchorX, viewportWidth - width - 4));

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={height / 2} className={`cx-annot-fill-solid ${colorClass}`} />
      <text
        x={x + width / 2}
        y={y + height / 2}
        textAnchor="middle"
        dominantBaseline="central"
        className="cx-annot-badge-text"
      >
        {text}
      </text>
    </g>
  );
}
