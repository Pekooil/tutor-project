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
  teardown,
  type AnnotationsEventDetail,
  type DrawInstruction,
  type EquationRegistry,
} from '../src/content/annotations';
import type { Annotation, AnnotationTarget } from '../src/types/messages';

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
      { equation: { latex: 'x = 4' }, element: null },
    ];

    expect(matchRegistryEntries('X^2 + 5X + 6 = 0', registry)).toEqual([registry[0]]);
    expect(matchRegistryEntries('x^2 +', registry)).toEqual([registry[0]]); // bounded substring, >= 4 chars
    expect(matchRegistryEntries('4', registry)).toEqual([]); // below MIN_SUBSTRING_MATCH_CHARS -- would be a guess
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
