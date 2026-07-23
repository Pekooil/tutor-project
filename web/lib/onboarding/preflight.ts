// Pre-signup onboarding ("preflight") — the shared, presentation-free content
// and helpers for the /start wizard (components/onboarding/PreflightWizard.tsx)
// and the handoff into /signup.
//
// The flow collects exactly THREE single-select answers before the existing
// signup form: grade level, current math class, and the student's main pain
// point. Those answers (a) personalize the live demo the wizard shows and the
// recap copy that follows, and (b) are carried into /signup via sessionStorage
// and attached to the new user's Supabase auth user_metadata at signup
// (web/app/api/auth/signup/route.ts) — never dropped.
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

// ── Demo personalization (step 4) ──────────────────────────────────────────

// The tutor's opening line, auto-played in the demo. It leads with the
// student's stated pain point (step 3) and then pivots to the SAME grounded
// question about the shown right-triangle problem — so the 'stuck' annotation
// set (the 50° angle + "which side is AB?") always matches what's said, no
// matter which pain point was picked.
const DEMO_QUESTION_TAIL =
  "right triangle, you know the 50° angle and the side of length 2. before I say anything — which side is AB, relative to that angle?"

export const PAIN_DEMO_OPENING: Record<PainPoint, string> = {
  stuck: `you said the worst part is getting stuck with no one to ask — that's me, and I'm already here. ${DEMO_QUESTION_TAIL}`,
  forget: `you said concepts slip by test time — so I won't just hand you steps, I'll make this one stick. ${DEMO_QUESTION_TAIL}`,
  'why-wrong': `you said you never find out *why* an answer's wrong — so I'll always show the why. ${DEMO_QUESTION_TAIL}`,
  'too-long': `you said homework drags on — let's make this quick, no busywork. ${DEMO_QUESTION_TAIL}`,
}

// A short, honest note above the demo that reflects the chosen math class
// (step 2). The shown problem is right-triangle trig; the copy names the class
// without pretending the trig problem "belongs" to Algebra 1 / Other.
export const MATH_CLASS_DEMO_NOTE: Record<MathClass, string> = {
  algebra1: "Here's Calyxa on a live problem — it works your Algebra 1 homework exactly like this.",
  algebra2: 'A right-triangle trig problem — Algebra 2 territory. Watch Calyxa work it live.',
  geometry: 'Right-triangle trig, straight from Geometry. Watch Calyxa work it live.',
  precalculus: "Right-triangle trig — you'll see plenty of it in Precalculus. Watch Calyxa work it live.",
  other: "Here's Calyxa on a live problem — it works the same on whatever you're studying.",
}

// ── Recap copy (step 5) ─────────────────────────────────────────────────────
//
// Four DISTINCT variants, one per pain point — each speaks to that specific
// answer and to the real Calyxa capability that addresses it (someone to ask /
// spaced reinforcement / misconception tracking / next-step nudges), never a
// generic feature list.

export type Recap = { headline: string; body: string }

export const PAIN_RECAP: Record<PainPoint, Recap> = {
  stuck: {
    headline: 'Someone to ask — always there.',
    body: "You said the worst part is getting stuck with no one to ask. Calyxa lives on the page you're already working on, so the second you're stuck it's right there — and it answers with the next step, never the whole solution. No waiting until class tomorrow.",
  },
  forget: {
    headline: "The stuff you learn won't fade by the test.",
    body: 'You said concepts slip away by test time. Calyxa tracks what you have actually mastered and quietly resurfaces the shaky ideas before they fade — so what you learned in September is still there in December.',
  },
  'why-wrong': {
    headline: '"Wrong" turns into "oh — that\'s why."',
    body: "You said the frustrating part is never knowing why something was wrong. That's exactly what Calyxa watches for: it spots the specific misconception behind a wrong answer and walks you back to it, so every mistake actually teaches you something.",
  },
  'too-long': {
    headline: 'Less time stuck. More time moving.',
    body: "You said homework takes too long. Calyxa won't do it for you — it cuts the stuck-and-staring time by pointing at the one next step whenever you stall, so you keep moving instead of grinding.",
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
