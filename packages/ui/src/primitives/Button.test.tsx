import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from './Button';

describe('Button', () => {
  it('applies the primary variant token classes by default', () => {
    render(<Button>Send</Button>);
    const btn = screen.getByRole('button', { name: 'Send' });
    expect(btn.className).toContain('bg-accent');
    expect(btn.className).toContain('text-accent-foreground');
  });

  it('applies each variant’s token classes', () => {
    const { rerender } = render(<Button variant="secondary">Go</Button>);
    expect(screen.getByRole('button').className).toContain('border-border-strong');

    rerender(<Button variant="ghost">Go</Button>);
    expect(screen.getByRole('button').className).toContain('hover:bg-surface');

    rerender(<Button variant="icon">Go</Button>);
    expect(screen.getByRole('button').className).toContain('rounded-md');
  });

  it('applies size classes independently of variant', () => {
    render(<Button size="sm">Go</Button>);
    expect(screen.getByRole('button').className).toContain('h-8');
  });

  it('disables, sets aria-busy, and shows the shared Spinner while loading', () => {
    render(<Button loading>Send</Button>);
    const btn = screen.getByRole('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    // Spinner renders role="status".
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('the disabled prop disables independently of loading', () => {
    render(<Button disabled>Send</Button>);
    const btn = screen.getByRole('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBeNull();
  });

  it('always carries the focus-visible outline treatment, not a background-dependent ring', () => {
    render(<Button>Send</Button>);
    // Outline (not box-shadow ring), so the same class works on the
    // overlay's translucent panel and /web's white surfaces alike.
    expect(screen.getByRole('button').className).toContain('focus-visible:outline-focus-ring');
  });

  it('defaults to type="button" so it never accidentally submits a form', () => {
    render(<Button>Send</Button>);
    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
  });

  it('respects an explicit type override', () => {
    render(<Button type="submit">Send</Button>);
    expect(screen.getByRole('button').getAttribute('type')).toBe('submit');
  });
});
