// @vitest-environment jsdom
//
// The FIRST extension-workspace unit spec (Sprint 12 Task 8, deliberate and
// minimal per the sprint plan): pure resolver + lifecycle logic only, no
// WXT/browser harness. jsdom does no layout -- every getBoundingClientRect
// in this file is stubbed (Element.prototype in beforeEach for the common
// case, per-element overrides where a test needs a specific rect) -- see
// annotations.ts's own header comment for why the module is written to be
// testable this way.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ANNOTATIONS_EVENT,
  MAX_ANNOTATIONS_PER_TURN,
  clampRectToViewport,
  clearAnnotations,
  matchRegistryEntries,
  normalizeMatchText,
  resolveTarget,
  showTurnAnnotations,
  showTurnAnnotationsSequenced,
  teardown,
  type AnnotationsEventDetail,
  type DrawInstruction,
  type EquationRegistry,
} from '../src/content/annotations';
import type { Annotation, AnnotationTarget } from '../src/types/messages';
import {
  LABEL_HEIGHT,
  estimateLabelWidth,
  layoutLabels,
  type LabelBox,
} from '../src/overlay/AnnotationLayer';
import { assignAnnotationColors } from '../src/overlay/Overlay';

function fakeDomRect(rect: { x: number; y: number; w: number; h: number }): DOMRect {
  return {
    x: rect.x,
    y: rect.y,
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.w,
    bottom: rect.y + rect.h,
    width: rect.w,
    height: rect.h,
    toJSON: () => ({}),
  } as DOMRect;
}

// Own-property override shadows the prototype stub below, so each test only
// needs to say what a SPECIFIC element's rect is; everything else falls
// back to the default (non-degenerate, so an un-stubbed-but-connected
// element reads as "visible" rather than accidentally failing every test).
function withRect<T extends Element>(el: T, rect: { x: number; y: number; w: number; h: number }): T {
  el.getBoundingClientRect = () => fakeDomRect(rect);
  return el;
}

function captureDispatches() {
  const dispatches: DrawInstruction[][] = [];
  const onEvent = (event: Event) => {
    dispatches.push((event as CustomEvent<AnnotationsEventDetail>).detail.annotations);
  };
  window.addEventListener(ANNOTATIONS_EVENT, onEvent);
  return {
    dispatches,
    latest: () => dispatches[dispatches.length - 1],
    stop: () => window.removeEventListener(ANNOTATIONS_EVENT, onEvent),
  };
}

// A resolvable annotation + its registry element, paired so a test can build
// both the `annotations` array and the `registry` array from the same call.
function resolvableAnnotation(id: string, latex: string): { annotation: Annotation; el: HTMLElement } {
  const el = document.createElement('span');
  document.body.appendChild(el);
  withRect(el, { x: 0, y: 0, w: 10, h: 10 });
  return {
    el,
    annotation: { id, type: 'highlight', target: { kind: 'textMatch', text: latex } },
  };
}

beforeEach(() => {
  // Default: connected elements read as visible (non-zero rect) unless a
  // test overrides them with withRect. Range rect is fixed and non-zero so
  // the bounded page-text search path (searchVisibleText) can succeed.
  Element.prototype.getBoundingClientRect = () => fakeDomRect({ x: 0, y: 0, w: 20, h: 20 });
  Range.prototype.getBoundingClientRect = () => fakeDomRect({ x: 1, y: 1, w: 40, h: 20 });
});

