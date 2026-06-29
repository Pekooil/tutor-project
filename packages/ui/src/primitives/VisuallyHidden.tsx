import type { HTMLAttributes, ReactNode } from 'react';

export interface VisuallyHiddenProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
}

// Tailwind's own `sr-only` utility (visually hidden, still in the a11y tree) —
// no new CSS, just the existing compiled sheet both render targets already load.
export function VisuallyHidden({ className, children, ...props }: VisuallyHiddenProps) {
  return (
    <span className={['sr-only', className].filter(Boolean).join(' ')} {...props}>
      {children}
    </span>
  );
}
