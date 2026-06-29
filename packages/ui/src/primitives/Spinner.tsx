import type { SVGAttributes } from 'react';
import { VisuallyHidden } from './VisuallyHidden';

export type SpinnerSize = 'sm' | 'md';

export interface SpinnerProps extends Omit<SVGAttributes<SVGSVGElement>, 'width' | 'height'> {
  size?: SpinnerSize;
  /** Announced to screen readers via the wrapping `role="status"` region. */
  label?: string;
}

const sizePx: Record<SpinnerSize, number> = { sm: 16, md: 24 };

// motion-safe:/motion-reduce: gate the spin on prefers-reduced-motion (brand.md
// S6: motion is never load-bearing for comprehension) — under reduced motion
// the ring just sits still; presence + the live-region label still carry the
// "busy" signal.
export function Spinner({ size = 'md', label = 'Loading…', className, ...props }: SpinnerProps) {
  const px = sizePx[size];
  return (
    <span role="status" className="inline-flex items-center">
      <svg
        width={px}
        height={px}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className={['motion-safe:animate-spin text-accent', className].filter(Boolean).join(' ')}
        {...props}
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <VisuallyHidden>{label}</VisuallyHidden>
    </span>
  );
}
