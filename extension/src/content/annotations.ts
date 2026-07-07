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
// many normalised chars is refused UNLESS it uniquely identifies exactly
// one registry entry: "2" would otherwise "match" the first of several
// equations containing a 2, which is exactly the cross-equation guessing
// ADR-022 forbids. See matchRegistryEntries's own comment for why a short
// but UNAMBIGUOUS match is a different (and now safely sub-rect-
// resolvable) case.
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
//   sub-term -- a textMatch that resolved to a SUBSTRING of a registered
//              equation (see resolveSubTermRect below): re-anchoring
//              re-runs the same leaf walk against the (still-connected)
//              equation element rather than re-reading a fixed rect, since
//              the equation can reflow between scroll/resize passes.
type ResolvedAnchor =
  | { kind: 'element'; element: Element }
  | { kind: 'sub-term'; element: Element; targetText: string }
  | { kind: 'range'; node: Text; start: number; end: number; matched: string }
  | { kind: 'bbox' };

export type ResolvedTarget = { rect: DrawRect; anchor: ResolvedAnchor };

// --- pure helpers (exported for Task 8's jsdom spec) --------------------------

// A small, closed set of Unicode math symbols folded to their ASCII
// equivalents before comparison -- found live on Khan Academy (Task 9
// follow-up): MathJax's assistive MathML renders U+2212 MINUS SIGN (an
// <mo> glyph), not the ASCII hyphen a model naturally types when it
// reproduces "x^2 - 3x + 2" in its own JSON output. Deliberately narrow
// (four visually-standard substitutions, not a general Unicode-math-to-
// ASCII transliteration): each one is a like-for-like symbol a model would
// write differently than the extractor reads, not a semantic rewrite that
// could match something the model didn't mean.
const SYMBOL_FOLDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/−/g, '-'], // − MINUS SIGN -> hyphen-minus
  [/[×⋅]/g, '*'], // × MULTIPLICATION SIGN, ⋅ DOT OPERATOR -> asterisk
  [/÷/g, '/'], // ÷ DIVISION SIGN -> solidus
];

// Just the symbol-folding step, split out from normalizeMatchText below so
// the sub-term leaf-matching code (findLeafRun) can fold WITHOUT the
// whitespace-collapsing step -- collapsing runs of whitespace into one
// space shifts character offsets, which is fine for a one-shot equality/
// substring check but wrong for anything that needs to map a matched span
// back to a specific run of DOM leaves by position.
function foldMatchSymbols(value: string): string {
  let folded = value;
  for (const [pattern, replacement] of SYMBOL_FOLDS) {
    folded = folded.replace(pattern, replacement);
  }
  return folded;
}

// The match normalisation: fold a narrow set of Unicode math symbols to
// ASCII, collapse whitespace runs, trim, case-fold. Whitespace/case were
// the only drift absorbed through Sprint 12 (ADR-022's original scope --
// "anything looser starts matching things the model didn't mean"); the
// symbol folds above are the deepening that same comment named as the fix
// once live use showed a systematic miss, not a loosening beyond it.
export function normalizeMatchText(value: string): string {
  return foldMatchSymbols(value).replace(/\s+/g, ' ').trim().toLowerCase();
}

// Unicode superscript digits -> their ASCII equivalents, folded together with
// the exponent-notation stripping below. A model that writes "5t²" and a
// KaTeX render whose textContent reads "5t2" mean the same term.
const SUPERSCRIPT_DIGITS: Readonly<Record<string, string>> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
};

