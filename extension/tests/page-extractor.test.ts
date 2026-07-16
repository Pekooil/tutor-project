// @vitest-environment jsdom
//
// The image-alt / accessible-label equation adapter (the 2026-07-16 detection
// fix's client half): an image-rendered problem has zero DOM text, so before
// this adapter the whole capture came back empty, the plausible-problem gate
// failed, and the opening scan never fired. These specs pin (a) the
// math-likeness gate that keeps page chrome out of the capture, and (b) that
// a page whose ONLY math is an <img alt> / role="img" label now produces a
// non-empty PageContext that passes isPlausibleProblem.
import { afterEach, describe, expect, it } from 'vitest';
import { extractPageContext, looksLikeMathText } from '../src/content/pageExtractor';
import { isPlausibleProblem } from '../src/content/index';

afterEach(() => {
  document.body.innerHTML = '';
  document.title = '';
});

describe('looksLikeMathText', () => {
  it('accepts equations, operators, and problem language', () => {
    expect(looksLikeMathText('x^2 + 5x + 6 = 0')).toBe(true);
    expect(looksLikeMathText('3 + 4')).toBe(true);
    expect(looksLikeMathText('the square root of 2')).toBe(true);
    expect(looksLikeMathText('Solve for x')).toBe(true);
    expect(looksLikeMathText('graph of y over x')).toBe(true);
    expect(looksLikeMathText('√2 ≈ 1.414')).toBe(true);
  });

  it('rejects page chrome and short/plain strings', () => {
    expect(looksLikeMathText('Company logo')).toBe(false);
    expect(looksLikeMathText('Profile photo of Darcy')).toBe(false);
    expect(looksLikeMathText('a')).toBe(false);
    expect(looksLikeMathText('Next lesson')).toBe(false);
  });
});

describe('extractPageContext: image-rendered equations', () => {
  it('captures a math-y img alt as an equation and anchors the registry to the <img>', () => {
    document.body.innerHTML = `
      <main>
        <img id="eq" alt="x^2 - 4 = 0" src="problem.png">
        <img alt="Site logo" src="logo.png">
      </main>`;

    const { context, equationElements } = extractPageContext();

    expect(context.equations).toEqual([{ text: 'x^2 - 4 = 0' }]);
    expect(equationElements[0]).toBe(document.getElementById('eq'));
  });

  it('captures a role="img" aria-label but never a non-math one', () => {
    document.body.innerHTML = `
      <div role="img" aria-label="graph of y = 2x + 1"></div>
      <div role="img" aria-label="decorative divider"></div>`;

    const { context } = extractPageContext();

    expect(context.equations).toEqual([{ text: 'graph of y = 2x + 1' }]);
  });

  it('an image-only problem page now passes the opening-scan plausibility gate', () => {
    document.body.innerHTML = `<img alt="Solve: 2x + 3 = 11" src="q.png">`;

    const { context } = extractPageContext();

    // No visible text at all -- before the adapter this was an empty capture
    // (equations: [], no text), which failed the gate and silently skipped
    // the scan.
    expect(context.equations.length).toBeGreaterThan(0);
    expect(isPlausibleProblem(context)).toBe(true);
  });

  it('real math sources still outrank alt text under the shared cap', () => {
    const katex = `<span class="katex"><math><semantics><annotation encoding="application/x-tex">y = mx + b</annotation></semantics></math></span>`;
    document.body.innerHTML = `${katex}<img alt="1 + 1 = 2" src="a.png">`;

    const { context } = extractPageContext();

    expect(context.equations[0]).toEqual({ latex: 'y = mx + b' });
    expect(context.equations[1]).toEqual({ text: '1 + 1 = 2' });
  });
});
