import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { extractTextInRect, type ViewportRect } from '../content/pageExtractor';

// The reframe tool (design state 5b, NEW feature): when the check-in's
// prediction is off, the student frames the EXACT part of the page they're
// stuck on -- a crop rectangle over the host page plus their own words --
// and that becomes the session-start turn (session-flow.ts's
// buildReframeStartMessage, via Overlay.tsx). The lit window through the
// scrim is the crop box's own box-shadow (Overlay.css's .cx-crop-box, the
// board's exact technique).
//
// Boundary discipline: everything here renders inside the shadow root; the
// host page is READ only, and only at the moment Start session is clicked
// (extractTextInRect -- pageExtractor.ts's read-only rules, overlay subtree
// excluded). Unlike the annotation layer this layer DOES capture pointer
// events -- framing the problem is a deliberate modal moment; Esc and
// ← Back both leave it with the page untouched.
//
// Coordinates are viewport px throughout (the layer is fixed-positioned),
// the same getBoundingClientRect space extractTextInRect intersects
// against -- no offset math, the AnnotationLayer's own discipline.

const MIN_CROP_W = 60;
const MIN_CROP_H = 36;

type Corner = 'nw' | 'ne' | 'sw' | 'se';

type DragState =
  | { kind: 'move'; pointerX: number; pointerY: number; origin: ViewportRect }
  | { kind: 'draw'; anchorX: number; anchorY: number }
  | { kind: 'resize'; corner: Corner; origin: ViewportRect };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function defaultRect(): ViewportRect {
  const w = Math.min(340, Math.max(MIN_CROP_W, window.innerWidth - 80));
  const h = 150;
  return {
    x: Math.round((window.innerWidth - w) / 2),
    y: Math.round(clamp(window.innerHeight * 0.22, 70, Math.max(70, window.innerHeight - h - 220))),
    w,
    h,
  };
}

// Pure rect math for each drag kind -- kept out of the event handlers so
// the clamping story is readable in one place. Draw and resize both
// normalize through the same corner-pair form, so dragging a corner past
// its opposite edge flips cleanly instead of producing a negative size.
function rectFromCorners(x1: number, y1: number, x2: number, y2: number): ViewportRect {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
}

function applyDrag(drag: DragState, pointerX: number, pointerY: number): ViewportRect {
  const px = clamp(pointerX, 0, window.innerWidth);
  const py = clamp(pointerY, 0, window.innerHeight);
  if (drag.kind === 'move') {
    const { origin } = drag;
    return {
      ...origin,
      x: clamp(origin.x + (px - drag.pointerX), 0, Math.max(0, window.innerWidth - origin.w)),
      y: clamp(origin.y + (py - drag.pointerY), 0, Math.max(0, window.innerHeight - origin.h)),
    };
  }
  if (drag.kind === 'draw') {
    return rectFromCorners(drag.anchorX, drag.anchorY, px, py);
  }
  // resize: the dragged corner follows the pointer; the OPPOSITE corner is
  // the fixed anchor.
  const { origin, corner } = drag;
  const anchorX = corner === 'nw' || corner === 'sw' ? origin.x + origin.w : origin.x;
  const anchorY = corner === 'nw' || corner === 'ne' ? origin.y + origin.h : origin.y;
  return rectFromCorners(anchorX, anchorY, px, py);
}

// A released rect below the minimum (including a stray click that drew a
// 0-size box) snaps back to a usable size around its own center.
function enforceMinSize(rect: ViewportRect): ViewportRect {
  if (rect.w >= MIN_CROP_W && rect.h >= MIN_CROP_H) return rect;
  const w = Math.max(rect.w, MIN_CROP_W);
  const h = Math.max(rect.h, MIN_CROP_H);
  return {
    x: clamp(rect.x + rect.w / 2 - w / 2, 0, Math.max(0, window.innerWidth - w)),
    y: clamp(rect.y + rect.h / 2 - h / 2, 0, Math.max(0, window.innerHeight - h)),
    w,
    h,
  };
}

const CORNERS: { corner: Corner; className: string }[] = [
  { corner: 'nw', className: '-left-[5px] -top-[5px] cursor-nwse-resize' },
  { corner: 'ne', className: '-right-[5px] -top-[5px] cursor-nesw-resize' },
  { corner: 'sw', className: '-left-[5px] -bottom-[5px] cursor-nesw-resize' },
  { corner: 'se', className: '-right-[5px] -bottom-[5px] cursor-nwse-resize' },
];