afterEach(() => {
  teardown();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('normalizeMatchText / matchRegistryEntries / clampRectToViewport (pure helpers)', () => {
  it('normalises whitespace runs and case', () => {
    expect(normalizeMatchText('  X^2  +  5X + 6 = 0 ')).toBe('x^2 + 5x + 6 = 0');
  });

  it('registry matching: exact (normalised) beats substring, and a too-short substring never matches', () => {
    const registry: EquationRegistry = [
      { equation: { latex: 'x^2 + 5x + 6 = 0' }, element: null },
      { equation: { latex: 'x^2 - 9 = 0' }, element: null },
    ];

    expect(matchRegistryEntries('X^2 + 5X + 6 = 0', registry)).toEqual([registry[0]]);
    expect(matchRegistryEntries('x^2 +', registry)).toEqual([registry[0]]); // bounded substring, >= 4 chars
    // "x^2" is short (below MIN_SUBSTRING_MATCH_CHARS) AND appears in BOTH
    // equations -- genuinely ambiguous WHICH one it means, still refused.
    expect(matchRegistryEntries('x^2', registry)).toEqual([]);
  });

  it('a short substring is still allowed through when it is UNIQUE to exactly one registry entry', () => {
    const registry: EquationRegistry = [
      { equation: { latex: 'x^2 + 5x + 6 = 0' }, element: null },
      { equation: { latex: 'x = 4' }, element: null },
    ];

    // "4" is below MIN_SUBSTRING_MATCH_CHARS, but it only appears in ONE of
    // the two equations -- no "which equation" question to guess at, so
    // it's allowed (the sub-term resolver then narrows the rect within it).
    expect(matchRegistryEntries('4', registry)).toEqual([registry[1]]);
  });

  it('clamps a bbox to the viewport and refuses one that clamps to nothing', () => {
    expect(clampRectToViewport({ x: -10, y: -10, w: 50, h: 50 }, 1024, 768)).toEqual({
      x: 0,
      y: 0,
      w: 40,
      h: 40,
    });
    expect(clampRectToViewport({ x: 2000, y: 0, w: 50, h: 50 }, 1024, 768)).toBeUndefined();
  });
});

describe('resolveTarget — priority chain + drop-don\'t-guess (ADR-022)', () => {
  it('a selector hit wins over textMatch on the same target, even when the registry also matches', () => {
    const selEl = withRect(document.createElement('div'), { x: 10, y: 20, w: 100, h: 30 });
    selEl.id = 'eq-selector';
    document.body.appendChild(selEl);

    const registryEl = withRect(document.createElement('div'), { x: 999, y: 999, w: 10, h: 10 });
    document.body.appendChild(registryEl);
    const registry: EquationRegistry = [{ equation: { latex: 'x = 4' }, element: registryEl }];

    const target: AnnotationTarget = { kind: 'selector', selector: '#eq-selector', text: 'x = 4' };
    expect(resolveTarget(target, registry)?.rect).toEqual({ x: 10, y: 20, w: 100, h: 30 });
  });

  it('registry textMatch resolves via EXACT normalised match (whitespace/case) to the live element rect', () => {
    const el = withRect(document.createElement('span'), { x: 5, y: 5, w: 50, h: 12 });
    document.body.appendChild(el);
    const registry: EquationRegistry = [{ equation: { latex: 'x^2 + 5x + 6 = 0' }, element: el }];

    const resolved = resolveTarget({ kind: 'textMatch', text: '  X^2 + 5X + 6 = 0  ' }, registry);

    expect(resolved?.rect).toEqual({ x: 5, y: 5, w: 50, h: 12 });
    expect(resolved?.anchor).toEqual({ kind: 'element', element: el });
  });

  it('a paraphrased target with no occurrence anywhere on the page is dropped, never guessed', () => {
    document.body.innerHTML = '<p>Nothing relevant here.</p>';
    const registry: EquationRegistry = [{ equation: { latex: 'x^2 + 5x + 6 = 0' }, element: null }];

    expect(resolveTarget({ kind: 'textMatch', text: 'complete the square on this expression' }, registry)).toBeUndefined();
  });

  it('a disconnected registry element falls through to the bounded page-text search and resolves there', () => {
    // Captured at overlay-open time, but the SPA has since removed it from
    // the page -- never appended here, so isConnected is false even though
    // the string still matches.
    const deadEl = document.createElement('span');
    const registry: EquationRegistry = [{ equation: { latex: 'x^2 - 4 = 0' }, element: deadEl }];
    document.body.innerHTML = '<p>Now solve x^2 - 4 = 0 for x.</p>';

    const resolved = resolveTarget({ kind: 'textMatch', text: 'x^2 - 4 = 0' }, registry);

    expect(resolved?.anchor.kind).toBe('range');
    expect(resolved?.rect).toEqual({ x: 1, y: 1, w: 40, h: 20 });
  });

  it('a disconnected registry element with no page-text occurrence either is dropped', () => {
    const deadEl = document.createElement('span');
    const registry: EquationRegistry = [{ equation: { latex: 'x^2 - 4 = 0' }, element: deadEl }];
    document.body.innerHTML = '<p>Nothing matches this at all.</p>';

    expect(resolveTarget({ kind: 'textMatch', text: 'x^2 - 4 = 0' }, registry)).toBeUndefined();
  });

  it('bbox pass-through clamps to the viewport via resolveTarget too, and drops when clamping leaves nothing', () => {
    const clamped = resolveTarget({ kind: 'bbox', bbox: { x: -10, y: -10, w: 50, h: 50 } }, []);
    expect(clamped?.rect).toEqual({ x: 0, y: 0, w: 40, h: 40 });
    expect(clamped?.anchor).toEqual({ kind: 'bbox' });

    const offscreen = resolveTarget({ kind: 'bbox', bbox: { x: window.innerWidth + 100, y: 0, w: 50, h: 50 } }, []);
    expect(offscreen).toBeUndefined();
  });
});

describe('showTurnAnnotations — replace-per-turn, ttl, cap, teardown (ADR-022)', () => {
  it('replace-per-turn: a new turn\'s dispatch carries only that turn\'s annotations', () => {
    const capture = captureDispatches();

    const turn1 = resolvableAnnotation('a-t1', 'x = 1');
    showTurnAnnotations([turn1.annotation], [{ equation: { latex: 'x = 1' }, element: turn1.el }]);
    expect(capture.latest()?.map((d) => d.id)).toEqual(['a-t1']);

    const turn2 = resolvableAnnotation('a-t2', 'x = 2');
    showTurnAnnotations([turn2.annotation], [{ equation: { latex: 'x = 2' }, element: turn2.el }]);
    expect(capture.latest()?.map((d) => d.id)).toEqual(['a-t2']);

    capture.stop();
  });

  it('ttl expiry removes exactly the expired annotation and leaves the rest active', () => {
    vi.useFakeTimers();
    const capture = captureDispatches();

    const short = resolvableAnnotation('a-short', 'x = 1');
    const long = resolvableAnnotation('a-long', 'x = 2');
    showTurnAnnotations(
      [
        { ...short.annotation, ttlMs: 100 },
        long.annotation,
      ],
      [
        { equation: { latex: 'x = 1' }, element: short.el },
        { equation: { latex: 'x = 2' }, element: long.el },
      ],
    );
    expect(capture.latest()?.map((d) => d.id).sort()).toEqual(['a-long', 'a-short']);

    vi.advanceTimersByTime(150);
    expect(capture.latest()?.map((d) => d.id)).toEqual(['a-long']);

    capture.stop();
  });

  it(`caps at MAX_ANNOTATIONS_PER_TURN (${MAX_ANNOTATIONS_PER_TURN}) even when more are resolvable`, () => {
    const capture = captureDispatches();

    const built = Array.from({ length: MAX_ANNOTATIONS_PER_TURN + 2 }, (_, i) =>
      resolvableAnnotation(`a-${i}`, `eq${i}`),
    );
    const registry: EquationRegistry = built.map((b, i) => ({ equation: { latex: `eq${i}` }, element: b.el }));

    showTurnAnnotations(
      built.map((b) => b.annotation),
      registry,
    );

    expect(capture.latest()).toHaveLength(MAX_ANNOTATIONS_PER_TURN);
    expect(capture.latest()?.map((d) => d.id)).toEqual(
      built.slice(0, MAX_ANNOTATIONS_PER_TURN).map((b) => b.annotation.id),
    );

    capture.stop();
  });

  it('teardown clears the active set and cancels a pending ttl timer', () => {
    vi.useFakeTimers();
    const capture = captureDispatches();

    const withTtl = resolvableAnnotation('a-ttl', 'x = 1');
    showTurnAnnotations([{ ...withTtl.annotation, ttlMs: 5000 }], [{ equation: { latex: 'x = 1' }, element: withTtl.el }]);
    expect(capture.latest()).toHaveLength(1);

    teardown();
    expect(capture.latest()).toEqual([]);

    // If the ttl timer survived teardown, it would fire here and dispatch
    // again (the entry is gone, but expire() would still run) -- assert no
    // further dispatch happened at all.
    const dispatchCountAfterTeardown = capture.dispatches.length;
    vi.advanceTimersByTime(10000);
    expect(capture.dispatches).toHaveLength(dispatchCountAfterTeardown);

    capture.stop();
  });

  it('a turn with no annotations and nothing previously active is a true no-op (no dispatch)', () => {
    const capture = captureDispatches();
    showTurnAnnotations([], []);
    expect(capture.dispatches).toHaveLength(0);
    capture.stop();
  });

  it('clearAnnotations empties an active turn with one dispatch, and no-ops when nothing is active', () => {
    const capture = captureDispatches();

    const only = resolvableAnnotation('a-only', 'x = 1');
    showTurnAnnotations([only.annotation], [{ equation: { latex: 'x = 1' }, element: only.el }]);
    expect(capture.dispatches).toHaveLength(1);

    clearAnnotations();
    expect(capture.dispatches).toHaveLength(2);
    expect(capture.latest()).toEqual([]);

    clearAnnotations(); // nothing active -- no empty-to-empty dispatch
    expect(capture.dispatches).toHaveLength(2);

    capture.stop();
  });
});

describe('sub-term rect resolution — precise boxes for a piece of an equation, not the whole thing', () => {
  it('KaTeX: a substring target resolves to a rect around just that glyph, not the whole equation', () => {
    // "x2-3x+2=" -- one leaf span per glyph, each wrapped in an extra
    // structural span with no text of its own, proving the leaf walk
    // descends through non-leaf wrappers rather than only checking direct
    // children.
    const glyphs = ['x', '2', '-', '3', 'x', '+', '2', '='];
    const katexEl = document.createElement('span');
    katexEl.classList.add('katex');
    const html = document.createElement('span');
    html.classList.add('katex-html');
    const base = document.createElement('span');
    glyphs.forEach((text, i) => {
      const wrap = document.createElement('span');
      const glyph = document.createElement('span');
      glyph.textContent = text;
      withRect(glyph, { x: i * 10, y: 0, w: 10, h: 20 });
      wrap.appendChild(glyph);
      base.appendChild(wrap);
    });
    html.appendChild(base);
    katexEl.appendChild(html);
    document.body.appendChild(katexEl);
    withRect(katexEl, { x: 0, y: 0, w: glyphs.length * 10, h: 20 });

    const registry: EquationRegistry = [{ equation: { latex: 'x2-3x+2=' }, element: katexEl }];
    const resolved = resolveTarget({ kind: 'textMatch', text: '2' }, registry);

    expect(resolved?.anchor).toEqual({ kind: 'sub-term', element: katexEl, targetText: '2' });
    // "2" first occurs as the exponent, glyph index 1 -> x = 10..20 -- a
    // rect narrower than (and inside) the whole equation's 0..80.
    expect(resolved?.rect).toEqual({ x: 10, y: 0, w: 10, h: 20 });
  });

  it('MathJax: correlates the (textless) visible token tree with the assistive-MathML text positionally', () => {
    // Mirrors the real Khan Academy shape: mjx-math's tokens carry NO
    // textContent at all (their MJX-C children render glyphs via CSS only)
    // -- the assistive-mml <math> sibling is the only text source, and is
    // correlated to the visible tokens by POSITION.
    const tokenTags = ['mi', 'mn', 'mo', 'mn', 'mi', 'mo', 'mn', 'mo'];
    const glyphTexts = ['x', '2', '−', '3', 'x', '+', '2', '='];

    const container = document.createElement('mjx-container');
    const mjxMath = document.createElement('mjx-math');
    tokenTags.forEach((tag, i) => {
      const token = document.createElement(`mjx-${tag}`);
      token.appendChild(document.createElement('mjx-c')); // per-character leaf, no text
      withRect(token, { x: i * 12, y: 5, w: 12, h: 18 });
      mjxMath.appendChild(token);
    });
    container.appendChild(mjxMath);

    const mathNS = 'http://www.w3.org/1998/Math/MathML';
    const assistive = document.createElement('mjx-assistive-mml');
    const mathEl = document.createElementNS(mathNS, 'math');
    tokenTags.forEach((tag, i) => {
      const leaf = document.createElementNS(mathNS, tag);
      leaf.textContent = glyphTexts[i];
      mathEl.appendChild(leaf);
    });
    assistive.appendChild(mathEl);
    container.appendChild(assistive);
    document.body.appendChild(container);
    withRect(container, { x: 0, y: 0, w: 96, h: 20 });

    const registry: EquationRegistry = [{ equation: { text: 'x2−3x+2=' }, element: container }];
    // "3" is unambiguous within the string (occurs once) -- token index 3.
    const resolved = resolveTarget({ kind: 'textMatch', text: '3' }, registry);

    expect(resolved?.anchor).toEqual({ kind: 'sub-term', element: container, targetText: '3' });
    expect(resolved?.rect).toEqual({ x: 36, y: 5, w: 12, h: 18 });
  });

  it('MathJax: a mismatched visible/assistive leaf count (e.g. a multi-character token) bails to the whole equation', () => {
    const container = document.createElement('mjx-container');
    const mjxMath = document.createElement('mjx-math');
    const token = document.createElement('mjx-mi');
    // "sin" as ONE token but THREE MJX-C children -- collectMathJaxVisibleTokens
    // stops at the token, so this alone wouldn't cause a mismatch; instead
    // simulate the mismatch directly: two visible tokens, three assistive ones.
    mjxMath.appendChild(token);
    const token2 = document.createElement('mjx-mo');
    mjxMath.appendChild(token2);
    container.appendChild(mjxMath);
    withRect(container, { x: 0, y: 0, w: 40, h: 20 });

    const mathNS = 'http://www.w3.org/1998/Math/MathML';
    const assistive = document.createElement('mjx-assistive-mml');
    const mathEl = document.createElementNS(mathNS, 'math');
    for (const [tag, text] of [['mi', 'x'], ['mo', '='], ['mn', '5']] as const) {
      const leaf = document.createElementNS(mathNS, tag);
      leaf.textContent = text;
      mathEl.appendChild(leaf);
    }
    assistive.appendChild(mathEl);
    container.appendChild(assistive);
    document.body.appendChild(container);

    const registry: EquationRegistry = [{ equation: { text: 'x=5' }, element: container }];
    const resolved = resolveTarget({ kind: 'textMatch', text: '5' }, registry);

    // 2 visible tokens vs 3 assistive leaves -- resolveMathJaxSubRect bails,
    // and resolveTarget falls back to the whole element's rect.
    expect(resolved?.anchor).toEqual({ kind: 'element', element: container });
    expect(resolved?.rect).toEqual({ x: 0, y: 0, w: 40, h: 20 });
  });

  it('plain MathML: a bare <math> node walks its own <mi>/<mn>/<mo> leaves directly', () => {
    const mathNS = 'http://www.w3.org/1998/Math/MathML';
    const mathEl = document.createElementNS(mathNS, 'math');
    const parts: [string, string][] = [
      ['mi', 'x'],
      ['mo', '='],
      ['mn', '5'],
    ];
    parts.forEach(([tag, text], i) => {
      const leaf = document.createElementNS(mathNS, tag);
      leaf.textContent = text;
      withRect(leaf, { x: i * 10, y: 0, w: 10, h: 15 });
      mathEl.appendChild(leaf);
    });
    document.body.appendChild(mathEl);
    withRect(mathEl, { x: 0, y: 0, w: 30, h: 15 });

    const registry: EquationRegistry = [{ equation: { text: 'x=5' }, element: mathEl }];
    const resolved = resolveTarget({ kind: 'textMatch', text: '5' }, registry);

    expect(resolved?.anchor).toEqual({ kind: 'sub-term', element: mathEl, targetText: '5' });
    expect(resolved?.rect).toEqual({ x: 20, y: 0, w: 10, h: 15 });
  });

  it('a sub-term walk that cannot resolve (no internal structure to sub-divide) falls back to the whole-equation rect, never a guess', () => {
    const katexEl = document.createElement('span');
    katexEl.classList.add('katex');
    // No '.katex-html' child at all -- resolveKatexSubRect bails immediately.
    document.body.appendChild(katexEl);
    withRect(katexEl, { x: 0, y: 0, w: 80, h: 20 });

    const registry: EquationRegistry = [{ equation: { latex: 'x^2 + 5x + 6 = 0' }, element: katexEl }];
    const resolved = resolveTarget({ kind: 'textMatch', text: 'x^2' }, registry);

    expect(resolved?.anchor).toEqual({ kind: 'element', element: katexEl });
    expect(resolved?.rect).toEqual({ x: 0, y: 0, w: 80, h: 20 });
  });

  it('an EXACT whole-equation reference skips sub-term resolution and uses the whole element rect', () => {
    const glyphs = ['x', '=', '4'];
    const katexEl = document.createElement('span');
    katexEl.classList.add('katex');
    const html = document.createElement('span');
    html.classList.add('katex-html');
    glyphs.forEach((text, i) => {
      const glyph = document.createElement('span');
      glyph.textContent = text;
      withRect(glyph, { x: i * 10, y: 0, w: 10, h: 20 });
      html.appendChild(glyph);
    });
    katexEl.appendChild(html);
    document.body.appendChild(katexEl);
    withRect(katexEl, { x: 0, y: 0, w: 30, h: 20 });

    const registry: EquationRegistry = [{ equation: { latex: 'x=4' }, element: katexEl }];
    const resolved = resolveTarget({ kind: 'textMatch', text: '  X=4  ' }, registry);

    expect(resolved?.anchor).toEqual({ kind: 'element', element: katexEl });
    expect(resolved?.rect).toEqual({ x: 0, y: 0, w: 30, h: 20 });
  });
});

describe('showTurnAnnotationsSequenced — voice-mode even time-split reveal', () => {
  it('reveals N annotations one at a time, each getting an even share of the total duration', () => {
    vi.useFakeTimers();
    const capture = captureDispatches();

    const a = resolvableAnnotation('a-1', 'eq1');
    const b = resolvableAnnotation('a-2', 'eq2');
    const c = resolvableAnnotation('a-3', 'eq3');
    const registry: EquationRegistry = [
      { equation: { latex: 'eq1' }, element: a.el },
      { equation: { latex: 'eq2' }, element: b.el },
      { equation: { latex: 'eq3' }, element: c.el },
    ];

    showTurnAnnotationsSequenced([a.annotation, b.annotation, c.annotation], registry, 3000);
    expect(capture.latest()?.map((d) => d.id)).toEqual(['a-1']);

    vi.advanceTimersByTime(999);
    expect(capture.latest()?.map((d) => d.id)).toEqual(['a-1']); // still inside the first 1000ms slice

    vi.advanceTimersByTime(2);
    expect(capture.latest()?.map((d) => d.id)).toEqual(['a-2']); // crossed into the second slice

    vi.advanceTimersByTime(1000);
    expect(capture.latest()?.map((d) => d.id)).toEqual(['a-3']); // crossed into the third slice

    // The last slice's annotation persists once its own duration elapses --
    // same persist-until-replaced default as ttlMs 0, not an auto-clear the
    // instant speech ends.
    vi.advanceTimersByTime(10_000);
    expect(capture.latest()?.map((d) => d.id)).toEqual(['a-3']);

    capture.stop();
  });

  it('falls back to simultaneous display when there is only one resolvable annotation (nothing to sequence)', () => {
    const capture = captureDispatches();
    const only = resolvableAnnotation('a-solo', 'eq1');

    showTurnAnnotationsSequenced([only.annotation], [{ equation: { latex: 'eq1' }, element: only.el }], 5000);

    expect(capture.latest()?.map((d) => d.id)).toEqual(['a-solo']);
    capture.stop();
  });

  it('a new (non-sequenced) turn cancels an in-flight sequence', () => {
    vi.useFakeTimers();
    const capture = captureDispatches();

    const a = resolvableAnnotation('seq-a', 'eqA');
    const b = resolvableAnnotation('seq-b', 'eqB');
    showTurnAnnotationsSequenced(
      [a.annotation, b.annotation],
      [
        { equation: { latex: 'eqA' }, element: a.el },
        { equation: { latex: 'eqB' }, element: b.el },
      ],
      2000,
    );
    expect(capture.latest()?.map((d) => d.id)).toEqual(['seq-a']);

    const next = resolvableAnnotation('next-turn', 'eqNext');
    showTurnAnnotations([next.annotation], [{ equation: { latex: 'eqNext' }, element: next.el }]);
    expect(capture.latest()?.map((d) => d.id)).toEqual(['next-turn']);

    // If the cancelled sequence's timer had still fired, it would have
    // replaced "next-turn" with "seq-b" here.
    vi.advanceTimersByTime(5000);
    expect(capture.latest()?.map((d) => d.id)).toEqual(['next-turn']);

    capture.stop();
  });
});

// Sprint 14 Task 8/9: the deterministic label collision layout
// (AnnotationLayer.tsx's layoutLabels). Pure over rects -- no DOM, no jsdom
// stubbing needed, same "pure helper" precedent as clampRectToViewport
// above -- so these run with plain fixture rects, not withRect().
describe('layoutLabels — deterministic label collision layout (Sprint 14 Task 8, ADR-029)', () => {
  function box(id: string, anchorRect: { x: number; y: number; w: number; h: number }, width = 60): LabelBox {
    return { id, anchorRect, width, height: LABEL_HEIGHT };
  }

  it('leaves non-overlapping inputs at their natural position, with no leader line', () => {
    const boxes = [box('a', { x: 100, y: 300, w: 20, h: 20 }), box('b', { x: 500, y: 300, w: 20, h: 20 })];
    const placements = layoutLabels(boxes, 1280, 800);

    expect(placements).toHaveLength(2);
    for (const placement of placements) {
      expect(placement.leader).toBeUndefined();
    }
    // Both anchors sit well below the label height + 6px gap, so both
    // labels fit ABOVE their anchor at its natural x.
    expect(placements[0]).toMatchObject({ x: 100, y: 300 - LABEL_HEIGHT - 6 });
    expect(placements[1]).toMatchObject({ x: 500, y: 300 - LABEL_HEIGHT - 6 });
  });

  it('a same-anchor stack (three boxes at the identical rect, as "annotate each component of x^2+5x+6" would produce) resolves with zero intersections', () => {
    const rect = { x: 200, y: 300, w: 20, h: 20 };
    const boxes = [box('a', rect), box('b', rect), box('c', rect)];
    const placements = layoutLabels(boxes, 1280, 800);

    expect(placements).toHaveLength(3);
    // The first keeps its natural spot; the second and third had to move.
    expect(placements[0].leader).toBeUndefined();
    expect(placements[1].leader).toBeDefined();
    expect(placements[2].leader).toBeDefined();

    for (let i = 0; i < placements.length; i++) {
      for (let j = i + 1; j < placements.length; j++) {
        const a = { x: placements[i].x, y: placements[i].y, width: boxes[i].width, height: boxes[i].height };
        const b = { x: placements[j].x, y: placements[j].y, width: boxes[j].width, height: boxes[j].height };
        const overlaps = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
        expect(overlaps).toBe(false);
      }
    }
  });

  it('a leader line, when present, points from the label back toward its own anchor box', () => {
    const rect = { x: 200, y: 300, w: 20, h: 20 };
    const placements = layoutLabels([box('a', rect), box('b', rect)], 1280, 800);
    const leader = placements[1].leader!;

    expect(leader).toBeDefined();
    // The anchor end sits at the anchor rect's own top edge (both labels
    // fit above it, per the "fitsAbove" branch) -- the anchor x/y this
    // fixture's rect actually has.
    expect(leader.x2).toBe(rect.x + rect.w / 2);
    expect(leader.y2).toBe(rect.y);
  });

  it('clamps a too-close-to-the-top natural position down to the viewport margin, not a negative y', () => {
    // rect.y = 28 is the EXACT boundary where "fits above" first becomes
    // true (28 - LABEL_HEIGHT(22) - 6 == 0) -- so the natural (pre-clamp) y
    // is 0, one px inside the top edge but still under the 4px margin this
    // module enforces everywhere else (VIEWPORT_MARGIN_PX). This is a
    // single, un-stacked label: nothing here is about collision, purely the
    // viewport floor.
    const rect = { x: 100, y: 28, w: 10, h: 10 };
    const [placement] = layoutLabels([box('a', rect)], 1280, 800);

    expect(placement.y).toBe(4);
  });

  it('clamps a too-close-to-the-right natural position back inside the viewport, not off the right edge', () => {
    const rect = { x: 1275, y: 300, w: 10, h: 10 };
    const [placement] = layoutLabels([box('a', rect, 60)], 1280, 800);

    expect(placement.x).toBe(1280 - 60 - 4);
  });

  it('is deterministic: the same input (same rects, same order) always produces the same output', () => {
    const rect = { x: 340, y: 220, w: 30, h: 24 };
    const boxes = [box('a', rect), box('b', rect), box('c', rect)];

    expect(layoutLabels(boxes, 1280, 800)).toEqual(layoutLabels(boxes, 1280, 800));
  });

  it('estimateLabelWidth grows with text length but never below the floor', () => {
    expect(estimateLabelWidth('')).toBe(28);
    expect(estimateLabelWidth('x')).toBeGreaterThanOrEqual(28);
    expect(estimateLabelWidth('a rather long label here')).toBeGreaterThan(estimateLabelWidth('short'));
  });
});

// Sprint 14 Task 7/9: the per-turn annotation-color assignment
// (Overlay.tsx's assignAnnotationColors) -- Transcript.tsx's color-linked
// text highlight and AnnotationLayer.tsx's box stroke (Task 8) both read
// this SAME map, so its determinism/stability is pinned here once rather
// than re-proven in each consumer's own spec.
describe('assignAnnotationColors — deterministic per-turn ordinal color assignment (Sprint 14 Task 7, ADR-029 amendment)', () => {
  function annotation(id: string): Annotation {
    return { id, type: 'highlight', target: { kind: 'textMatch', text: id } };
  }

  it('assigns distinct slots, in order, to distinct annotations in one turn', () => {
    const map = assignAnnotationColors([annotation('a'), annotation('b'), annotation('c')]);
    expect(map).toEqual({ a: 'annot-1', b: 'annot-2', c: 'annot-3' });
  });

  it('cycles back to the first slot if a turn somehow exceeds the 4-slot palette (defensive -- the envelope caps at 3 per turn)', () => {
    const map = assignAnnotationColors([annotation('a'), annotation('b'), annotation('c'), annotation('d'), annotation('e')]);
    expect(map.a).toBe('annot-1');
    expect(map.e).toBe('annot-1');
  });

  it('is deterministic and stable across re-renders of the same turn: the same annotations array (by value) always maps to the same slots', () => {
    const first = assignAnnotationColors([annotation('x'), annotation('y')]);
    const second = assignAnnotationColors([annotation('x'), annotation('y')]);
    expect(first).toEqual(second);
  });

  it('returns an empty map for no annotations, never throwing on undefined', () => {
    expect(assignAnnotationColors(undefined)).toEqual({});
    expect(assignAnnotationColors([])).toEqual({});
  });
});
