import type { PageContext, PageEquation } from '../types/messages';

// Calyxa page extractor (Sprint 07, Task 5).
//
// READ-ONLY. Browser-only -- no chrome.* import, no mutation, no
// persistence (DOM policy, ADR-012). Runs in the content-script context on
// overlay open (Task 6) and returns a single bounded PageContext snapshot;
// the caller re-runs this on every open rather than caching it.
//
// Reads, per-renderer adapter, in priority order: KaTeX (LaTeX annotation),
// MathJax v3 (mjx-container + the preserved math/tex source script when
// present), known data-*/aria-label LaTeX carriers, any remaining plain
// MathML <math> node, a KaTeX html-only-output fallback (see below), and
// finally the page's visible text. MathJax/KaTeX expose LaTeX inconsistently
// across versions/configs (named risk, PLAN §2.10) -- when an adapter can't
// find a LaTeX source it falls back to the node's MathML or text rather than
// guessing; Task 7 verifies against real sites and an empty PageContext
// ({ equations: [] }) is the correct result for an image/canvas-only page.
//
// Real-world bug, found on Khan Academy: KaTeX's DEFAULT output mode
// ('htmlAndMathml') renders both a visible '.katex-html' span tree AND a
// '<math>'/'<annotation>' MathML pair the KaTeX adapter above reads -- but a
// site can configure KaTeX for 'html'-only output (common perf optimisation:
// MathML roughly doubles the rendered DOM), which drops BOTH the
// '<annotation>' and the '<math>' node entirely, leaving nothing for either
// the KaTeX or plain-MathML adapter to find. Khan Academy does exactly this:
// it generates its own accessible description text from the KaTeX parse
// tree "instead of relying on MathML" (rather than emitting MathML for
// screen readers) -- and that generated text is commonly placed off-screen
// (a visually-hidden/"sr-only" pattern), which `extractVisibleText`'s
// innerText read -- CSS-visibility-aware by definition -- never picks up
// either. The result was a page with real, on-screen math reading back as a
// fully empty PageContext: not "nothing to read" (the correct ADR-012
// result for an image/canvas-only page) but "couldn't read it." The
// extractKatexTextFallback adapter below closes this gap generically (not
// a Khan-Academy-specific hack): read the '.katex' wrapper's OWN
// `textContent` -- not innerText -- so it recovers real DOM text regardless
// of any visibility trick, only for wrappers the stronger adapters above
// found nothing inside.
//
// Every query below excludes the <calyxa-overlay> shadow host and its
// subtree (ADR-002) so the overlay's own UI is never read back as page
// content.
//
// Sprint 12 (ADR-022): each extracted equation now also records the source
// Element it was read from, returned PARALLEL to context.equations (same
// index = same equation) as the annotation resolver's registry: a textMatch
// target whose text equals a captured equation resolves to this element's
// live rect instead of a page-wide search. The elements are in-memory
// content-script state ONLY -- they never serialize, never ride a
// chrome.runtime message, and never persist (ADR-023); the wire PageContext
// shape is untouched. Each adapter records its VISIBLE rendered element
// (e.g. the '.katex' wrapper, not the visually-hidden <annotation> the
// LaTeX was read from) so a draw-time getBoundingClientRect lands on what
// the student actually sees. Still read-only: recording a reference reads
// nothing further and writes nothing.

const OVERLAY_HOST_TAG = 'calyxa-overlay';

// One extracted equation paired with the element it was read from -- the
// pairing is internal to this file; extractPageContext splits it into the
// wire-shape equations array and the parallel element registry at the end,
// AFTER the shared cap, so the two can never fall out of lockstep.
type ExtractedEquation = { equation: PageEquation; element: Element | null };

// Mirrors /web/lib/ai/page-context.ts's authoritative budget constants
// (Task 2). These are a courtesy client-side cap only -- renderPageContext
// re-applies (and enforces) the same budget server-side, so a huge/flaky
// page here degrades the prompt, it can never blow the server's budget.
const MAX_EQUATIONS = 12;
const MAX_EQUATION_CHARS = 400;
const MAX_TEXT_CHARS = 2000;
const MAX_TITLE_CHARS = 200;