export function ReframeTool({
  disabled,
  onCancel,
  onStart,
}: {
  disabled: boolean;
  // ← Back / Esc: return to the check-in, nothing sent.
  onCancel: () => void;
  // Start session: the crop's read-only text snippet plus the student's own
  // words -- Overlay.tsx builds the actual student turn from these.
  onStart: (framing: { snippet: string; struggle: string }) => void;
}) {
  const [rect, setRect] = useState<ViewportRect>(() => defaultRect());
  const [struggle, setStruggle] = useState('');
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  function beginDrag(event: PointerEvent<HTMLElement>, drag: DragState) {
    dragRef.current = drag;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  function handleLayerPointerDown(event: PointerEvent<HTMLDivElement>) {
    // Pointer downs on the compose card / pill / box are handled (and
    // stopped) by their own elements -- reaching here means the scrim:
    // start drawing a fresh frame.
    beginDrag(event, { kind: 'draw', anchorX: event.clientX, anchorY: event.clientY });
  }

  function handlePointerMove(event: PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    setRect(applyDrag(drag, event.clientX, event.clientY));
  }

  function handlePointerUp(event: PointerEvent<HTMLElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    setRect((current) => enforceMinSize(current));
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleStart() {
    const trimmed = struggle.trim();
    if (!trimmed || disabled) return;
    // The one host-page read this tool ever performs, at the moment of
    // commitment -- never while dragging.
    onStart({ snippet: extractTextInRect(rect), struggle: trimmed });
  }

  return (
    <div
      className={`fixed inset-0 z-[2147483647] font-sans text-base text-foreground${dragging ? ' cursor-crosshair select-none' : ''}`}
      onPointerDown={handleLayerPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* The crop frame -- its box-shadow paints the scrim (Overlay.css). */}
      <div
        role="application"
        aria-label="Crop frame — drag to frame the part you're stuck on"
        className="cx-crop-box absolute cursor-move rounded border-2 border-accent"
        style={
          {
            left: `${rect.x}px`,
            top: `${rect.y}px`,
            width: `${rect.w}px`,
            height: `${rect.h}px`,
          } as CSSProperties
        }
        onPointerDown={(event) =>
          beginDrag(event, { kind: 'move', pointerX: event.clientX, pointerY: event.clientY, origin: rect })
        }
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {CORNERS.map(({ corner, className }) => (
          <span
            key={corner}
            className={`cx-crop-handle absolute h-[9px] w-[9px] ${className}`}
            onPointerDown={(event) => beginDrag(event, { kind: 'resize', corner, origin: rect })}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
        ))}
        <span className="absolute -top-[27px] left-0 whitespace-nowrap rounded-md border border-accent bg-[var(--calyxa-sage-wash)] px-2 py-0.5 text-[10.5px] font-semibold text-accent-foreground">
          Selected · {Math.round(rect.w)} × {Math.round(rect.h)}
        </span>
      </div>

      {/* Instruction pill, top-center. */}
      <div
        className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-accent/70 bg-background/90 px-[15px] py-2 text-[12.5px] font-medium text-accent-foreground shadow-[0_6px_18px_rgba(15,23,42,0.14)] backdrop-blur-[10px]"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="h-3.5 w-3.5 text-accent-emphasis"
        >
          <path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" strokeLinecap="round" />
        </svg>
        Drag to frame the part you&rsquo;re stuck on
      </div>

      {/* Bottom compose card. */}
      <div
        className="absolute bottom-[22px] left-1/2 w-[436px] -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-background/90 shadow-[0_10px_30px_rgba(15,23,42,0.2)] backdrop-blur-[18px] backdrop-saturate-[1.5]"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col gap-3 px-[17px] pb-4 pt-[15px]">
          <div className="flex items-center gap-2.5">
            <span className="flex h-[34px] w-[52px] flex-none items-center justify-center rounded-[7px] border-[1.5px] border-accent bg-gradient-to-br from-accent-subtle to-[var(--calyxa-sage-wash)]">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-[15px] w-[15px] text-accent-emphasis"
              >
                <rect x="4" y="6" width="16" height="12" rx="2" />
                <path d="M4 13l4-3 4 3 3-2 5 4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="flex flex-col gap-px">
              <span className="text-[13.5px] font-semibold text-foreground">Snippet attached</span>
              <span className="text-[11.5px] text-muted-foreground">Cropped from this page</span>
            </span>
          </div>
          <label className="flex flex-col gap-[7px]">
            <span className="text-[12.5px] font-semibold text-[#46463f]">What part are you struggling on?</span>
            <textarea
              value={struggle}
              onChange={(event) => setStruggle(event.target.value)}
              rows={2}
              placeholder="e.g. Not sure whether to factor or use the formula here"
              className="min-h-11 w-full resize-none rounded-[11px] border-[1.5px] border-accent bg-background px-[13px] py-[11px] font-sans text-[13.5px] leading-normal text-foreground outline-none placeholder:text-[#9b988f] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            />
          </label>
          <div className="mt-px flex gap-[9px]">
            <button
              type="button"
              onClick={onCancel}
              disabled={disabled}
              className="h-[42px] flex-none cursor-pointer rounded-full border border-border bg-background px-4 text-[14px] font-semibold text-[#46463f] outline-none hover:border-accent hover:bg-accent-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={handleStart}
              disabled={disabled || !struggle.trim()}
              className="h-[42px] flex-1 cursor-pointer rounded-full border-0 bg-accent text-[14px] font-semibold text-accent-foreground outline-none hover:bg-[var(--calyxa-accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              Start session
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
