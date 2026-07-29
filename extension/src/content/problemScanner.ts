import { collectSearchRoots, queryExcludingOverlay } from './pageExtractor';

// The v4 homework-session scan (spec §1). READ-ONLY, browser-only, and
// deliberately MODEL-FREE: this file counts the problems on the page and
// decides whether the page exposes correctness. It never solves anything and
// never sends a byte anywhere.
//
// Why that matters, verbatim from the spec: the scan reveal is the moment the
// feature is selling, so enumeration must be local DOM work with zero model
// calls (target under 1.5s from tap to opener, hard ceiling 4s). Concept
// identification is the ONE thing allowed a model call, and it happens
// elsewhere -- the existing OPENING_SCAN transport -- so the count can be
// shown the instant this returns and the concept name can fill in after (or
// never, on a low-confidence read; a wrong topic on the first screen destroys
// trust immediately).
//
// The read boundary is pageExtractor.ts's, imported rather than re-derived:
// the document plus every OPEN host-page shadow root, with the overlay's own
// <calyxa-overlay> subtree excluded everywhere (ADR-002/ADR-012). A closed
// shadow root is unreadable by design; a page that hides its problems inside
// one degrades to the manual-count fallback, which is a supported outcome
// (spec §1's "0 problems found" row), not a failure.

/** One enumerated problem. `label` is the number as PRINTED ("5", "3b"). */
export type ScannedProblem = {
  /** 0-based position in the page's own order. */
  index: number;
  /** The printed label ("5", "3b"), or the 1-based position when unlabelled. */
  label: string;
  /** False when `label` is the fallback position rather than page text. */
  labelPrinted: boolean;
  /** A short excerpt of the problem body -- what the tutoring handoff quotes. */
  snippet: string;
  /** The live element, held in the content script only (never serialized). */
  element: Element | null;
};

export type ScanResult = {
  problems: ScannedProblem[];
  count: number;
  /** Filled in later by the concept transport -- always null out of this file. */
  concept: string | null;
  /** Does the page expose per-problem correctness in the DOM? */
  graded: boolean;
  confidence: 'high' | 'low';
};

