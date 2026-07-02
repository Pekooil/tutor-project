import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VisuallyHidden } from './VisuallyHidden';

describe('VisuallyHidden', () => {
  it('applies the sr-only utility — hidden visually, still in the DOM/accessibility tree', () => {
    render(<VisuallyHidden>Recording — click to stop and send</VisuallyHidden>);
    const el = screen.getByText('Recording — click to stop and send');
    expect(el.className).toContain('sr-only');
    // Queryable by text at all means it's real DOM content, not display:none
    // removed from the tree — jsdom doesn't compute the clip-path itself
    // (a known jsdom limitation), so this is the DOM-level guarantee the
    // rest of the a11y tree relies on.
    expect(el.tagName).toBe('SPAN');
  });

  it('renders as a span by default, composable inline with sibling content', () => {
    render(
      <p>
        <VisuallyHidden>hidden</VisuallyHidden>
        <span>visible</span>
      </p>,
    );
    expect(screen.getByText('hidden').tagName).toBe('SPAN');
    expect(screen.getByText('visible').tagName).toBe('SPAN');
  });
});
