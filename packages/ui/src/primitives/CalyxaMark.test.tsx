import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { CalyxaMark } from './CalyxaMark';

describe('CalyxaMark', () => {
  it('renders as inline SVG and is aria-hidden — decorative, always paired with adjacent visible "Calyxa" text per the cross-surface header rule', () => {
    const { container } = render(<CalyxaMark className="h-5 w-5" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 64 64');
    expect(svg?.getAttribute('class')).toBe('h-5 w-5');
  });

  it('gives each mounted instance a unique gradient id, so multiple marks in one shadow root never collide', () => {
    const { container } = render(
      <>
        <CalyxaMark />
        <CalyxaMark />
      </>,
    );
    const ids = Array.from(container.querySelectorAll('linearGradient')).map((el) => el.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
