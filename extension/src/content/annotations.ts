import type { Annotation, AnnotationTarget, PageEquation } from '../types/messages';

// Calyxa annotation controller (Sprint 12, ADR-022).
//
// Owns everything between "the turn's reply carried annotations" and "the
// SVG layer has rects to draw": target resolution against the live host
// page, the active-turn annotation set, ttl timers, scroll/resize
// re-anchoring, and the clear/teardown lifecycle. Runs in the content
// script -- the only context with host-DOM READ access -- and hands the
// overlay's AnnotationLayer resolved draw instructions over a window
// CustomEvent (ANNOTATIONS_EVENT below), the same bridge pattern as
// 'calyxa:toggle-panel'. The layer never resolves anything; this module
// never draws anything.
//
// HOST-DOM READS ONLY (DOM policy, ADR-002/ADR-022). Every host-page touch
// in this file is a read: querySelector, createTreeWalker, createRange,
// getBoundingClientRect, checkVisibility. Nothing here sets a node, an
// attribute, a style, or a class on the host page -- the drawing all
// happens inside the <calyxa-overlay> shadow root, which is the layer's
// job, not this module's.
//
// DROP, NEVER GUESS (ADR-022): a target that cannot be resolved to a
// visible on-page rect is silently dropped -- console.debug diagnostic,
// nothing user-facing, the reply is unaffected. A wrongly-placed annotation
// actively misleads the student; nothing drawn is always the safer failure.
//
// Resolution priority is FIELD-driven, with target.kind treated as
// advisory: whichever fields the (already envelope-validated) target
// actually carries are tried in strength order -- `selector` (most
// precise) -> `text` against the equation registry (the common case the
// prompt steers the model onto) -> `text` as a bounded visible-page search
// -> `bbox` (viewport-clamped pass-through). Dispatching on fields rather
// than on `kind` costs nothing and gives a mis-labelled but well-formed
// target its fallback chances instead of hard-failing it on a label.
//
// Import-safe under Node deliberately: no top-level window/document access,
// and the string/geometry helpers are exported pure functions -- Task 8's
// jsdom spec (jsdom does no layout; getBoundingClientRect returns zeros
// unless stubbed) tests the matching, priority, and lifecycle logic without
// a browser.

export const ANNOTATIONS_EVENT = 'calyxa:annotations';

// Mirrors the prompt's "at most 3 annotations per turn" guidance
// (system-prompt.ts, Task 2) -- enforced here too, defence in depth against
// a prompt miss. Applied BEFORE resolution so an over-limit turn never
// spends page-search budget on annotations that would be dropped anyway.
export const MAX_ANNOTATIONS_PER_TURN = 3;

// A substring registry match (pass 2 in matchRegistryEntries) below this
// many normalised chars is refused: "2" would "match" the first equation
// containing a 2, which is exactly the guessing ADR-022 forbids.
export const MIN_SUBSTRING_MATCH_CHARS = 4;

// The page-text search examines at most this many text nodes before giving
// up -- the extractor's "bounded, never an unbounded whole-DOM scan"
// discipline applied to the read path this module adds.
const MAX_SEARCH_TEXT_NODES = 2500;

// A bbox clamped to the viewport must keep at least this many px in each
// dimension or it is treated as off-screen and dropped.
const MIN_CLAMPED_BBOX_PX = 2;

const OVERLAY_HOST_TAG = 'calyxa-overlay';

// --- shared shapes -----------------------------------------------------------

// Host-viewport coordinates (getBoundingClientRect space) -- exactly what
// the fixed-position SVG layer draws in, no offset math on either side.
export type DrawRect = { x: number; y: number; w: number; h: number };

// What the layer receives per annotation: the resolved rect plus the
// presentation fields, nothing about targets or anchors. style is passed
// through as-is -- the layer owns the color-allow-list -> theme-token
// mapping (Task 6), including the unknown-color -> default fallback.
export type DrawInstruction = {
  id: string;
  type: Annotation['type'];
  rect: DrawRect;
  style?: Annotation['style'];
  label?: string;
  step?: number;
};

export type AnnotationsEventDetail = { annotations: DrawInstruction[] };

