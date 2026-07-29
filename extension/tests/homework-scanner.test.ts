// @vitest-environment jsdom
//
// The v4 scan contract (spec §1). What these pin is the part that has to be
// right before anything else can be: the count, the labels as PRINTED, the
// graded read, and each of the four failure modes the spec enumerates.
import { afterEach, describe, expect, it } from 'vitest';
import { ABSURD_COUNT, parseLabel, readPageGrade, scanProblems } from '../src/content/problemScanner';

afterEach(() => {
  document.body.innerHTML = '';
});

function worksheet(rows: string[], options: { graded?: boolean } = {}): void {
  document.body.innerHTML = `
    <main>
      <h1>Factoring practice</h1>
      <ol>${rows.map((row) => `<li>${row}</li>`).join('')}</ol>
      ${options.graded ? '<button>Check answer</button>' : ''}
    </main>`;
}

describe('parseLabel — labels as printed', () => {
  it('reads the shapes worksheets actually use', () => {
    expect(parseLabel('5. x² + 7x + 12 = 0')).toBe('5');
    expect(parseLabel('5) x² − 9 = 0')).toBe('5');
    expect(parseLabel('3b. Solve for y')).toBe('3b');
    expect(parseLabel('Problem 12 — simplify')).toBe('12');
    expect(parseLabel('#7 factor completely')).toBe('7');
  });

  it('never mistakes a coefficient or a year for a label', () => {
    expect(parseLabel('x² + 5x + 6 = 0')).toBeNull();
    expect(parseLabel('2026 was the year')).toBeNull();
    // 0 is not a printed problem number.
    expect(parseLabel('0. nothing')).toBeNull();
  });
});

describe('scanProblems — enumeration', () => {
  it('counts every problem and keeps its printed label', () => {
    worksheet([
      '1. x² + 7x + 12 = 0',
      '2. x² − 5x + 6 = 0',
      '3. x² − 9 = 0',
      '4. 2x² − 8x = 0',
    ]);
    const result = scanProblems();
    expect(result.count).toBe(4);
    expect(result.problems.map((problem) => problem.label)).toEqual(['1', '2', '3', '4']);
    expect(result.confidence).toBe('high');
    // The scan NEVER names the topic -- that is a separate, racing call.
    expect(result.concept).toBeNull();
  });

  it('strips the label out of the snippet the tutor would be handed', () => {
    worksheet(['5. Solve x² − 10x + 25 = 0 by factoring']);
    worksheet(['5. Solve x² − 10x + 25 = 0 by factoring', '6. Solve x² + 2x − 15 = 0']);
    const [first] = scanProblems().problems;
    expect(first.snippet.startsWith('5.')).toBe(false);
    expect(first.snippet).toContain('x² − 10x + 25 = 0');
  });

  it('keeps a worksheet that starts at 7 numbered as printed', () => {
    worksheet(['7. x + 1 = 3', '8. x + 2 = 5', '9. x + 3 = 7']);
    expect(scanProblems().problems.map((problem) => problem.label)).toEqual(['7', '8', '9']);
  });

  it('falls back to labelled lines when there is no list structure', () => {
    document.body.innerHTML = `
      <main>
        <div>1. Solve 2x = 10</div>
        <div>2. Solve 3x = 12</div>
        <div>3. Solve 4x = 20</div>
      </main>`;
    expect(scanProblems().count).toBe(3);
  });
});

describe('scanProblems — the four failure modes (spec §1)', () => {
  it('0 problems found: reports zero rather than inventing a set', () => {
    document.body.innerHTML = '<main><p>Welcome back to your dashboard.</p></main>';
    const result = scanProblems();
    expect(result.count).toBe(0);
    // Low confidence is what makes the UI lead with the manual-count path.
    expect(result.confidence).toBe('low');
  });

  it('absurd count: flags low confidence past the threshold', () => {
    worksheet(Array.from({ length: ABSURD_COUNT + 5 }, (_, index) => `${index + 1}. x + ${index} = ${index + 2}`));
    const result = scanProblems();
    expect(result.count).toBeGreaterThan(ABSURD_COUNT);
    expect(result.confidence).toBe('low');
  });

  it('mostly unlabelled rows read as low confidence', () => {
    document.body.innerHTML = `
      <main><ol>
        <li>solve x + 1 = 2</li>
        <li>solve x + 2 = 3</li>
        <li>solve x + 3 = 4</li>
        <li>4. solve x + 4 = 5</li>
      </ol></main>`;
    expect(scanProblems().confidence).toBe('low');
  });
});

describe('graded detection — conservative by design', () => {
  it('defaults to false with no correctness affordance anywhere', () => {
    worksheet(['1. x + 1 = 2', '2. x + 2 = 3']);
    expect(scanProblems().graded).toBe(false);
  });

  it('is true when the page can check answers', () => {
    worksheet(['1. x + 1 = 2', '2. x + 2 = 3'], { graded: true });
    expect(scanProblems().graded).toBe(true);
  });

  it('is true when the page already marks correctness', () => {
    document.body.innerHTML = `
      <main><ol>
        <li>1. x + 1 = 2 <span class="answer-correct">✓</span></li>
        <li>2. x + 2 = 3</li>
      </ol></main>`;
    expect(scanProblems().graded).toBe(true);
  });
});

describe('readPageGrade', () => {
  it('reads correct and incorrect without confusing the two', () => {
    document.body.innerHTML = `
      <div id="a"><span class="answer-correct">✓</span></div>
      <div id="b"><span class="answer-incorrect">✗</span></div>
      <div id="c">nothing marked</div>`;
    expect(readPageGrade(document.querySelector('#a'))).toBe('correct');
    expect(readPageGrade(document.querySelector('#b'))).toBe('incorrect');
    expect(readPageGrade(document.querySelector('#c'))).toBeNull();
  });

  it('returns null for a detached or missing element', () => {
    expect(readPageGrade(null)).toBeNull();
    expect(readPageGrade(document.createElement('div'))).toBeNull();
  });
});