// The DEEPER, notation-folding normalisation used ONLY by the last-resort
// registry tier (matchRegistryEntries) and the sub-term leaf walk
// (findLeafRun) below -- deliberately NOT part of normalizeMatchText, whose
// caret-PRESERVING contract the exact/substring tiers and the Sprint 12 specs
// depend on. Real-world miss, found on Khan Academy: it renders math with
// KaTeX in html-only mode, so the extractor captures each equation's `text`
// as the KaTeX wrapper's textContent -- and an exponent like "5t^2" renders
// there as the bare characters "5t2" (superscript is a plain "2", the caret
// never appears as a glyph). The model, meanwhile, naturally writes the
// exponent form "5t^2" (or "5t²", or the LaTeX "5t^{2}") into target.text --
// which is why the chat bubble's color-link (a literal substring match
// against `say`) lights up while the on-page box silently drops: "5t^2" is
// not a substring of "5t2". Folding out the structural exponent notation
// (caret, LaTeX grouping braces, unicode superscripts -- none of which are
// ever a visible glyph in the rendered math) unifies the two forms so the
// box resolves too. Narrow by design: it removes only notation that carries
// no glyph of its own, never a semantic rewrite.
export function foldNotation(value: string): string {
  return normalizeMatchText(value)
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (digit) => SUPERSCRIPT_DIGITS[digit])
    .replace(/[\^{}]/g, '')
    // Whitespace stripped, not just collapsed: KaTeX html textContent runs
    // terms together with no spaces ("8t2-8t"), while the model writes them
    // spaced ("8t^2 - 8t"). Applied to both sides in this tier, so alignment
    // holds; safe here because this fold is only ever a whole-string
    // containment test, never an offset-sensitive one.
    .replace(/\s+/g, '');
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
// shows the model `latex ?? text ?? mathml`, but matching stays permissive
// against all three since a partially-updated prompt or a future caller
// could still surface any of them), then bounded substring containment (a
// partial copy like just the "x^2" out of "x^2 + 5x + 6 = 0" still anchors
// to the right equation -- resolveTarget's sub-term resolver then narrows
// the rect to just that span within it, rather than the whole equation).
// Registry order within each tier. Returns ALL candidates rather than the
// first because an equation can appear twice on a page (problem statement
// + worked solution) and the first instance's element may be dead by draw
// time -- resolveTarget takes the first candidate whose element is
// actually usable. Pure string logic; element liveness/visibility is
// deliberately NOT this function's business (that is what keeps it
// testable without layout).
//
// The MIN_SUBSTRING_MATCH_CHARS floor exists to stop a short, generic
// substring ("2") from guessing WHICH equation it belongs to when several
// on the page could contain it. Once the sub-term resolver made even a
// short match SAFE to draw precisely (a small box within the right
// equation, not a wrong whole-equation guess), that floor became too
// blunt for realistic algebra: a bare "x2" or "3x" copied verbatim from an
// extracted equation is often shorter than 4 chars. So a substring under
// the floor is now allowed through in the one case where there is no
// "which equation" question to guess at: when it is UNIQUE to exactly one
// registry entry. A short substring appearing in more than one equation is
// still refused -- that is exactly the cross-equation ambiguity the floor
// was protecting against, and uniqueness doesn't resolve it.
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

  const substringCandidates = registry.filter(
    (entry) =>
      !exact.includes(entry) &&
      fieldsOf(entry.equation).some((field) => normalizeMatchText(field).includes(target)),
  );

  const substring =
    target.length >= MIN_SUBSTRING_MATCH_CHARS || substringCandidates.length === 1
      ? substringCandidates
      : [];

  // Last-resort tier (Sprint 14 fix -- Khan Academy KaTeX): try again with
  // the exponent-notation fold, so "5t^2"/"5t²"/"5t^{2}" match a KaTeX
  // textContent field that reads "5t2". Only entries the two tiers above did
  // NOT already claim, and only when the folded target is unambiguous by the
  // SAME rule the substring tier uses (>= MIN chars OR unique to one entry) --
  // a short, generic folded fragment must not guess which equation it belongs
  // to, exactly as MIN_SUBSTRING_MATCH_CHARS protects the plain substring tier.
  const foldedTarget = foldNotation(targetText);
  const claimed = new Set([...exact, ...substring]);
  const notationCandidates = foldedTarget
    ? registry.filter(
        (entry) =>
          !claimed.has(entry) &&
          fieldsOf(entry.equation).some((field) => foldNotation(field).includes(foldedTarget)),
      )
    : [];
  const notation =
    foldedTarget.length >= MIN_SUBSTRING_MATCH_CHARS || notationCandidates.length === 1
      ? notationCandidates
      : [];

  return [...exact, ...substring, ...notation];
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