// One captured equation paired with its live source element -- the zip of
// capturedPageContext.equations[i] with capturedEquationElements[i] (Task
// 4's parallel arrays; Task 7 builds this). The equation strings here are
// the exact (client-truncated) strings the server rendered into the
// prompt, so a model that copied per the ANNOTATION GUIDANCE matches them
// verbatim.
export type EquationRegistryEntry = { equation: PageEquation; element: Element | null };
export type EquationRegistry = EquationRegistryEntry[];

// How a resolved annotation re-derives its rect at re-anchor time:
//   element -- re-read getBoundingClientRect (registry + selector hits).
//   range   -- re-build the Range over the same text-node span (search
//              hits). `matched` records the exact slice that was found so
//              the re-anchor pass can verify the node still HOLDS that text
//              at that span -- an SPA that rewrites a text node in place
//              (same node object, new content) would otherwise re-rect the
//              highlight onto whatever text now occupies those offsets,
//              which is precisely the mis-anchor ADR-022 forbids.
//   bbox    -- CANNOT re-derive: the coords were viewport-relative at
//              emission time, so the first scroll/resize invalidates what
//              they point at; re-anchoring drops them (drop-don't-guess).
type ResolvedAnchor =
  | { kind: 'element'; element: Element }
  | { kind: 'range'; node: Text; start: number; end: number; matched: string }
  | { kind: 'bbox' };

export type ResolvedTarget = { rect: DrawRect; anchor: ResolvedAnchor };

// --- pure helpers (exported for Task 8's jsdom spec) --------------------------

// The match normalisation: collapse whitespace runs, trim, case-fold.
// Deliberately nothing cleverer (no LaTeX-vs-Unicode folding) this sprint:
// the prompt demands exact copies of strings the model was GIVEN, so
// whitespace/case are the only drift worth absorbing -- anything looser
// starts matching things the model didn't mean (the plan's named risk; if
// Task 9 shows systematic misses, deepening THIS function is the fix).
export function normalizeMatchText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whitespace-tolerant, case-insensitive substring find that reports offsets
// in the ORIGINAL haystack (so a Range can be built over the real text
// node): the needle is split on whitespace, each token regex-escaped, and
// the tokens rejoined with \s+. Escaping guarantees the constructed
// pattern is valid, so no try/catch is needed around the RegExp.
export function findInText(
  haystack: string,
  needle: string,
): { start: number; end: number } | undefined {
  const tokens = needle.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return undefined;

  const pattern = tokens.map(escapeRegExp).join('\\s+');
  const match = new RegExp(pattern, 'i').exec(haystack);
  return match ? { start: match.index, end: match.index + match[0].length } : undefined;
}

// Registry candidates for a textMatch target, ORDERED: exact normalised
// equality first (against latex, mathml, AND text -- renderPageContext
// showed the model `latex ?? mathml ?? text`, so any of the three can be
// what it copied), then bounded substring containment (a partial copy like
// just the "x^2" out of "x^2 + 5x + 6 = 0" still anchors to the right
// equation -- the whole-equation rect is a correct anchor, just a larger
// one), registry order within each tier. Returns ALL candidates rather
// than the first because an equation can appear twice on a page (problem
// statement + worked solution) and the first instance's element may be
// dead by draw time -- resolveTarget takes the first candidate whose
// element is actually usable. Pure string logic; element
// liveness/visibility is deliberately NOT this function's business (that
// is what keeps it testable without layout).
export function matchRegistryEntries(
  targetText: string,
  registry: EquationRegistry,
): EquationRegistryEntry[] {
  const target = normalizeMatchText(targetText);
  if (!target) return [];

  const fieldsOf = (equation: PageEquation): string[] =>
    [equation.latex, equation.mathml, equation.text].filter(
      (field): field is string => typeof field === 'string',
    );

  const exact = registry.filter((entry) =>
    fieldsOf(entry.equation).some((field) => normalizeMatchText(field) === target),
  );

  const substring =
    target.length >= MIN_SUBSTRING_MATCH_CHARS
      ? registry.filter(
          (entry) =>
            !exact.includes(entry) &&
            fieldsOf(entry.equation).some((field) => normalizeMatchText(field).includes(target)),
        )
      : [];

  return [...exact, ...substring];
}