function isInsideOverlay(el: Element): boolean {
  return el.closest(OVERLAY_HOST_TAG) !== null;
}

// --- shadow-DOM-aware document walk ---------------------------------------
// Real-world bug, found on Khan Academy: `document.querySelectorAll` and
// `Element.innerText` never cross a shadow boundary from OUTSIDE it, by
// spec. The overlay's own shadow root is the one the rest of this file is
// built to exclude (ADR-002), but the host page is free to attach its OWN
// open shadow roots to its own elements -- a growing pattern for
// component-library/widget code -- and Khan Academy does exactly that for
// (part of) its exercise content. The previous document-only queries read
// zero equations and zero text there not because the page had none, but
// because the read boundary was too narrow: a real regression from
// "nothing to read" (the correct empty-page result, ADR-012) to "couldn't
// read it." This walk collects every OPEN shadow root reachable from the
// document (recursively, since a shadow root can itself contain further
// shadow hosts), skipping the overlay's own host entirely so its content is
// never revisited. A CLOSED shadow root is unreadable by design -- no
// read-only workaround exists for that case, and none is attempted here.
function collectShadowRoots(root: ParentNode, into: ShadowRoot[]): void {
  for (const el of root.querySelectorAll('*')) {
    if (el.tagName.toLowerCase() === OVERLAY_HOST_TAG) continue;
    const shadow = el.shadowRoot;
    if (shadow) {
      into.push(shadow);
      collectShadowRoots(shadow, into);
    }
  }
}

// Computed once per extractPageContext() call (not once per adapter) so the
// (rare, but page-size-proportional) recursive sweep above happens a single
// time per overlay open.
//
// Exported for problemScanner.ts (the v4 homework-session scan), which needs
// the IDENTICAL read boundary this file established -- every open host-page
// shadow root, the overlay's own subtree never revisited, closed roots
// unreadable by design. One walk definition, two readers.
export function collectSearchRoots(): (Document | ShadowRoot)[] {
  const shadowRoots: ShadowRoot[] = [];
  collectShadowRoots(document, shadowRoots);
  return [document, ...shadowRoots];
}

// Exported alongside collectSearchRoots for problemScanner.ts -- same reason:
// the overlay-exclusion rule (ADR-002) must have exactly one definition.
export function queryExcludingOverlay<E extends Element>(
  selector: string,
  roots: (Document | ShadowRoot)[],
): E[] {
  const results: E[] = [];
  for (const root of roots) {
    for (const el of root.querySelectorAll<E>(selector)) {
      if (!isInsideOverlay(el)) results.push(el);
    }
  }
  return results;
}

// Slices to max - 1 + the ellipsis so the RESULT is exactly `max` chars,
// never max + 1 -- the server's parsePageContext rejects (and drops the
// WHOLE pageContext for) any field over its cap, so an off-by-one here
// would silently blank out an otherwise-valid capture.
function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

// --- KaTeX adapter --------------------------------------------------------
// KaTeX renders a <math> tree AND a parallel <annotation
// encoding="application/x-tex"> holding the original source -- the same
// equation twice. We read the annotation (cleaner and more useful to the
// tutor than raw MathML) and mark the enclosing <math> as claimed so the
// plain-MathML pass below skips it.
//
// Registry element (ADR-022): the outermost '.katex' wrapper, NOT the
// annotation or its <math> ancestor -- in KaTeX's default htmlAndMathml
// output the MathML half (annotation included) is rendered visually hidden
// and the '.katex-html' half is what the student sees, so only the shared
// wrapper's rect is drawable. A bare <annotation> with no '.katex' ancestor
// (a page hand-authoring MathML+annotation with no KaTeX at all) anchors to
// its <math> node instead, which IS the visible render in that case.
function extractKatexEquations(claimed: Set<Element>, roots: (Document | ShadowRoot)[]): ExtractedEquation[] {
  const equations: ExtractedEquation[] = [];

  for (const annotation of queryExcludingOverlay<Element>(
    'annotation[encoding="application/x-tex"]',
    roots,
  )) {
    const latex = annotation.textContent?.trim();
    if (!latex) continue;

    const mathNode = annotation.closest('math');
    if (mathNode) claimed.add(mathNode);

    equations.push({
      equation: { latex },
      element: annotation.closest('.katex') ?? mathNode,
    });
  }

  return equations;
}