// --- sub-term rect resolution ---------------------------------------------
//
// A textMatch that names only PART of a registered equation ("x^2" out of
// "x^2 - 3x + 2 = 0") used to resolve to the WHOLE equation's rect -- the
// registry only ever held one element per equation, so there was no rect
// for anything smaller. Circling the entire expression when the tutor is
// talking about one term is the exact complaint this section fixes: each
// resolver below walks the equation's OWN rendered leaves (the individual
// glyph-bearing DOM nodes KaTeX/MathJax/native-MathML already produced) and
// returns the union rect of just the leaves the matched span covers.
//
// Every path here can fail -- an unfamiliar internal structure, leaf counts
// that don't line up, a degenerate union rect -- and a failure returns
// undefined, never a guess: resolveTarget's caller falls back to the whole-
// equation rect exactly as before, which is always a CORRECT (if coarse)
// anchor, so sub-term resolution can only ever improve precision, never
// regress correctness.

// Leaf-collection helper for KaTeX and plain-MathML (see below):
// terminal elements only (no element children) in DOM order, which is
// reading order for the flat, non-reordering layouts both renderers use.
function collectLeafElements(root: Element): Element[] {
  const leaves: Element[] = [];
  const walk = (el: Element): void => {
    const children = Array.from(el.children);
    if (children.length === 0) {
      leaves.push(el);
      return;
    }
    for (const child of children) walk(child);
  };
  walk(root);
  return leaves;
}

// The bounding box of a set of leaf elements, taking the union of their
// individual client rects. Degenerate (zero-size, e.g. a purely structural
// spacer) leaves are skipped rather than allowed to collapse the union;
// an entirely-degenerate set (nothing left to bound) returns undefined.
function unionElementRects(elements: readonly Element[]): DrawRect | undefined {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const el of elements) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }

  if (!Number.isFinite(left) || right <= left || bottom <= top) return undefined;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

// Locates the contiguous run of leaves whose concatenated OWN text contains
// the (symbol-folded, case-folded, whitespace-STRIPPED -- not collapsed) target
// substring, returning the run as a leaf-index range [start, end). Stripped
// rather than collapsed on both sides: rendered glyph leaves carry no
// meaningful internal spacing of their own, so counting any would only ever
// misalign the offsets between the concatenation and the model's target
// string. A leaf whose folded text is empty (a purely structural node)
// contributes a zero-width span and so can never anchor a match by itself,
// but is harmlessly included if it falls inside a real match's range.
export function findLeafRun(
  leafTexts: readonly string[],
  targetText: string,
): { start: number; end: number } | undefined {
  // Folds the SAME structural exponent notation foldNotation strips (caret,
  // LaTeX braces, unicode superscripts -- none render as a glyph, so removing
  // them keeps the leaf-offset alignment intact) so a target like "5t^2"
  // locates precisely within KaTeX leaves whose textContent reads "5","t","2"
  // -- otherwise the caret fails the leaf walk and the box falls back to the
  // whole equation. Whitespace is STRIPPED, not collapsed, per this
  // function's offset-alignment contract (see the header comment).
  const fold = (value: string) =>
    foldMatchSymbols(value)
      .toLowerCase()
      .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (digit) => SUPERSCRIPT_DIGITS[digit])
      .replace(/[\^{}]/g, '')
      .replace(/\s+/g, '');
  const target = fold(targetText);
  if (!target) return undefined;

  const folded = leafTexts.map(fold);
  const offsets: number[] = [];
  let concatenated = '';
  for (const text of folded) {
    offsets.push(concatenated.length);
    concatenated += text;
  }

  const matchIndex = concatenated.indexOf(target);
  if (matchIndex === -1) return undefined;
  const matchEnd = matchIndex + target.length;

  let start = -1;
  let end = -1;
  for (let i = 0; i < offsets.length; i++) {
    const leafStart = offsets[i];
    const leafEnd = leafStart + folded[i].length;
    if (start === -1 && leafEnd > matchIndex) start = i;
    if (leafStart < matchEnd) end = i + 1;
  }

  if (start === -1 || end === -1 || start >= end) return undefined;
  return { start, end };
}