// Sanity-clamps a bbox to the viewport. Non-finite or non-positive
// dimensions, or a box left with less than MIN_CLAMPED_BBOX_PX in either
// dimension after clamping (i.e. essentially outside the viewport), return
// undefined -- dropped, not "drawn somewhere plausible". Viewport dims are
// parameters so this stays pure/testable.
export function clampRectToViewport(
  rect: { x: number; y: number; w: number; h: number },
  viewportWidth: number,
  viewportHeight: number,
): DrawRect | undefined {
  const { x, y, w, h } = rect;
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return undefined;

  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const right = Math.min(x + w, viewportWidth);
  const bottom = Math.min(y + h, viewportHeight);

  if (right - left < MIN_CLAMPED_BBOX_PX || bottom - top < MIN_CLAMPED_BBOX_PX) return undefined;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

// --- DOM-reading resolution ----------------------------------------------------

function isInsideOverlay(el: Element): boolean {
  return el.closest(OVERLAY_HOST_TAG) !== null;
}

// Connected, not display:none/visibility:hidden (checkVisibility, where the
// browser provides it -- the defensive access keeps this working under
// jsdom and older lib.dom typings), and a non-degenerate rect. NOTE:
// off-VIEWPORT is not invisible -- a rect scrolled out of view has real
// dimensions, draws harmlessly off-screen on the fixed layer, and scrolls
// back into place; only a collapsed/hidden element (zero-size rect) fails.
function isElementVisible(el: Element): boolean {
  if (!el.isConnected) return false;

  const checkVisibility = (el as Element & { checkVisibility?: () => boolean }).checkVisibility;
  if (typeof checkVisibility === 'function' && !checkVisibility.call(el)) return false;

  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function rectOfElement(el: Element): DrawRect {
  const rect = el.getBoundingClientRect();
  return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
}

// The bounded visible-text search -- the textMatch fallback for targets
// that miss the registry (page-TEXT excerpts, or an equation whose
// registry element died and whose text happens to exist elsewhere).
// TreeWalker over document.body text nodes: body-rooted, so the
// <calyxa-overlay> host (a sibling of <body>, mounted on <html>) is
// structurally unreachable -- the closest() check in the filter is
// belt-and-braces on top of that. Two honest limitations, both of which
// fail toward DROP (never a wrong rect): the match must fall within a
// single text node (a phrase split across inline elements misses), and the
// walk does not descend into the host page's own shadow roots (equations
// in shadow roots are covered by the registry path, which holds direct
// element refs; shadow-root page TEXT is rare enough to accept the miss).
function searchVisibleText(targetText: string): ResolvedTarget | undefined {
  const body = document.body;
  if (!body) return undefined;

  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA') {
        return NodeFilter.FILTER_REJECT;
      }
      if (parent.closest(OVERLAY_HOST_TAG)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let examined = 0;
  for (
    let node = walker.nextNode() as Text | null;
    node !== null && examined < MAX_SEARCH_TEXT_NODES;
    node = walker.nextNode() as Text | null
  ) {
    examined += 1;

    const text = node.data;
    if (!text || !text.trim()) continue;

    const hit = findInText(text, targetText);
    if (!hit) continue;

    // Layout reads only on a regex hit, never per node walked.
    const parent = node.parentElement;
    if (!parent || !isElementVisible(parent)) continue;

    const range = document.createRange();
    range.setStart(node, hit.start);
    range.setEnd(node, hit.end);
    const rect = range.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    return {
      rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
      anchor: { kind: 'range', node, start: hit.start, end: hit.end, matched: text.slice(hit.start, hit.end) },
    };
  }

  return undefined;
}

// The resolver: field-driven priority chain (see the file header for why
// `kind` is advisory). Returns the viewport rect plus the anchor the
// re-anchor pass re-derives it from, or undefined -- DROPPED, never
// guessed. Never throws: a model-fabricated selector is arbitrary text and
// querySelector throws SyntaxError on invalid syntax, so that step is
// individually guarded; the outer catch keeps any other surprise inside
// the drop contract.
export function resolveTarget(
  target: AnnotationTarget,
  registry: EquationRegistry,
): ResolvedTarget | undefined {
  try {
    // 1. CSS selector -- most precise when a real source supplied it.
    if (target.selector) {
      let el: Element | null = null;
      try {
        el = document.querySelector(target.selector);
      } catch {
        // Invalid selector syntax -- fall through to the weaker fields.
      }
      if (el && !isInsideOverlay(el) && isElementVisible(el)) {
        return { rect: rectOfElement(el), anchor: { kind: 'element', element: el } };
      }
    }

    // 2. textMatch, registry first: the precise path for on-page equations.
    //    First candidate with a live, visible element wins; a matched-but-
    //    dead entry falls through to its duplicate or to the page search.
    if (target.text) {
      for (const entry of matchRegistryEntries(target.text, registry)) {
        const el = entry.element;
        if (el && isElementVisible(el)) {
          return { rect: rectOfElement(el), anchor: { kind: 'element', element: el } };
        }
      }

      // 3. textMatch, bounded page search.
      const found = searchVisibleText(target.text);
      if (found) return found;
    }

    // 4. bbox pass-through, viewport-clamped. No caller has a real source
    //    for these today (the prompt forbids fabricating them); the OCR-beta
    //    sprint is what eventually supplies them.
    if (target.bbox) {
      const rect = clampRectToViewport(target.bbox, window.innerWidth, window.innerHeight);
      if (rect) return { rect, anchor: { kind: 'bbox' } };
    }

    return undefined;
  } catch (err) {
    console.debug('[calyxa annotations] resolveTarget threw; dropping target', err);
    return undefined;
  }
}

// --- controller state -----------------------------------------------------------

type ActiveAnnotation = {
  annotation: Annotation;
  rect: DrawRect;
  anchor: ResolvedAnchor;
  timer: ReturnType<typeof setTimeout> | undefined;
};

let active: ActiveAnnotation[] = [];
let currentRegistry: EquationRegistry = [];
let turnCounter = 0;
let listening = false;
let rafHandle: number | null = null;

function dispatchActive(): void {
  const detail: AnnotationsEventDetail = {
    annotations: active.map(({ annotation, rect }) => ({
      id: annotation.id,
      type: annotation.type,
      rect,
      ...(annotation.style ? { style: annotation.style } : {}),
      ...(annotation.label !== undefined ? { label: annotation.label } : {}),
      ...(annotation.step !== undefined ? { step: annotation.step } : {}),
    })),
  };
  window.dispatchEvent(new CustomEvent<AnnotationsEventDetail>(ANNOTATIONS_EVENT, { detail }));
}

// Cancels ttl timers and empties the active set WITHOUT dispatching --
// callers decide whether/when the layer hears about it (showTurnAnnotations
// dispatches once, after the new set is built, so replace-per-turn is one
// event, not a clear-then-draw flicker).
function resetActive(): void {
  for (const entry of active) {
    if (entry.timer !== undefined) clearTimeout(entry.timer);
  }
  active = [];
}

function onScrollOrResize(): void {
  if (rafHandle !== null) return;
  rafHandle = requestAnimationFrame(() => {
    rafHandle = null;
    reanchorNow();
  });
}

// ONE passive listener pair, registered only while annotations are active
// (ADR-022). scroll is capture-phase: scroll events don't bubble, but they
// DO pass window during capture, so a nested scroll container's scrolling
// re-anchors too.
function setListeners(on: boolean): void {
  if (on === listening) return;
  listening = on;

  if (on) {
    window.addEventListener('scroll', onScrollOrResize, { capture: true, passive: true });
    window.addEventListener('resize', onScrollOrResize, { passive: true });
  } else {
    window.removeEventListener('scroll', onScrollOrResize, { capture: true });
    window.removeEventListener('resize', onScrollOrResize);
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
  }
}

// Re-derives one active annotation's rect. The cheap path is a pure re-read
// off the existing anchor; only when that anchor has died (SPA re-render
// disconnected the element, the text node changed) does the full chain
// re-run -- at most once per annotation per re-anchor pass, and a fresh
// miss drops the annotation PERMANENTLY (returns undefined) rather than
// retrying every scroll frame.
function reanchorOne(entry: ActiveAnnotation): ActiveAnnotation | undefined {
  const { anchor } = entry;

  // bbox coords were viewport-relative at emission time; any scroll/resize
  // has moved the content they pointed at. Unresolvable -- drop.
  if (anchor.kind === 'bbox') return undefined;

  if (anchor.kind === 'element') {
    if (isElementVisible(anchor.element)) {
      return { ...entry, rect: rectOfElement(anchor.element) };
    }
  } else {
    const { node, start, end, matched } = anchor;
    // The span must still hold the exact text that was matched -- an SPA
    // rewriting the node in place keeps the node connected and long enough
    // while putting DIFFERENT text at these offsets (see the anchor-type
    // comment). Verified before any rect is produced from it.
    if (node.isConnected && node.data.length >= end && node.data.slice(start, end) === matched) {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      const rect = range.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return { ...entry, rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height } };
      }
    }
  }

  // Anchor died -- re-run the chain once (the content is often still on the
  // page in a new node after a framework re-render).
  const resolved = resolveTarget(entry.annotation.target, currentRegistry);
  return resolved ? { ...entry, rect: resolved.rect, anchor: resolved.anchor } : undefined;
}