// --- MathJax v3 adapter ----------------------------------------------------
// MathJax v3 wraps each equation in <mjx-container>. Some configs leave the
// original <script type="math/tex"> immediately before it -- the cleanest
// LaTeX source when present. Otherwise we fall back to the assistive
// MathML MathJax renders inside the container for screen readers. Either
// way the container's <math> node (if any) is claimed so it is never
// double-counted by the plain-MathML pass below.
//
// Sprint 10 Task 10 (found on Khan Academy): some MathJax integrations skip
// the standard MathML output entirely and instead put the human-readable
// speech text straight on the container's aria-label -- MathJax's own
// documented accessibility convention (aria-label on the outermost rendered
// element), used by renderers layered on top of MathJax that generate their
// own accessible text rather than relying on MathJax's default MathML. A
// last-resort fallback, tried only after both stronger sources come up
// empty, and still scoped to a real mjx-container so it can't pick up
// unrelated aria-labels elsewhere on the page.
function extractMathJaxEquations(claimed: Set<Element>, roots: (Document | ShadowRoot)[]): ExtractedEquation[] {
  const equations: ExtractedEquation[] = [];

  // Registry element (ADR-022): always the mjx-container itself -- it is
  // the visible rendered equation in every branch below, including the
  // aria-label one (where the LaTeX/MathML source is elsewhere or absent
  // but the container is still what's on screen).
  for (const container of queryExcludingOverlay<Element>('mjx-container', roots)) {
    const mathNode = container.querySelector('math');
    if (mathNode) claimed.add(mathNode);

    let latex: string | undefined;
    const sourceScript = container.previousElementSibling;
    if (
      sourceScript !== null &&
      sourceScript.tagName === 'SCRIPT' &&
      sourceScript.getAttribute('type') === 'math/tex'
    ) {
      latex = sourceScript.textContent?.trim() || undefined;
    }

    if (latex) {
      equations.push({ equation: { latex }, element: container });
    } else if (mathNode) {
      equations.push({
        equation: { mathml: mathNode.outerHTML, text: mathNode.textContent?.trim() || undefined },
        element: container,
      });
    } else {
      const ariaLabel = container.getAttribute('aria-label')?.trim();
      if (ariaLabel) equations.push({ equation: { text: ariaLabel }, element: container });
    }
  }

  return equations;
}

// --- data-*/aria-label carriers ---------------------------------------------
// A handful of smaller math widgets skip the KaTeX/MathJax DOM shape
// entirely and stash the source directly on the element instead.
function extractDataCarrierEquations(roots: (Document | ShadowRoot)[]): ExtractedEquation[] {
  const equations: ExtractedEquation[] = [];

  // Registry element (ADR-022): the carrier element itself -- for these
  // widgets the element holding the data-*/aria-label attribute IS the
  // rendered equation.
  for (const el of queryExcludingOverlay<HTMLElement>('[data-latex], [data-tex]', roots)) {
    const latex = (el.dataset.latex ?? el.dataset.tex)?.trim();
    if (latex) equations.push({ equation: { latex }, element: el });
  }

  for (const el of queryExcludingOverlay<HTMLElement>('[role="math"][aria-label]', roots)) {
    const label = el.getAttribute('aria-label')?.trim();
    if (label) equations.push({ equation: { latex: label }, element: el });
  }

  return equations;
}