// A match spanning every leaf is really a whole-equation reference -- the
// caller already has a correct (and simpler) whole-element rect for that
// case, so sub-term resolution only returns something for a GENUINE partial
// span.
function isWholeRun(run: { start: number; end: number }, leafCount: number): boolean {
  return run.start === 0 && run.end === leafCount;
}

// KaTeX renders its visible half as '.katex-html', a flat-ish tree of glyph
// spans that (unlike MathJax's CHTML output) carry real textContent per
// leaf -- so this can walk the leaves directly.
function resolveKatexSubRect(katexEl: Element, targetText: string): DrawRect | undefined {
  const html = katexEl.querySelector('.katex-html');
  if (!html) return undefined;

  const leaves = collectLeafElements(html);
  if (leaves.length === 0) return undefined;

  const run = findLeafRun(
    leaves.map((el) => el.textContent ?? ''),
    targetText,
  );
  if (!run || isWholeRun(run, leaves.length)) return undefined;

  return unionElementRects(leaves.slice(run.start, run.end));
}

// A bare <math> node with no KaTeX/MathJax wrapper: the browser renders
// <mi>/<mn>/<mo>/<mtext> leaves natively, with real textContent and real
// rects -- same walk as KaTeX, just rooted on the <math> node itself.
function resolveMathMlSubRect(mathEl: Element, targetText: string): DrawRect | undefined {
  const leaves = collectLeafElements(mathEl);
  if (leaves.length === 0) return undefined;

  const run = findLeafRun(
    leaves.map((el) => el.textContent ?? ''),
    targetText,
  );
  if (!run || isWholeRun(run, leaves.length)) return undefined;

  return unionElementRects(leaves.slice(run.start, run.end));
}

// MathJax v3's visible CHTML tree (<mjx-math>) renders glyphs with NO
// textContent at all -- confirmed empirically on Khan Academy -- so there
// is no text to walk directly. Its assistive-MathML sibling
// (<mjx-assistive-mml><math>...) is generated from the SAME internal AST,
// in the SAME order, and DOES carry real text, so the two token sequences
// are correlated positionally: token N's text comes from the assistive
// side, token N's rect comes from the visible side. Grouped at TOKEN
// granularity (stopping the visible-tree walk at MJX-MI/MJX-MN/MJX-MO/
// MJX-MTEXT rather than descending into their per-character MJX-C
// children) so a multi-character token ("12", "sin") is one leaf on both
// sides, not a character-vs-token mismatch. The tag-shape check
// (assistive <mi> <-> visible MJX-MI, position by position) is a cheap
// extra guard against the rarer case where the two trees' orders diverge
// (e.g. some under/over-script constructs) -- a shape mismatch means the
// positional correlation isn't trustworthy, so this bails rather than
// pairing the wrong token to the wrong rect.
const MATHJAX_TOKEN_TAGS = new Set(['MJX-MI', 'MJX-MN', 'MJX-MO', 'MJX-MTEXT']);

function collectMathJaxVisibleTokens(root: Element): Element[] {
  const tokens: Element[] = [];
  const walk = (el: Element): void => {
    if (MATHJAX_TOKEN_TAGS.has(el.tagName)) {
      tokens.push(el);
      return;
    }
    for (const child of Array.from(el.children)) walk(child);
  };
  walk(root);
  return tokens;
}

function resolveMathJaxSubRect(containerEl: Element, targetText: string): DrawRect | undefined {
  const visibleRoot = containerEl.querySelector('mjx-math');
  const assistiveMath = containerEl.querySelector('mjx-assistive-mml math');
  if (!visibleRoot || !assistiveMath) return undefined;

  const visibleTokens = collectMathJaxVisibleTokens(visibleRoot);
  const assistiveTokens = collectLeafElements(assistiveMath);
  if (visibleTokens.length === 0 || visibleTokens.length !== assistiveTokens.length) return undefined;

  const sameShape = assistiveTokens.every(
    (el, i) => `MJX-${el.tagName.toUpperCase()}` === visibleTokens[i].tagName,
  );
  if (!sameShape) return undefined;

  const run = findLeafRun(
    assistiveTokens.map((el) => el.textContent ?? ''),
    targetText,
  );
  if (!run || isWholeRun(run, visibleTokens.length)) return undefined;

  return unionElementRects(visibleTokens.slice(run.start, run.end));
}