function reanchorNow(): void {
  if (active.length === 0) return;

  const kept: ActiveAnnotation[] = [];
  for (const entry of active) {
    const updated = reanchorOne(entry);
    if (updated) {
      kept.push(updated);
    } else {
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      console.debug('[calyxa annotations] dropped at re-anchor (anchor lost)', {
        id: entry.annotation.id,
        type: entry.annotation.type,
      });
    }
  }

  active = kept;
  if (active.length === 0) setListeners(false);
  dispatchActive();
}

// ttl expiry for one annotation. Identity-based removal makes this
// inherently turn-safe: a newer turn's resetActive() already cancelled this
// timer AND replaced the array, so a stale callback (however it survived)
// finds its entry absent and no-ops.
function expire(entry: ActiveAnnotation): void {
  if (!active.includes(entry)) return;
  active = active.filter((candidate) => candidate !== entry);
  console.debug('[calyxa annotations] expired (ttl)', { id: entry.annotation.id });
  if (active.length === 0) setListeners(false);
  dispatchActive();
}

// --- public lifecycle -------------------------------------------------------------

/**
 * Replaces the previous turn's annotations with this turn's (ADR-022
 * replace-per-turn): resolve each target (≤MAX_ANNOTATIONS_PER_TURN,
 * drop-don't-guess), start ttl timers, register the re-anchor listeners,
 * and dispatch ONE draw list to the layer. A turn with no resolvable
 * annotations still clears the previous turn's drawings -- unless nothing
 * was drawn either, in which case nothing is dispatched at all (no
 * clear-flicker on the common annotation-less turn). Never throws into the
 * caller: the reply flow must not break because drawing failed.
 */
