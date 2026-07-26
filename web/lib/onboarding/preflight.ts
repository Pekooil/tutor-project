// Pre-signup onboarding ("preflight") — the shared, presentation-free content
// and helpers for the /start wizard (components/onboarding/PreflightWizard.tsx)
// and the handoff into /signup.
//
// The flow collects exactly THREE single-select answers before the existing
// signup form: grade level, current math class, and the student's main pain
// point. Those answers (a) build the visual profile summary the wizard shows
// as its payoff screen, and (b) are carried into /signup via sessionStorage
// and attached to the new user's Supabase auth user_metadata at signup
// (web/app/api/auth/signup/route.ts) — never dropped.
//
// The wizard used to show a fourth "live demo" step between the questions and
// the recap; it was dropped (2026-07-25) in favour of the profile summary, so
// the demo-personalization copy that used to live here is gone with it.
//
// Deliberately NO "which subject?" question: the product is math-only right
// now (reading/physics are feature-flagged off), so the demo and copy are
// scoped to math implicitly and the choice is never surfaced.
//
// This module is pure data + tiny helpers so it can be imported by both the
// client wizard and the server signup validator without pulling in React.

// ── Answer shapes ─────────────────────────────────────────────────────────

export const GRADES = ['freshman', 'sophomore', 'junior', 'senior'] as const
export type Grade = (typeof GRADES)[number]

export const MATH_CLASSES = ['algebra1', 'algebra2', 'geometry', 'precalculus', 'other'] as const
export type MathClass = (typeof MATH_CLASSES)[number]

export const PAIN_POINTS = ['stuck', 'forget', 'why-wrong', 'too-long'] as const
export type PainPoint = (typeof PAIN_POINTS)[number]

export type PreflightAnswers = {
  grade: Grade
  mathClass: MathClass
  pain: PainPoint
}

// ── Human labels (single source of truth for the option buttons) ───────────

export const GRADE_LABELS: Record<Grade, string> = {
  freshman: 'Freshman',
  sophomore: 'Sophomore',
  junior: 'Junior',
  senior: 'Senior',
}

// The year number that rides each grade option (rendered as the option's
// badge, and as the profile summary's sub-label).
export const GRADE_YEARS: Record<Grade, string> = {
  freshman: '9th',
  sophomore: '10th',
  junior: '11th',
  senior: '12th',
}

export const MATH_CLASS_LABELS: Record<MathClass, string> = {
  algebra1: 'Algebra 1',
  algebra2: 'Algebra 2',
  geometry: 'Geometry',
  precalculus: 'Precalculus',
  other: 'Other',
}

// The pain-point options render their full first-person sentence verbatim.
export const PAIN_LABELS: Record<PainPoint, string> = {
  stuck: 'I get stuck and have no one to ask',
  forget: 'I forget concepts by test time',
  'why-wrong': "I don't know why I got something wrong",
  'too-long': 'Homework takes too long',
}

// A two/three-word version of each pain point, for the summary's chips and
// tiles where the full first-person sentence is too long to read at a glance.
export const PAIN_SHORT: Record<PainPoint, string> = {
  stuck: 'Getting stuck',
  forget: 'Forgetting by test day',
  'why-wrong': 'Not knowing why',
  'too-long': 'Homework drag',
}

// ── Profile summary (the payoff screen) ─────────────────────────────────────
//
// Four DISTINCT variants, one per pain point — each names that specific answer
// and the real Calyxa capability that addresses it (someone to ask / spaced
// reinforcement / misconception tracking / next-step nudges), never a generic
// feature list. Deliberately SHORT: the summary screen is a visual card, not a
// wall of copy, so every field here is a phrase, not a paragraph.

export type Plan = {
  /** The card's one-line promise (≤ 6 words). */
  headline: string
  /** One short supporting sentence under the headline. */
  sub: string
  /** The named Calyxa capability that answers this pain point. */
  method: string
  /** A single short clause explaining that capability. */
  methodNote: string
}

export const PAIN_PLAN: Record<PainPoint, Plan> = {
  stuck: {
    headline: 'Never stuck alone again.',
    sub: "Calyxa sits on the page you're already working on.",
    method: 'Next-step hints',
    methodNote: 'One step at a time — never the whole answer.',
  },
  forget: {
    headline: "It won't fade by test day.",
    sub: 'Calyxa tracks what actually stuck, and what did not.',
    method: 'Spaced review',
    methodNote: 'Shaky ideas come back before they slip.',
  },
  'why-wrong': {
    headline: 'Every mistake explains itself.',
    sub: 'Calyxa finds the idea behind the wrong answer.',
    method: 'Misconception tracking',
    methodNote: 'It names the exact thing you missed.',
  },
  'too-long': {
    headline: 'Less staring. More solving.',
    sub: 'Calyxa cuts the stuck-and-staring part of homework.',
    method: 'Unstick nudges',
    methodNote: 'A pointer at the one next step when you stall.',
  },
}

// ── Carry across the /start → /signup handoff ──────────────────────────────
//
// sessionStorage (NOT query params): grade/class/pain are mildly personal, and
// keeping them out of the URL avoids logging them or leaking them via
// Referer. The key is read once on the signup page and cleared after a
// successful signup.

export const PREFLIGHT_STORAGE_KEY = 'calyxa.preflight.v1'

/** Narrow an unknown value (e.g. parsed JSON, a request body field) to valid
 *  PreflightAnswers, or null. Used on both the client (reading sessionStorage)
 *  and the server (validating the signup body) so malformed data is dropped
 *  rather than trusted. */
export function parsePreflightAnswers(value: unknown): PreflightAnswers | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const { grade, mathClass, pain } = record
  if (
    typeof grade !== 'string' ||
    typeof mathClass !== 'string' ||
    typeof pain !== 'string' ||
    !(GRADES as readonly string[]).includes(grade) ||
    !(MATH_CLASSES as readonly string[]).includes(mathClass) ||
    !(PAIN_POINTS as readonly string[]).includes(pain)
  ) {
    return null
  }
  return { grade: grade as Grade, mathClass: mathClass as MathClass, pain: pain as PainPoint }
}

export function savePreflightAnswers(answers: PreflightAnswers): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(PREFLIGHT_STORAGE_KEY, JSON.stringify(answers))
  } catch {
    // Private-mode / storage-disabled: the answers just won't carry. The
    // wizard still works and signup is never blocked on this.
  }
}

export function loadPreflightAnswers(): PreflightAnswers | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(PREFLIGHT_STORAGE_KEY)
    if (!raw) return null
    return parsePreflightAnswers(JSON.parse(raw))
  } catch {
    return null
  }
}

export function clearPreflightAnswers(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(PREFLIGHT_STORAGE_KEY)
  } catch {
    // no-op
  }
}