// Dispatches on the registered element's own shape -- the same shape every
// pageExtractor.ts adapter produces (a '.katex' wrapper, an 'mjx-container',
// or a bare '<math>' node) -- so no renderer identity needs to travel with
// the registry entry itself. An element none of these match (e.g. a
// data-latex/aria-label carrier widget, which has no rich internal
// structure to sub-divide) falls through to undefined, same as any other
// resolution failure.
function resolveSubTermRect(el: Element, targetText: string): DrawRect | undefined {
  try {
    if (el.classList.contains('katex')) return resolveKatexSubRect(el, targetText);
    if (el.tagName.toLowerCase() === 'mjx-container') return resolveMathJaxSubRect(el, targetText);
    if (el.tagName.toLowerCase() === 'math') return resolveMathMlSubRect(el, targetText);
    return undefined;
  } catch (err) {
    console.debug('[calyxa annotations] sub-term resolution threw; falling back to whole equation', err);
    return undefined;
  }
}

// True when target.text is an exact (normalised) reproduction of one of the
// equation's OWN fields -- i.e. the model referenced the whole equation, not
// a piece of it. Sub-term resolution is only attempted for a target that
// ISN'T this -- an exact whole-equation reference already has a correct,
// simpler answer (the whole element's rect).
function isExactEquationReference(targetText: string, equation: PageEquation): boolean {
  const target = normalizeMatchText(targetText);
  return [equation.latex, equation.mathml, equation.text]
    .filter((field): field is string => typeof field === 'string')
    .some((field) => normalizeMatchText(field) === target);
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
    //    A target that names only PART of the equation (not an exact
    //    reproduction of one of its fields) tries the sub-term leaf-walk
    //    FIRST, for a tight rect around just that part; a whole-equation
    //    reference, or a sub-term walk that can't confidently resolve,
    //    uses the whole element's rect exactly as before.
    if (target.text) {
      for (const entry of matchRegistryEntries(target.text, registry)) {
        const el = entry.element;
        if (el && isElementVisible(el)) {
          if (!isExactEquationReference(target.text, entry.equation)) {
            const subRect = resolveSubTermRect(el, target.text);
            if (subRect) {
              return { rect: subRect, anchor: { kind: 'sub-term', element: el, targetText: target.text } };
            }
          }
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

// Resolves + caps a turn's raw annotations against the registry (shared by
// showTurnAnnotations and its voice-sequenced variant below), WITHOUT
// touching module state or starting any timers -- each caller decides how
// and when a resolved entry actually becomes active (all at once, or one
// at a time). Drop-on-miss and over-cap diagnostics are logged here once,
// so both callers get the same console.debug behaviour for free.
function resolveCappedAnnotations(
  annotations: Annotation[],
  registry: EquationRegistry,
  turnLabel: number,
): { annotation: Annotation; rect: DrawRect; anchor: ResolvedAnchor }[] {
  const capped = annotations.slice(0, MAX_ANNOTATIONS_PER_TURN);
  if (annotations.length > capped.length) {
    console.debug(
      `[calyxa annotations] turn ${turnLabel}: ${annotations.length - capped.length} over the per-turn cap, dropped`,
    );
  }

  const resolved: { annotation: Annotation; rect: DrawRect; anchor: ResolvedAnchor }[] = [];
  for (const annotation of capped) {
    const target = resolveTarget(annotation.target, registry);
    if (!target) {
      console.debug('[calyxa annotations] dropped (unresolvable target)', {
        id: annotation.id,
        type: annotation.type,
        kind: annotation.target.kind,
        text: annotation.target.text,
      });
      continue;
    }
    resolved.push({ annotation, rect: target.rect, anchor: target.anchor });
  }
  return resolved;
}

let active: ActiveAnnotation[] = [];
let currentRegistry: EquationRegistry = [];
let turnCounter = 0;
let listening = false;
let rafHandle: number | null = null;

// The reveal-ladder timers for an in-flight voice-mode sequence
// (showTurnAnnotationsSequenced below) -- tracked separately from each
// entry's own ttl timer above (sequenced mode doesn't use per-annotation
// ttl; the time slice itself is the lifetime) so a new turn or a
// clear/teardown can cancel a still-running sequence cleanly via the same
// resetActive() choke point every other reset already goes through.
let sequenceTimers: ReturnType<typeof setTimeout>[] = [];

function clearSequenceTimers(): void {
  for (const timer of sequenceTimers) clearTimeout(timer);
  sequenceTimers = [];
}

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
  clearSequenceTimers();
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
  } else if (anchor.kind === 'sub-term') {
    // Re-run the SAME leaf walk against the still-connected equation --
    // the equation can reflow (line-wrap, font load) between re-anchor
    // passes, so the sub-rect is re-derived, not just re-read. A walk that
    // fails on re-anchor (e.g. the renderer replaced its internal DOM on a
    // re-render) degrades to the whole equation's rect rather than
    // dropping outright -- the element itself is still live and correct,
    // just at coarser precision.
    if (isElementVisible(anchor.element)) {
      const rect = resolveSubTermRect(anchor.element, anchor.targetText);
      if (rect) return { ...entry, rect };
      return {
        ...entry,
        rect: rectOfElement(anchor.element),
        anchor: { kind: 'element', element: anchor.element },
      };
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

    for (const { annotation, rect, anchor } of resolveCappedAnnotations(annotations, registry, turnCounter)) {
      const entry: ActiveAnnotation = { annotation, rect, anchor, timer: undefined };
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
 * Voice-mode variant of showTurnAnnotations (item 2 of the live Task 9
 * follow-up: "change which term is circled as the tutor speaks, not show
 * everything it will eventually mention"). Resolves the turn's annotations
 * exactly as showTurnAnnotations does, then -- when there are 2 or more --
 * reveals them ONE AT A TIME, each getting an even share of
 * `totalDurationMs` (the synthesised speech's known duration) before the
 * next replaces it, chosen (over per-annotation model-estimated timing)
 * for shipping without a prompt/schema change and because the model has no
 * reliable way to predict its own TTS pacing anyway. Falls back to the
 * normal simultaneous display when there are 0 or 1 resolvable annotations
 * (nothing to sequence) or no usable duration. Per-annotation ttlMs is
 * ignored in sequenced mode -- the time slice itself is the entry's
 * lifetime; the LAST slice's annotation is left showing once its slice
 * elapses (same persist-until-replaced default as ttlMs 0) rather than
 * auto-clearing the instant speech ends. Re-anchoring (scroll/resize)
 * keeps working throughout: only ONE entry is ever in `active` at a time,
 * so the existing listener/dispatch machinery tracks whichever one is
 * currently showing exactly as it would for any other turn.
 */
export function showTurnAnnotationsSequenced(
  annotations: Annotation[],
  registry: EquationRegistry,
  totalDurationMs: number,
): void {
  try {
    resetActive();
    currentRegistry = registry;
    turnCounter += 1;

    const resolved = resolveCappedAnnotations(annotations, registry, turnCounter);

    if (resolved.length <= 1 || !(totalDurationMs > 0)) {
      for (const { annotation, rect, anchor } of resolved) {
        active.push({ annotation, rect, anchor, timer: undefined });
      }
      setListeners(active.length > 0);
      dispatchActive();
      return;
    }

    const sliceMs = totalDurationMs / resolved.length;

    const showSlice = (index: number): void => {
      const { annotation, rect, anchor } = resolved[index];
      active = [{ annotation, rect, anchor, timer: undefined }];
      setListeners(true);
      dispatchActive();
    };

    showSlice(0);
    for (let i = 1; i < resolved.length; i++) {
      sequenceTimers.push(setTimeout(() => showSlice(i), sliceMs * i));
    }
  } catch (err) {
    console.debug('[calyxa annotations] sequenced controller error; clearing', err);
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