export function showTurnAnnotations(annotations: Annotation[], registry: EquationRegistry): void {
  try {
    const hadActive = active.length > 0;
    if (annotations.length === 0 && !hadActive) return;

    resetActive();
    currentRegistry = registry;
    turnCounter += 1;

    const capped = annotations.slice(0, MAX_ANNOTATIONS_PER_TURN);
    if (annotations.length > capped.length) {
      console.debug(
        `[calyxa annotations] turn ${turnCounter}: ${annotations.length - capped.length} over the per-turn cap, dropped`,
      );
    }

    for (const annotation of capped) {
      const resolved = resolveTarget(annotation.target, registry);
      if (!resolved) {
        console.debug('[calyxa annotations] dropped (unresolvable target)', {
          id: annotation.id,
          type: annotation.type,
          kind: annotation.target.kind,
        });
        continue;
      }

      const entry: ActiveAnnotation = {
        annotation,
        rect: resolved.rect,
        anchor: resolved.anchor,
        timer: undefined,
      };
      if (typeof annotation.ttlMs === 'number' && annotation.ttlMs > 0) {
        entry.timer = setTimeout(() => expire(entry), annotation.ttlMs);
      }
      active.push(entry);
    }

    setListeners(active.length > 0);
    dispatchActive();
  } catch (err) {
    console.debug('[calyxa annotations] controller error; clearing', err);
    resetActive();
    setListeners(false);
    dispatchActive();
  }
}

/**
 * Clears the layer (empty dispatch) and cancels timers/listeners. Called on
 * panel close (a dismissed tutor leaves a clean page) and by teardown. A
 * no-op when nothing is active -- no empty-to-empty dispatch.
 */
export function clearAnnotations(): void {
  const hadActive = active.length > 0;
  resetActive();
  setListeners(false);
  if (hadActive) dispatchActive();
}

/**
 * Full teardown on overlay unmount / sign-out: clear + listeners off + any
 * pending re-anchor frame cancelled (setListeners(false) handles the rAF).
 * The module stays usable afterwards -- a re-mount just starts a fresh
 * lifecycle.
 */
export function teardown(): void {
  clearAnnotations();
}
