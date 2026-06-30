import { cloneElement, useId } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface FieldProps {
  /** Wraps the label in `VisuallyHidden` if a visible label isn't wanted. */
  label: ReactNode;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  /** The control — a single input/textarea/select element. */
  children: ReactElement;
}

const controlClass =
  'h-10 rounded-sm border bg-background px-3 text-base text-foreground ' +
  'placeholder:text-muted-foreground outline-none focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50';

export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const reactId = useId();
  const existingId = (children.props as { id?: string }).id;
  const controlId = existingId ?? reactId;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  const control = cloneElement(children, {
    id: controlId,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
    'aria-required': required ? true : undefined,
    className: cn(
      controlClass,
      error ? 'border-danger' : 'border-border-strong',
      (children.props as { className?: string }).className,
    ),
  } as Record<string, unknown>);

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={controlId} className="text-sm font-medium text-foreground">
        {label}
        {required ? (
          <span aria-hidden="true" className="text-danger">
            {' '}
            *
          </span>
        ) : null}
      </label>
      {control}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
