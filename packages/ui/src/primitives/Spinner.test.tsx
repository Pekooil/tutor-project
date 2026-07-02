import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Spinner } from './Spinner';

describe('Spinner', () => {
  it('gates its spin on motion-safe:, so prefers-reduced-motion leaves it static rather than needing a separate code path', () => {
    const { container } = render(<Spinner />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('motion-safe:animate-spin');
  });

  it('is aria-hidden on the svg but announces the label via a role="status" live region', () => {
    render(<Spinner label="Loading tutor…" />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Loading tutor…');
    expect(status.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('defaults to a sensible label when none is given', () => {
    render(<Spinner />);
    expect(screen.getByRole('status').textContent).toBe('Loading…');
  });

  it('sizes sm/md distinctly', () => {
    const { container, rerender } = render(<Spinner size="sm" />);
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('16');

    rerender(<Spinner size="md" />);
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('24');
  });
});