/** Never enumerate past this -- see ABSURD_COUNT for how the UI words it. */
const MAX_PROBLEMS = 120;
/** Spec §1: above this a count is "almost certainly a mis-parse". */
export const ABSURD_COUNT = 40;
const MAX_SNIPPET_CHARS = 220;
const MIN_SNIPPET_CHARS = 3;

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, max: number): string {
  const trimmed = collapse(value);
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * `textContent`, not `innerText`: a site is free to render its problem body
 * through a visually-hidden accessible description (the Khan Academy pattern
 * pageExtractor's own header documents at length), and innerText -- being
 * CSS-visibility-aware -- silently drops exactly that. Reading textContent
 * recovers real DOM text regardless; it is still strictly read-only.
 */
function readText(el: Element): string {
  return collapse(el.textContent ?? '');
}

// ---- Label parsing -------------------------------------------------------

// "5.", "5)", "(5)", "3b.", "Problem 5", "Question 12", "№5", "#5". Anchored
// at the start so a "12" appearing mid-expression can never be mistaken for a
// problem number.
const LABEL_PATTERN =
  /^\s*(?:(?:problem|question|exercise|q|no\.?|№|#)\s*)?(\d{1,3}[a-z]?)\s*[.):\]]?\s+/i;

/**
 * The printed label at the head of a problem's text, or null. Pure + exported
 * so the spec's real-world label shapes ("3b") are pinned by a test rather
 * than trusted.
 */
export function parseLabel(text: string): string | null {
  const match = LABEL_PATTERN.exec(text);
  if (!match) return null;
  const label = match[1].toLowerCase();
  // A four-digit-looking "label" is a year or a coefficient, not a problem
  // number; the {1,3} bound above already rejects those, and 0 is never a
  // printed problem number.
  return label === '0' ? null : label;
}

/** The body with its leading label stripped -- what the snippet quotes. */
function stripLabel(text: string): string {
  return collapse(text.replace(LABEL_PATTERN, ''));
}

// ---- Problem-likeness ----------------------------------------------------

// A row only counts as a problem if it carries something to DO. Deliberately
// broad (a word problem has no operators at all) but not unbounded: the
// length floor plus the container adapters below keep page chrome out.
const MATH_HINT =
  /[=≤≥≠±√∫Σπ∞^]|\d\s*[+\-*/×÷]\s*\d|\b(solve|simplify|factor|evaluate|graph|find|compute|calculate|prove|expand|derive|integrate|differentiate|convert|determine|write|show)\b/i;

function looksLikeProblem(text: string): boolean {
  if (text.length < 6) return false;
  // A labelled row is trusted on its label alone -- "7. x² − 9 = 0" and
  // "7. The train leaves at 4pm…" are both problems, and demanding a math
  // hint would drop every word problem on the page.
  return MATH_HINT.test(text) || /^\s*(?:\d{1,3}[a-z]?)\s*[.):\]]/.test(text);
}

// ---- Container adapters --------------------------------------------------

// Ordered most-specific first. Each returns the ELEMENTS that look like one
// problem apiece; the caller turns them into ScannedProblems. A selector that
// matches nothing simply yields [] and the next adapter runs.
//
// These are structural conventions, not site-specific hacks: the attributes
// below (data-test-id / role=listitem / <ol><li>) are what exercise engines
// and textbook renderers actually emit, and any page using the same shape
// benefits.
const CONTAINER_SELECTORS = [
  // Exercise engines that label each item explicitly.
  '[data-test-id*="problem" i], [data-testid*="problem" i], [data-problem-id], [data-question-id], [data-qid]',
  '[class*="problem-row" i], [class*="question-row" i], [class*="exercise-item" i]',
  // Generic semantic lists -- the single most common textbook/worksheet shape.
  'ol > li',
  '[role="list"] > [role="listitem"]',
  // Last resort before the text sweep: a table of numbered rows.
  'table tbody > tr',
] as const;

function scanContainers(roots: (Document | ShadowRoot)[]): Element[] {
  for (const selector of CONTAINER_SELECTORS) {
    const found = queryExcludingOverlay<Element>(selector, roots).filter((el) => {
      // Skip a container that itself contains another candidate of the same
      // kind (a nested <ol><li>): the innermost node is the problem.
      if (el.querySelector(selector)) return false;
      return looksLikeProblem(readText(el));
    });
    if (found.length >= 2) return found.slice(0, MAX_PROBLEMS);
  }
  return [];
}

// ---- Text-line fallback --------------------------------------------------

// When no container shape matches, fall back to labelled LINES: any element
// whose own text starts with a problem label and holds no labelled descendant
// of its own. This is what catches a plain worksheet rendered as a pile of
// <div>s or <p>s -- the shape a scanned/converted PDF usually produces.
function scanLabelledLines(roots: (Document | ShadowRoot)[]): Element[] {
  const candidates = queryExcludingOverlay<Element>('p, div, li, td, section, article', roots);
  const found: Element[] = [];
  for (const el of candidates) {
    if (found.length >= MAX_PROBLEMS) break;
    const text = readText(el);
    if (text.length > 600) continue; // a whole page section, not one problem
    if (parseLabel(text) === null) continue;
    if (!looksLikeProblem(text)) continue;
    // Only the innermost labelled node: a wrapper whose text starts with "1."
    // because its FIRST CHILD does isn't itself a problem.
    if (found.some((prev) => el.contains(prev))) continue;
    found.push(el);
  }
  // Drop any ancestor that slipped in before its descendant was seen.
  return found.filter((el) => !found.some((other) => other !== el && el.contains(other)));
}

// ---- Graded detection ----------------------------------------------------

// `graded: true` means the page exposes per-problem correctness in the DOM.
// Spec §1: "When uncertain, default to false. The no-key wording is honest in
// both cases; the graded wording is dishonest if you're wrong." So this is
// deliberately conservative -- it wants an explicit correctness affordance,
// not a vibe.
const GRADED_SELECTORS = [
  '[data-test-id*="correct" i]',
  '[data-testid*="correct" i]',
  '[class*="is-correct" i], [class*="answer-correct" i], [class*="answer-incorrect" i]',
  '[class*="correct-answer" i], [class*="wrong-answer" i]',
  '[aria-label*="correct" i], [aria-label*="incorrect" i]',
  '[data-answer-state], [data-correct], [data-grade]',
].join(', ');

// The "check my answer" affordance -- a page that can grade, even if nothing
// has been graded yet.
const GRADE_ACTION_PATTERN = /\b(check(?:\s+(?:answer|work|it))?|submit\s+answer|grade\s+(?:it|my))\b/i;

export function detectGraded(roots: (Document | ShadowRoot)[]): boolean {
  if (queryExcludingOverlay<Element>(GRADED_SELECTORS, roots).length > 0) return true;
  for (const button of queryExcludingOverlay<HTMLElement>('button, [role="button"], input[type="submit"]', roots)) {
    const label =
      readText(button) || button.getAttribute('aria-label') || (button as HTMLInputElement).value || '';
    if (GRADE_ACTION_PATTERN.test(label)) return true;
  }
  return false;
}

/**
 * Reads THIS problem's correctness off the page, when the page exposes it.
 * Returns null when unknown -- which is the honest answer for most rows most
 * of the time, and the one the summary's conflict copy (spec §6) keys on.
 * Re-read live at tap time rather than snapshotted at scan time: on a graded
 * page the mark usually only appears once the student answers.
 */
export function readPageGrade(element: Element | null): 'correct' | 'incorrect' | null {
  if (!element || !element.isConnected) return null;
  const scope = element.matches(GRADED_SELECTORS) ? element : element.querySelector(GRADED_SELECTORS);
  if (!scope) return null;
  const haystack = [
    scope.getAttribute('data-answer-state'),
    scope.getAttribute('data-correct'),
    scope.getAttribute('data-grade'),
    scope.getAttribute('aria-label'),
    scope.className && typeof scope.className === 'string' ? scope.className : '',
    scope.getAttribute('data-test-id'),
    scope.getAttribute('data-testid'),
  ]
    .filter(Boolean)
    .join(' ');
  // "incorrect" contains "correct", so the negative test must run first.
  if (/\b(in)?correct/i.test(haystack) && /incorrect|wrong|false/i.test(haystack)) return 'incorrect';
  if (/correct|right|true/i.test(haystack)) return 'correct';
  return null;
}

// ---- The main export -----------------------------------------------------

/**
 * One synchronous, read-only pass. Zero model calls, zero network, zero
 * mutation. `concept` is ALWAYS null here -- naming the topic is the concept
 * transport's job, and the opener renders without it rather than guessing.
 *
 * `confidence` is 'low' when the enumeration itself is shaky: nothing found,
 * an absurd count (spec §1 -- almost certainly a mis-parse), or a set where
 * fewer than half the rows carried a printed label. The UI leads with the
 * adjust path in that case instead of stating a count as fact.
 */
export function scanProblems(): ScanResult {
  const roots = collectSearchRoots();

  const elements = (() => {
    const containers = scanContainers(roots);
    if (containers.length >= 2) return containers;
    const lines = scanLabelledLines(roots);
    return lines.length >= 2 ? lines : containers;
  })();

  const problems: ScannedProblem[] = [];
  for (const element of elements) {
    const text = readText(element);
    const label = parseLabel(text);
    const body = stripLabel(text);
    const snippet = truncate(body || text, MAX_SNIPPET_CHARS);
    if (snippet.length < MIN_SNIPPET_CHARS) continue;
    problems.push({
      index: problems.length,
      label: label ?? String(problems.length + 1),
      labelPrinted: label !== null,
      snippet,
      element,
    });
  }

  const labelled = problems.filter((problem) => problem.labelPrinted).length;
  const confidence: 'high' | 'low' =
    problems.length === 0 || problems.length > ABSURD_COUNT || labelled * 2 < problems.length ? 'low' : 'high';

  return {
    problems,
    count: problems.length,
    concept: null,
    graded: detectGraded(roots),
    confidence,
  };
}
