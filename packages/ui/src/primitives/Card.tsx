import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';
import { cn } from '../lib/cn';

export type CardProps = HTMLAttributes<HTMLDivElement>;

// border + shadow together, per brand.md S4.2: --color-border alone is
// decorative-only (1.28:1) and is never the sole boundary cue.
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn('rounded-md border border-border bg-surface shadow-panel', className)}
      {...props}
    />
  );
});
