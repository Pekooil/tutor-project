import type { StatusPinKind } from '../types/messages';

// The status-pin icon set (Sprint 15, ADR-034; the design-08 redesign
// retired this file's TitlePin dynamic-island component -- the header no
// longer swaps its identity for a signal; the ping toast (PingToast.tsx)
// and the transcript's milestone markers (Transcript.tsx) render these
// icons instead, tinted by the ping TONES in pings.ts rather than the old
// category color map).
//
// Icons are inline SVGs -- never emoji (brand rule), never an icon library
// (nothing else in the overlay ships one). All 19 share one visual language:
// 14x14 viewBox, 1.5px round-capped strokes, currentColor -- so whatever
// tone class the wrapper carries tints icon and label together.

// One glyph per kind. Deliberately simple geometry -- these render at 14px
// inside the header, so a glyph earns its place by silhouette, not detail;
// the label carries the meaning.
const PIN_ICON_PATHS: Record<StatusPinKind, React.ReactNode> = {
  // Target: the profile called this exact failure mode.
  'prediction-confirmed': (
    <>
      <circle cx="7" cy="7" r="5.2" />
      <circle cx="7" cy="7" r="2.2" />
      <circle cx="7" cy="7" r="0.5" fill="currentColor" stroke="none" />
    </>
  ),
  // Magnifier over a small mark: a newly spotted misconception.
  'misconception-detected': (
    <>
      <circle cx="6" cy="6" r="4" />
      <path d="M9 9l3.2 3.2" />
      <path d="M6 4.3v2.4M6 8.1v.05" />
    </>
  ),
  // Two repeating peaks: a recurring pattern noticed.
  'pattern-detected': (
    <>
      <path d="M1.5 9.5c1-3.4 2.1-3.4 3.1 0" />
      <path d="M6.9 9.5c1-3.4 2.1-3.4 3.1 0" />
      <circle cx="12" cy="4.4" r="1.2" />
    </>
  ),
  // A repeating wave that goes flat: the pattern stopped repeating.
  'pattern-broken': (
    <>
      <path d="M1.3 8.7c.9-2.4 1.9-2.4 2.8 0" />
      <path d="M4.8 8.7c.9-2.4 1.9-2.4 2.8 0" />
      <path d="M9.3 7.2h3.4" />
    </>
  ),
  // Three streak dots, the last still hollow.
  'streak-progress': (
    <>
      <circle cx="2.6" cy="7" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="7" cy="7" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="11.4" cy="7" r="1.4" />
    </>
  ),
  // Check in circle.
  'concept-understood': (
    <>
      <circle cx="7" cy="7" r="5.5" />
      <path d="M4.4 7.2l1.8 1.8 3.4-4" />
    </>
  ),
  // Rising staircase.
  progress: <path d="M1.8 11.7h3.4V8.2h3.4V4.7h3.6" />,
  // Flag planted.
  'final-step': (
    <>
      <path d="M3.8 12.5V1.8" />
      <path d="M3.8 2.5h6.6L8.6 4.9l1.8 2.4H3.8" />
    </>
  ),
  // Picture frame with a horizon.
  'teaching-visual': (
    <>
      <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" />
      <circle cx="4.8" cy="5.7" r="1" />
      <path d="M3.3 11l2.9-3.4 1.9 1.9 1.9-2.3 2 3.8" />
    </>
  ),
  // Shrinking bars: one big thing becoming small steps.
  'teaching-decompose': (
    <>
      <path d="M2 4.2h10" />
      <path d="M3.7 7h6.6" />
      <path d="M5.2 9.8h3.6" />
    </>
  ),
  // Double chevron.
  'pace-up': (
    <>
      <path d="M2.8 3.5L6.3 7l-3.5 3.5" />
      <path d="M7.7 3.5L11.2 7l-3.5 3.5" />
    </>
  ),
  // Lightbulb on.
  'guidance-up': (
    <>
      <path d="M7 1.6a3.7 3.7 0 00-2.1 6.7c.5.4.9 1 .9 1.6h2.4c0-.6.4-1.2.9-1.6A3.7 3.7 0 007 1.6z" />
      <path d="M5.6 12.2h2.8" />
    </>
  ),
  // Lightbulb off (the same bulb, struck through).
  'guidance-down': (
    <>
      <path d="M7 1.6a3.7 3.7 0 00-2.1 6.7c.5.4.9 1 .9 1.6h2.4c0-.6.4-1.2.9-1.6A3.7 3.7 0 007 1.6z" />
      <path d="M5.6 12.2h2.8" />
      <path d="M2.2 2.2l9.6 9.6" />
    </>
  ),
  // Arrow up-right.
  'difficulty-up': (
    <>
      <path d="M2.8 11.2L11 3" />
      <path d="M5.6 3H11v5.4" />
    </>
  ),
  // Arrow down-right.
  'difficulty-down': (
    <>
      <path d="M2.8 2.8L11 11" />
      <path d="M11 5.6V11H5.6" />
    </>
  ),
  // History: a clock winding back.
  callback: (
    <>
      <path d="M2.3 7a4.7 4.7 0 104.7-4.7c-1.8 0-3.4.9-4.2 2.4" />
      <path d="M2.3 2.2v2.6h2.6" />
      <path d="M7 4.8V7l1.7 1.2" />
    </>
  ),
  // Calendar.
  'due-review': (
    <>
      <rect x="2" y="3" width="10" height="9" rx="1.5" />
      <path d="M2 6.2h10" />
      <path d="M4.8 1.5v2.4M9.2 1.5v2.4" />
    </>
  ),
  // Chart climbing.
  'confidence-up': (
    <>
      <path d="M1.7 12.3h10.6" />
      <path d="M2.6 9.8l2.9-2.9 1.9 1.5 3.8-4.3" />
      <path d="M8.6 3.8h2.9v2.9" />
    </>
  ),
  // A spark: they caught it themselves.
  'self-caught': (
    <path d="M7 1.6l1.3 4.1 4.1 1.3-4.1 1.3L7 12.4 5.7 8.3 1.6 7l4.1-1.3z" strokeLinejoin="round" />
  ),
};

// `size` lets the transcript's milestone markers render the same icon a
// step smaller (12px against their 11px labels) without a second icon set;
// the viewBox stays 14x14 so the geometry is identical at every size.
export function PinIcon({ kind, size = 14 }: { kind: StatusPinKind; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      className="flex-none"
    >
      {PIN_ICON_PATHS[kind]}
    </svg>
  );
}