// --- plain MathML adapter ---------------------------------------------------
// Whatever <math> nodes neither the KaTeX nor the MathJax adapter already
// claimed -- a page that renders MathML directly with no JS renderer.
function extractRemainingMathml(claimed: Set<Element>, roots: (Document | ShadowRoot)[]): ExtractedEquation[] {
  const equations: ExtractedEquation[] = [];

  // Registry element (ADR-022): the <math> node itself -- with no JS
  // renderer in play it is the visible render.
  for (const mathNode of queryExcludingOverlay<Element>('math', roots)) {
    if (claimed.has(mathNode)) continue;
    equations.push({
      equation: { mathml: mathNode.outerHTML, text: mathNode.textContent?.trim() || undefined },
      element: mathNode,
    });
  }

  return equations;
}

// --- KaTeX html-only-output fallback (see the file-header note above) ------
// Every KaTeX render wraps its output in one outermost '.katex' element.
// When MathML output is enabled (KaTeX's default) that wrapper also contains
// an '<annotation>'/'<math>' pair -- already claimed by extractKatexEquations
// or picked up by extractRemainingMathml above, so this adapter SKIPS any
// '.katex' wrapper that still contains either (avoiding a double-counted
// equation). What's left is exactly the 'html'-only-output case: read the
// wrapper's own `textContent`. This deliberately ignores visibility (unlike
// innerText) so an accessible description a site renders off-screen -- the
// Khan Academy pattern this was found against -- still comes through. It is
// inherently a WEAKER signal than a real LaTeX/MathML source (KaTeX's HTML
// rendering can omit whitespace between terms, and purely CSS/SVG-drawn
// glyphs such as some radicals contribute no text at all) -- named risk,
// same category as the file-header's "MathJax/KaTeX expose LaTeX
// inconsistently" note -- but a garbled transcription the tutor can still
// reason about beats an empty PageContext on a page with real on-screen math.
function extractKatexTextFallback(roots: (Document | ShadowRoot)[]): ExtractedEquation[] {
  const equations: ExtractedEquation[] = [];

  // Registry element (ADR-022): the '.katex' wrapper -- the visible render
  // in the html-only-output case this adapter exists for. (The sprint plan
  // guessed this adapter might have no single element; it does -- the
  // wrapper is exactly one element per equation.)
  for (const katexEl of queryExcludingOverlay<HTMLElement>('.katex', roots)) {
    // KaTeX does not nest '.katex' wrappers for sub-expressions (fractions,
    // radicals, etc. get their own internal classes) -- but guard anyway so
    // a '.katex' found inside another one is never double-read.
    if (katexEl.parentElement?.closest('.katex')) continue;
    if (katexEl.querySelector('annotation[encoding="application/x-tex"], math')) continue;

    const text = katexEl.textContent?.trim();
    if (text) equations.push({ equation: { text }, element: katexEl });
  }

  return equations;
}

// --- image-rendered equations (alt text / accessible labels) ---------------
// The 2026-07-16 detection fix's client half: many real problem pages render
// the equation as an <img> (textbook scans, LaTeX-to-PNG pipelines, IXL-style
// exercise engines) or an aria-labelled SVG/widget -- zero DOM text, so every
// adapter above finds nothing, the plausible-problem gate fails, and the
// opening scan never even fires ("it doesn't trigger at all"). The image's
// accessible text (alt / aria-label) is regular DOM data and reading it is
// exactly as read-only as every other adapter here -- this is NOT diagram
// understanding (out of V1 scope): no pixels are read, only the page's own
// text description of the image. Gated by a cheap math-likeness test so page
// chrome ("Company logo", "Profile photo") never pollutes the capture.
//
// Registry element (ADR-022): the <img>/labelled element itself -- it IS the
// visible render, so annotations can anchor to image-rendered equations too.
const MAX_IMAGE_EQUATIONS = 6;
const MIN_ALT_CHARS = 3;

// Math-likeness: an explicit operator/relation between values, a
// superscript/root/fraction marker, or problem-language naming math work.
// Deliberately conservative -- a miss degrades to today's behavior, while a
// false positive would feed page chrome to the model on every scan.
export function looksLikeMathText(text: string): boolean {
  if (text.length < MIN_ALT_CHARS) return false;
  return (
    /[=≤≥≠±√∫Σπ∞^]/.test(text) ||
    /\d\s*[+\-*/×÷]\s*\d/.test(text) ||
    /\b(equation|expression|fraction|polynomial|quadratic|derivative|integral|solve|simplify|factor|graph of|slope|angle|triangle|squared|cubed|square root)\b/i.test(text)
  );
}

