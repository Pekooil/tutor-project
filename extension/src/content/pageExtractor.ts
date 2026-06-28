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

function queryExcludingOverlay<E extends Element>(selector: string): E[] {
  return Array.from(document.querySelectorAll<E>(selector)).filter((el) => !isInsideOverlay(el));
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
function extractKatexEquations(claimed: Set<Element>): PageEquation[] {
  const equations: PageEquation[] = [];

  for (const annotation of queryExcludingOverlay<Element>('annotation[encoding="application/x-tex"]')) {
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
function extractMathJaxEquations(claimed: Set<Element>): PageEquation[] {
  const equations: PageEquation[] = [];

  for (const container of queryExcludingOverlay<Element>('mjx-container')) {
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
    }
  }

  return equations;
}

// --- data-*/aria-label carriers ---------------------------------------------
// A handful of smaller math widgets skip the KaTeX/MathJax DOM shape
// entirely and stash the source directly on the element instead.
function extractDataCarrierEquations(): PageEquation[] {
  const equations: PageEquation[] = [];

  for (const el of queryExcludingOverlay<HTMLElement>('[data-latex], [data-tex]')) {
    const latex = (el.dataset.latex ?? el.dataset.tex)?.trim();
    if (latex) equations.push({ latex });
  }

  for (const el of queryExcludingOverlay<HTMLElement>('[role="math"][aria-label]')) {
    const label = el.getAttribute('aria-label')?.trim();
    if (label) equations.push({ latex: label });
  }

  return equations;
}

// --- plain MathML adapter ---------------------------------------------------
// Whatever <math> nodes neither the KaTeX nor the MathJax adapter already
// claimed -- a page that renders MathML directly with no JS renderer.
function extractRemainingMathml(claimed: Set<Element>): PageEquation[] {
  const equations: PageEquation[] = [];

  for (const mathNode of queryExcludingOverlay<Element>('math')) {
    if (claimed.has(mathNode)) continue;
    equations.push({ mathml: mathNode.outerHTML, text: mathNode.textContent?.trim() || undefined });
  }

  return equations;
}

// --- visible text ------------------------------------------------------------
// innerText (not textContent) so script/style/hidden content is excluded --
// it follows rendered layout, which is also why the <calyxa-overlay> host
// must be excluded explicitly: innerText computed on an ancestor crosses
// shadow boundaries of any descendant shadow root. The overlay is mounted
// as the last child of <html> -- a sibling of <body>, never inside it (see
// content/index.ts) -- so in practice it is never a descendant of this
// root at all; the child filter below is defense-in-depth for the case
// where it is (e.g. a future anchor change), not the only guard.
function extractVisibleText(): string | undefined {
  const root = document.querySelector('main, article') ?? document.body;
  const overlay = root.querySelector(OVERLAY_HOST_TAG);

  const raw = overlay
    ? Array.from(root.children)
        .filter((child) => child !== overlay)
        .map((child) => (child as HTMLElement).innerText ?? '')
        .join('\n')
    : (root as HTMLElement).innerText ?? '';

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

  const equations = [
    ...extractKatexEquations(claimed),
    ...extractMathJaxEquations(claimed),
    ...extractDataCarrierEquations(),
    ...extractRemainingMathml(claimed),
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
