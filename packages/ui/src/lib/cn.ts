import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Every primitive in this package merges its own default classes with a
// caller-supplied `className`. Plain string concatenation (the previous
// approach everywhere here) means two classes targeting the SAME CSS
// property — e.g. a primitive's own `bg-transparent` and a caller's
// `bg-danger` — don't "last one wins" by position in the className string;
// Tailwind emits each utility once, in its own internal order, so whichever
// rule lands later IN THE COMPILED STYLESHEET wins regardless of source
// order. That silently dropped real overrides (a button told to render with
// a colored background stayed transparent). tailwind-merge resolves same-
// property conflicts correctly, keeping the rightmost (caller's) class.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