function extractImageAltEquations(roots: (Document | ShadowRoot)[]): ExtractedEquation[] {
  const equations: ExtractedEquation[] = [];

  for (const img of queryExcludingOverlay<HTMLImageElement>('img[alt]', roots)) {
    if (equations.length >= MAX_IMAGE_EQUATIONS) break;
    const alt = img.getAttribute('alt')?.trim();
    if (alt && looksLikeMathText(alt)) {
      equations.push({ equation: { text: alt }, element: img });
    }
  }

  // Accessible non-<img> renders (SVG plots, canvas widgets a site labels
  // for screen readers). role="math" carriers were already claimed above;
  // this only reads role="img" -- the shape KaTeX/MathJax never use.
  for (const el of queryExcludingOverlay<HTMLElement>('[role="img"][aria-label]', roots)) {
    if (equations.length >= MAX_IMAGE_EQUATIONS) break;
    const label = el.getAttribute('aria-label')?.trim();
    if (label && looksLikeMathText(label)) {
      equations.push({ equation: { text: label }, element: el });
    }
  }

  return equations;
}

// --- visible text ------------------------------------------------------------
// innerText (not textContent) so script/style/hidden content is excluded --
// it follows rendered layout. innerText computed on an ancestor does NOT
// cross a descendant's shadow boundary (the opposite of the old comment
// here, which had it backwards) -- so it already excludes the overlay's own
// shadow-hosted content with no manual filtering needed, since the overlay
// is mounted as the last child of <html>, a sibling of <body>, never inside
// it (see content/index.ts). What it also excludes, by the same rule, is
// legitimate page content the host renders inside ITS OWN shadow roots
// (see collectShadowRoots above) -- shadowAwareInnerText patches that gap
// back in, recursively, while still explicitly skipping <calyxa-overlay>.
function shadowAwareInnerText(node: Element | Document): string {
  const ownText = node instanceof Element ? (node as HTMLElement).innerText ?? '' : '';
  const nested: string[] = [];

  for (const el of node.querySelectorAll('*')) {
    if (el.tagName.toLowerCase() === OVERLAY_HOST_TAG) continue;
    const shadow = el.shadowRoot;
    if (!shadow) continue;
    for (const child of Array.from(shadow.children)) {
      nested.push(shadowAwareInnerText(child));
    }
  }

  return nested.length ? [ownText, ...nested].join('\n') : ownText;
}

// Prefers <main>/<article> (the usual landmark for the actual page content),
// but falls back to <body> when that landmark is present yet empty --
// e.g. a skip-link target or a layout shell the framework leaves nearly
// bare while the real content mounts elsewhere in the body. Without this,
// an empty-but-present <main> would win outright (the old `??` only fell
// back when NO match existed at all) and silently blank out an otherwise
// readable page.
function extractVisibleText(): string | undefined {
  const candidate = document.querySelector('main, article');
  const candidateText = candidate ? shadowAwareInnerText(candidate) : '';
  const raw = collapseWhitespace(candidateText) ? candidateText : shadowAwareInnerText(document.body);

  const collapsed = collapseWhitespace(raw);
  return collapsed ? truncate(collapsed, MAX_TEXT_CHARS) : undefined;
}

// What extractPageContext returns as of Sprint 12 (ADR-022): the wire-shape
// PageContext (unchanged, this is what rides the AI_TURN payload) plus the
// equation-element registry -- equationElements[i] is the source element of
// context.equations[i]. The registry stays in the content script: elements
// cannot serialize, and by design they never cross the messaging boundary
// or persist anywhere (ADR-023).
export type PageExtraction = {
  context: PageContext;
  equationElements: (Element | null)[];
};

// ---- The 5b reframe tool's crop-rect read (design handoff, Sprint 15) ----

