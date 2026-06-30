import { useId } from 'react';
import type { SVGAttributes } from 'react';

export type CalyxaMarkProps = SVGAttributes<SVGSVGElement>;

// The calyx mark, redesigned Sprint 10 Task 6 round 3 (brand.md S2): a single
// leaf-curl stroke cradling a small leaf tip and bud dot, all painted with
// the locked "leaf" gradient (#7bedaa -> #3fd07a -> #1f9d5b). This is the
// brand's one sanctioned gradient use -- every other accent surface
// (buttons, badges, the breathing glow) stays flat-fill on the existing
// --color-accent* tokens; only this mark departs from flat fill, per
// brand.md S2's scoped exception.
//
// Unlike the old sepal mark, color is NOT controlled via currentColor/
// className -- the gradient IS the brand color, so it always renders the
// same regardless of caller. className/props only ever affect size
// (h-5 w-5, etc.) and placement. The gradient id is per-instance (useId) so
// multiple mounted marks (e.g. the idle pill + a panel header) never clash
// inside one SVG namespace.
export function CalyxaMark({ className, ...props }: CalyxaMarkProps) {
  const gradientId = `calyxa-mark-${useId()}`;
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className} {...props}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#7bedaa" />
          <stop offset="0.5" stopColor="#3fd07a" />
          <stop offset="1" stopColor="#1f9d5b" />
        </linearGradient>
      </defs>
      <path
        d="M52,37 C54,28 44,15 35,15 C24,15 15,25 15,35 C15,46 28,55 45,51"
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="6.5"
        strokeLinecap="round"
      />
      <path
        d="M0,-7 C4.5,-4 4.5,4 0,7.5 C-4.5,4 -4.5,-4 0,-7 Z"
        transform="translate(44,13) rotate(32)"
        fill={`url(#${gradientId})`}
      />
      <circle cx="40" cy="35" r="4" fill={`url(#${gradientId})`} />
    </svg>
  );
}
