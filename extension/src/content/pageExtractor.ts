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
// present), known data-*/aria-label LaTeX carriers, then any remaining
// plain MathML <math> node, and finally the page's visible text. MathJax/
// KaTeX expose LaTeX inconsistently across versions/configs (named risk,
// PLAN §2.10) -- when an adapter can't find a LaTeX source it falls back to
// the node's MathML or text rather than guessing; Task 7 verifies against
// real sites and an empty PageContext ({ equations: [] }) is the correct
// result for an image/canvas-only page.
//
// Every query below excludes the <calyxa-overlay> shadow host and its
// subtree (ADR-002) so the overlay's own UI is never read back as page
// content.

const OVERLAY_HOST_TAG = 'calyxa-overlay';

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
function collectSearchRoots(): (Document | ShadowRoot)[] {
  const shadowRoots: ShadowRoot[] = [];
  collectShadowRoots(document, shadowRoots);
  return [document, ...shadowRoots];
}

function queryExcludingOverlay<E extends Element>(
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
function extractKatexEquations(claimed: Set<Element>, roots: (Document | ShadowRoot)[]): PageEquation[] {
  const equations: PageEquation[] = [];

  for (const annotation of queryExcludingOverlay<Element>(
    'annotation[encoding="application/x-tex"]',
    roots,
  )) {
    const latex = annotation.textContent?.trim();
    if (!latex) continue;

    const mathNode = annotation.closest('math');
    if (mathNode) claimed.add(mathNode);

    equations.push({ latex });
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
function extractMathJaxEquations(claimed: Set<Element>, roots: (Document | ShadowRoot)[]): PageEquation[] {
  const equations: PageEquation[] = [];

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
      equations.push({ latex });
    } else if (mathNode) {
      equations.push({ mathml: mathNode.outerHTML, text: mathNode.textContent?.trim() || undefined });
    } else {
      const ariaLabel = container.getAttribute('aria-label')?.trim();
      if (ariaLabel) equations.push({ text: ariaLabel });
    }
  }

  return equations;
}

// --- data-*/aria-label carriers ---------------------------------------------
// A handful of smaller math widgets skip the KaTeX/MathJax DOM shape
// entirely and stash the source directly on the element instead.
function extractDataCarrierEquations(roots: (Document | ShadowRoot)[]): PageEquation[] {
  const equations: PageEquation[] = [];

  for (const el of queryExcludingOverlay<HTMLElement>('[data-latex], [data-tex]', roots)) {
    const latex = (el.dataset.latex ?? el.dataset.tex)?.trim();
    if (latex) equations.push({ latex });
  }

  for (const el of queryExcludingOverlay<HTMLElement>('[role="math"][aria-label]', roots)) {
    const label = el.getAttribute('aria-label')?.trim();
    if (label) equations.push({ latex: label });
  }

  return equations;
}

// --- plain MathML adapter ---------------------------------------------------
// Whatever <math> nodes neither the KaTeX nor the MathJax adapter already
// claimed -- a page that renders MathML directly with no JS renderer.
function extractRemainingMathml(claimed: Set<Element>, roots: (Document | ShadowRoot)[]): PageEquation[] {
  const equations: PageEquation[] = [];

  for (const mathNode of queryExcludingOverlay<Element>('math', roots)) {
    if (claimed.has(mathNode)) continue;
    equations.push({ mathml: mathNode.outerHTML, text: mathNode.textContent?.trim() || undefined });
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

// The sole export -- a synchronous, read-only pass over the host page.
// Returns an EMPTY PageContext ({ equations: [] }, no text) when nothing
// math-like or textual is found (e.g. an image/canvas-only page), so the
// caller's prompt falls back to "ask the student to type it" rather than
// inventing a read (ADR-012).
export function extractPageContext(): PageContext {
  const claimed = new Set<Element>();
  const roots = collectSearchRoots();

  const equations = [
    ...extractKatexEquations(claimed, roots),
    ...extractMathJaxEquations(claimed, roots),
    ...extractDataCarrierEquations(roots),
    ...extractRemainingMathml(claimed, roots),
  ]
    .slice(0, MAX_EQUATIONS)
    .map((equation) => ({
      ...(equation.latex ? { latex: truncate(equation.latex, MAX_EQUATION_CHARS) } : {}),
      ...(equation.mathml ? { mathml: truncate(equation.mathml, MAX_EQUATION_CHARS) } : {}),
      ...(equation.text ? { text: truncate(equation.text, MAX_EQUATION_CHARS) } : {}),
    }));

  const title = document.title ? truncate(document.title, MAX_TITLE_CHARS) : undefined;
  const text = extractVisibleText();

  return {
    ...(title ? { title } : {}),
    ...(text ? { text } : {}),
    equations,
  };
}