// Bounds the snippet the reframe tool quotes into the session-start turn --
// a crop is by definition "the exact part", so this is deliberately much
// smaller than MAX_TEXT_CHARS (the server's own budget re-applies anyway).
export const MAX_SNIPPET_CHARS = 600;

export type ViewportRect = { x: number; y: number; w: number; h: number };

function rectsIntersect(a: ViewportRect, b: DOMRect): boolean {
  return b.left < a.x + a.w && b.right > a.x && b.top < a.y + a.h && b.bottom > a.y;
}

function collectTextInRect(root: ParentNode, rect: ViewportRect, into: string[]): void {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = (node as Text).parentElement;
    if (!parent || isInsideOverlay(parent)) continue;
    const raw = node.textContent;
    if (!raw || !raw.trim()) continue;
    const range = doc.createRange();
    range.selectNodeContents(node);
    // Client rects are viewport-space, the same coordinate space the crop
    // rect arrives in (the reframe layer is fixed-positioned) -- no offset
    // math, the AnnotationLayer's own coordinate discipline.
    for (const clientRect of range.getClientRects()) {
      if (clientRect.width > 0 && clientRect.height > 0 && rectsIntersect(rect, clientRect)) {
        into.push(raw);
        break;
      }
    }
  }
}

/**
 * READ-ONLY, like everything in this file: the visible text intersecting a
 * viewport-space rect -- what the reframe tool (design 5b) attaches as the
 * "Snippet · Cropped from this page". Walks the document plus every OPEN
 * host-page shadow root (the same boundary rules as extractPageContext:
 * the overlay's own subtree is excluded, closed shadow roots are unreadable
 * by design), collecting text nodes whose rendered rects intersect the
 * crop. Returns '' when the crop holds no readable text (an image/diagram
 * region) -- the caller words the turn around that honestly rather than
 * quoting nothing (session-flow.ts's buildReframeStartMessage).
 */
export function extractTextInRect(rect: ViewportRect): string {
  const pieces: string[] = [];
  for (const root of collectSearchRoots()) {
    collectTextInRect(root, rect, pieces);
  }
  const collapsed = collapseWhitespace(pieces.join(' '));
  return collapsed ? truncate(collapsed, MAX_SNIPPET_CHARS) : '';
}

// The main export -- a synchronous, read-only pass over the host page.
// Returns an EMPTY PageContext ({ equations: [] }, no text, no registry
// entries) when nothing math-like or textual is found (e.g. an
// image/canvas-only page), so the caller's prompt falls back to "ask the
// student to type it" rather than inventing a read (ADR-012).
export function extractPageContext(): PageExtraction {
  const claimed = new Set<Element>();
  const roots = collectSearchRoots();

  // Cap the PAIRS, then split -- the same slice bounds both halves, so the
  // wire equations and the element registry cannot fall out of lockstep.
  const extracted = [
    ...extractKatexEquations(claimed, roots),
    ...extractMathJaxEquations(claimed, roots),
    ...extractDataCarrierEquations(roots),
    ...extractRemainingMathml(claimed, roots),
    ...extractKatexTextFallback(roots),
    // Weakest signal last (an accessible DESCRIPTION of the math, not its
    // source), so real LaTeX/MathML always wins the shared cap.
    ...extractImageAltEquations(roots),
  ].slice(0, MAX_EQUATIONS);

  const equations = extracted.map(({ equation }) => ({
    ...(equation.latex ? { latex: truncate(equation.latex, MAX_EQUATION_CHARS) } : {}),
    ...(equation.mathml ? { mathml: truncate(equation.mathml, MAX_EQUATION_CHARS) } : {}),
    ...(equation.text ? { text: truncate(equation.text, MAX_EQUATION_CHARS) } : {}),
  }));

  const equationElements = extracted.map(({ element }) => element);

  const title = document.title ? truncate(document.title, MAX_TITLE_CHARS) : undefined;
  const text = extractVisibleText();

  return {
    context: {
      ...(title ? { title } : {}),
      ...(text ? { text } : {}),
      equations,
    },
    equationElements,
  };
}
