import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'icon';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Disables the button, marks aria-busy, and shows the shared Spinner. */
  loading?: boolean;
  /** Toggle state for the icon variant (e.g. the overlay's recording mic). */
  pressed?: boolean;
}

const baseClass =
  'inline-flex items-center justify-center gap-2 rounded-sm font-medium ' +
  'transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50';

// Outline (not box-shadow ring) so the focus indicator never depends on
// knowing the background behind it — same class works on the overlay panel
// and on /web's white surfaces.
const variantClass: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-foreground hover:opacity-90 active:opacity-100',
  secondary: 'border border-border-strong bg-transparent text-foreground hover:bg-surface',
  ghost: 'bg-transparent text-foreground hover:bg-surface',
  icon: 'rounded-md bg-transparent text-foreground hover:bg-surface aria-pressed:bg-accent aria-pressed:text-accent-foreground',
};

const sizeClass: Record<ButtonVariant, Record<ButtonSize, string>> = {
  primary: { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-base' },
  secondary: { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-base' },
  ghost: { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-base' },
  icon: { sm: 'h-8 w-8', md: 'h-10 w-10' },
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    pressed,
    disabled,
    className,
    children,
    style,
    type,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      aria-pressed={pressed}
      disabled={disabled || loading}
      className={[baseClass, variantClass[variant], sizeClass[variant][size], className]
        .filter(Boolean)
        .join(' ')}
      style={{
        transitionDuration: 'var(--motion-duration-fast)',
        transitionTimingFunction: 'var(--motion-ease-out)',
        ...style,
      }}
      {...props}
      aria-busy={loading || undefined}
      type={type ?? 'button'}
    >
      {loading ? <Spinner size={size === 'sm' ? 'sm' : 'md'} label="Loading…" /> : null}
      {children}
    </button>
  );
});
