'use client'

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CalyxaMark } from '@calyxa/ui'
import {
  GRADES,
  GRADE_LABELS,
  GRADE_YEARS,
  MATH_CLASS_GROUPS,
  MATH_CLASS_LABELS,
  PAIN_POINTS,
  PAIN_LABELS,
  PAIN_SHORT,
  PAIN_PLAN,
  savePreflightAnswers,
  type Grade,
  type MathClass,
  type PainPoint,
  type PreflightAnswers,
} from '@/lib/onboarding/preflight'
import './onboarding.css'

// The pre-signup onboarding wizard (/start). Three questions, then a payoff:
//
//   1. Grade level        (single-select, auto-advances)
//   2. Current math class (single-select, auto-advances)
//   3. Main pain point    (single-select, auto-advances)
//   → Profile summary     (a visual card built from the three answers) →
//     "Save my profile", which persists the answers to sessionStorage and
//     hands off to /signup.
//
// Rewritten 2026-07-25 (Darcy): the old flow had FIVE steps, a top-right dot
// row for progress, and a flat white surface. Now —
//   * progress is a labelled, CENTERED bar in the header, on every step;
//   * the flow is three questions, not five steps;
//   * the live-demo step is gone, replaced by the profile summary (the summary
//     is the reason to sign up: an account is what saves it);
//   * the surface is a living accent-green ground with drifting blobs and
//     tactile option cards instead of white-on-white.
//
// There is no way to reach signup early except the header's Skip link. The
// three answers are carried into /signup (sessionStorage) and attached to the
// new user's profile at signup; nothing is re-asked or dropped.
//
// Scoped under `.mkt` so it inherits the landing page's design system (display
// face, accent greens); the onboarding-only visual layer lives in
// ./onboarding.css. Everything is single-column and thumb-reachable on mobile.

const TOTAL_STEPS = 3
const SUMMARY_STEP = TOTAL_STEPS + 1

type Draft = {
  grade: Grade | null
  mathClass: MathClass | null
  pain: PainPoint | null
}

export function PreflightWizard() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [draft, setDraft] = useState<Draft>({ grade: null, mathClass: null, pain: null })
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current)
    },
    [],
  )

  // Selecting a single-select option records it and, after a brief beat so the
  // choice reads as "registered", advances to the next step.
  function choose<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
    if (advanceTimer.current) clearTimeout(advanceTimer.current)
    advanceTimer.current = setTimeout(() => setStep((s) => Math.min(s + 1, SUMMARY_STEP)), 260)
  }

  function goBack() {
    if (advanceTimer.current) clearTimeout(advanceTimer.current)
    setStep((s) => Math.max(s - 1, 1))
  }

  // Once all three are chosen the answers are complete; persist them so a
  // refresh on the summary — or the hop to /signup — keeps them.
  const answers: PreflightAnswers | null =
    draft.grade && draft.mathClass && draft.pain
      ? { grade: draft.grade, mathClass: draft.mathClass, pain: draft.pain }
      : null

  useEffect(() => {
    if (answers) savePreflightAnswers(answers)
  }, [answers])

  function toSignup() {
    if (answers) savePreflightAnswers(answers)
    router.push('/signup')
  }

  const onSummary = step === SUMMARY_STEP

  return (
    <main className="mkt ob-ground flex min-h-svh flex-col overflow-hidden">
      {/* Decorative drifting grounds. */}
      <span aria-hidden="true" className="ob-blob ob-blob-a left-[-14rem] top-[-10rem] h-[34rem] w-[34rem]" />
      <span aria-hidden="true" className="ob-blob ob-blob-b right-[-16rem] top-[14rem] h-[38rem] w-[38rem]" />

      {/* Header — logo left, PROGRESS CENTERED, escape hatch right. The
          1fr/auto/1fr grid keeps the bar dead-center at every width, so the
          student always sees which step they are on. */}
      <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-4 sm:px-8 sm:py-6">
        <Link href="/" className="flex items-center gap-2 justify-self-start">
          <CalyxaMark className="h-6 w-6" />
          <span className="hidden text-[16px] font-semibold tracking-[-0.01em] text-foreground sm:inline">
            calyxa
          </span>
        </Link>

        <ProgressBar step={step} done={onSummary} />

        <div className="justify-self-end">
          {!onSummary && (
            <Link
              href="/signup"
              className="text-[13px] font-medium text-(--mkt-strip-text) underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              Skip
            </Link>
          )}
        </div>
      </header>

      <div className="flex flex-1 items-start justify-center px-4 pb-14 pt-2 sm:items-center sm:px-6 sm:pb-20 sm:pt-0">
        <div className={onSummary ? 'w-full max-w-[720px]' : 'w-full max-w-[560px]'}>
          {!onSummary && <AnswerTrail draft={draft} />}

          {step === 1 && (
            <QuestionStep
              key="grade"
              kicker="First — the basics"
              title="What grade are you in?"
              options={GRADES.map((g) => ({
                value: g,
                label: GRADE_LABELS[g],
                badge: GRADE_YEARS[g],
              }))}
              selected={draft.grade}
              onSelect={(v) => choose('grade', v)}
              columns={2}
            />
          )}

          {step === 2 && (
            <QuestionStep
              key="class"
              kicker="Step 2"
              title="What math class are you taking?"
              // Twelve options — grouped, because a flat list this long stops
              // being scannable and the three categories are how students
              // already think about their timetable.
              groups={MATH_CLASS_GROUPS.map((group) => ({
                label: group.label,
                options: group.classes.map((c) => ({
                  value: c,
                  label: MATH_CLASS_LABELS[c],
                  badge: <span className="mkt-math text-[17px]">{MATH_CLASS_GLYPH[c]}</span>,
                })),
              }))}
              selected={draft.mathClass}
              onSelect={(v) => choose('mathClass', v)}
              onBack={goBack}
              columns={2}
            />
          )}

          {step === 3 && (
            <QuestionStep
              key="pain"
              kicker="Last one"
              title="What trips you up the most?"
              options={PAIN_POINTS.map((p) => ({
                value: p,
                label: PAIN_LABELS[p],
                badge: PAIN_ICONS[p],
              }))}
              selected={draft.pain}
              onSelect={(v) => choose('pain', v)}
              onBack={goBack}
              columns={1}
            />
          )}

          {onSummary && answers && (
            <SummaryStep answers={answers} onBack={goBack} onCreate={toSignup} />
          )}
        </div>
      </div>
    </main>
  )
}

// ── Progress (centered, labelled, on every step) ────────────────────────────

function ProgressBar({ step, done }: { step: number; done: boolean }) {
  const current = Math.min(step, TOTAL_STEPS)
  return (
    <div className="flex flex-col items-center gap-1.5">
      <p
        className="mkt-eyebrow"
        aria-live="polite"
        // The label is the accessible progress readout; the bar below is
        // decoration, so it is hidden from assistive tech.
      >
        {done ? 'Profile ready' : `Step ${current} of ${TOTAL_STEPS}`}
      </p>
      <div className="ob-progress-track" aria-hidden="true">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => {
          const n = i + 1
          const state = done || n < step ? 'done' : n === step ? 'active' : 'todo'
          return (
            <span key={n} className="ob-progress-seg" data-state={state}>
              <span className="ob-progress-fill" />
            </span>
          )
        })}
      </div>
    </div>
  )
}

// ── Answer trail ────────────────────────────────────────────────────────────
//
// The answers already given, as ticked chips above the current question. It
// costs one line and makes the flow feel like it is building something —
// which is exactly what the summary then pays off.

function AnswerTrail({ draft }: { draft: Draft }) {
  const given = [
    draft.grade ? GRADE_LABELS[draft.grade] : null,
    draft.mathClass ? MATH_CLASS_LABELS[draft.mathClass] : null,
  ].filter((v): v is string => v !== null)

  if (given.length === 0) return null

  return (
    <div className="mb-5 flex flex-wrap gap-2">
      {given.map((label) => (
        <span key={label} className="mkt-chip ob-stagger text-(--color-accent-emphasis)">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
            <path
              d="M5 12.5 10 17 19 7"
              stroke="currentColor"
              strokeWidth={2.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {label}
        </span>
      ))}
    </div>
  )
}

// ── Question step ───────────────────────────────────────────────────────────

type Option<V extends string> = { value: V; label: string; badge: ReactNode }

/** One step of the wizard. Options arrive either flat (`options`) or in
 *  labelled groups (`groups`) — the math-class step is the only grouped one,
 *  and it is grouped because twelve courses in one list is a wall. Grouping is
 *  a rendering concern only: the answer shape is unchanged, and the whole step
 *  stays ONE radiogroup so arrow keys still traverse every option and a screen
 *  reader still hears "3 of 12", not "3 of 4" three times over. */
function QuestionStep<V extends string>({
  kicker,
  title,
  options,
  groups,
  selected,
  onSelect,
  onBack,
  columns,
}: {
  kicker: string
  title: string
  options?: Option<V>[]
  groups?: { label: string; options: Option<V>[] }[]
  selected: V | null
  onSelect: (value: V) => void
  onBack?: () => void
  columns: 1 | 2
}) {
  const gridClass =
    columns === 1 ? 'grid grid-cols-1 gap-2.5' : 'grid grid-cols-1 gap-2.5 sm:grid-cols-2'

  // Stagger delays run across the WHOLE step, not per group, so the options
  // cascade in as one sequence rather than three restarting ones.
  let optionIndex = 0
  const renderOption = (opt: Option<V>) => {
    const isSelected = selected === opt.value
    const delay = 0.05 + optionIndex * 0.045
    optionIndex += 1
    return (
      <button
        key={opt.value}
        type="button"
        role="radio"
        aria-checked={isSelected}
        onClick={() => onSelect(opt.value)}
        className="ob-opt ob-stagger"
        data-selected={isSelected}
        style={{ '--ob-delay': `${delay}s` } as CSSProperties}
      >
        <span aria-hidden="true" className="ob-badge">
          {opt.badge}
        </span>
        <span className="text-[15px] font-medium leading-[1.35] text-foreground sm:text-[15.5px]">
          {opt.label}
        </span>
      </button>
    )
  }

  return (
    <section className="ob-step-in flex flex-col">
      <p className="mkt-eyebrow mb-3">{kicker}</p>
      <h1 className="mkt-display text-[29px] leading-[1.08] tracking-[-0.02em] text-foreground sm:text-[40px]">
        {title}
      </h1>

      <div role="radiogroup" aria-label={title} className="mt-7 sm:mt-9">
        {groups ? (
          <div className="flex flex-col gap-5">
            {groups.map((group) => (
              // `role="group"` + aria-label keeps the heading associated with
              // its options without opening a nested radiogroup, which would
              // fragment arrow-key traversal.
              <div key={group.label} role="group" aria-label={group.label}>
                <p className="mkt-eyebrow mb-2.5 text-[11.5px] text-(--mkt-strip-text)">{group.label}</p>
                <div className={gridClass}>{group.options.map(renderOption)}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className={gridClass}>{(options ?? []).map(renderOption)}</div>
        )}
      </div>

      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="mt-7 self-start text-[13.5px] font-medium text-(--mkt-strip-text) transition-colors hover:text-foreground"
        >
          ← Back
        </button>
      )}
    </section>
  )
}

// ── Profile summary (the payoff) ────────────────────────────────────────────

function SummaryStep({
  answers,
  onBack,
  onCreate,
}: {
  answers: PreflightAnswers
  onBack: () => void
  onCreate: () => void
}) {
  const plan = PAIN_PLAN[answers.pain]
  return (
    <section className="flex flex-col">
      <div className="ob-summary ob-pop-in">
        {/* Head strip: the completion ring is the reward for finishing. Text
            sits DARK on the accent band (brand rule: never white on accent). */}
        <div className="ob-summary-head flex items-center gap-4 px-5 py-5 sm:px-8 sm:py-6">
          <CompletionRing />
          <div className="min-w-0">
            <p className="mkt-eyebrow text-(--color-accent-fill-foreground)">Your study profile</p>
            <p className="mt-1 text-[15px] font-semibold text-(--color-accent-fill-foreground) sm:text-[16px]">
              Built from your 3 answers
            </p>
          </div>
        </div>

        <div className="px-5 pb-6 pt-6 sm:px-8 sm:pb-8 sm:pt-7">
          <h1 className="mkt-display text-[28px] leading-[1.08] tracking-[-0.02em] text-foreground sm:text-[38px]">
            {plan.headline}
          </h1>
          <p className="mt-3 max-w-[42ch] text-[15px] leading-[1.55] text-(--mkt-strip-text) sm:text-[16.5px]">
            {plan.sub}
          </p>

          <div className="mt-6 grid grid-cols-1 gap-2.5 sm:mt-7 sm:grid-cols-3">
            <Tile
              delay="0.16s"
              icon={<span className="mkt-math text-[15px]">{MATH_CLASS_GLYPH[answers.mathClass]}</span>}
              caption="Class"
              value={MATH_CLASS_LABELS[answers.mathClass]}
              note={`${GRADE_LABELS[answers.grade]} · ${GRADE_YEARS[answers.grade]} grade`}
            />
            <Tile
              delay="0.24s"
              icon={TARGET_ICON}
              caption="Focus"
              value={PAIN_SHORT[answers.pain]}
              note="Where Calyxa starts with you"
            />
            <Tile
              delay="0.32s"
              icon={SPARK_ICON}
              caption="Method"
              value={plan.method}
              note={plan.methodNote}
            />
          </div>
        </div>
      </div>

      <div
        className="ob-stagger mt-6 flex flex-col items-center gap-3 sm:mt-7"
        style={{ '--ob-delay': '0.42s' } as CSSProperties}
      >
        <button
          type="button"
          onClick={onCreate}
          className="ob-cta w-full px-8 py-4 text-[15.5px] sm:w-auto"
        >
          Save my profile
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
            <path
              d="M5 12h13m0 0-5.5-5.5M18 12l-5.5 5.5"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <p className="text-[13px] text-(--mkt-strip-text)">
          Free account — it&rsquo;s what keeps this profile.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="mt-1 text-[13.5px] font-medium text-(--mkt-strip-text) transition-colors hover:text-foreground"
        >
          ← Back
        </button>
      </div>
    </section>
  )
}

function Tile({
  icon,
  caption,
  value,
  note,
  delay,
}: {
  icon: ReactNode
  caption: string
  value: string
  note: string
  delay: string
}) {
  return (
    <div className="ob-tile ob-stagger flex items-start gap-3 sm:block" style={{ '--ob-delay': delay } as CSSProperties}>
      <span aria-hidden="true" className="ob-tile-icon flex-none sm:mb-3">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="mkt-kicker-faint text-(--mkt-strip-text)">{caption}</p>
        <p className="mt-1 text-[15px] font-semibold leading-[1.25] text-foreground">{value}</p>
        <p className="mt-1 text-[12.5px] leading-[1.4] text-(--mkt-strip-text)">{note}</p>
      </div>
    </div>
  )
}

// A 100%-complete ring — the visual "you finished" beat. pathLength=1 keeps
// the draw-on math independent of the radius.
function CompletionRing() {
  return (
    <div className="relative h-14 w-14 flex-none sm:h-16 sm:w-16">
      <svg viewBox="0 0 48 48" className="h-full w-full" aria-hidden="true">
        <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="5" />
        <circle
          className="ob-ring-arc"
          cx="24"
          cy="24"
          r="20"
          fill="none"
          stroke="var(--color-accent-fill-foreground)"
          strokeWidth="5"
          strokeLinecap="round"
          pathLength={1}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[13px] font-semibold text-(--color-accent-fill-foreground)">
        3/3
      </span>
    </div>
  )
}

// ── Option glyphs + tile icons ──────────────────────────────────────────────

const MATH_CLASS_GLYPH: Record<MathClass, string> = {
  'algebra-1': 'x',
  geometry: '△',
  'algebra-2': 'x²',
  precalculus: 'ƒ',
  'ap-precalculus': 'θ',
  'ap-calculus-ab': '∫',
  'ap-calculus-bc': '∑',
  'ap-statistics': 'σ',
  'integrated-math-1': 'Ⅰ',
  'integrated-math-2': 'Ⅱ',
  'integrated-math-3': 'Ⅲ',
  other: '∗',
}

function Stroke({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[19px] w-[19px]"
    >
      {children}
    </svg>
  )
}

const PAIN_ICONS: Record<PainPoint, ReactNode> = {
  // "no one to ask" — a question.
  stuck: (
    <Stroke>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.4 9.3a2.7 2.7 0 1 1 3.4 2.7c-.6.2-1 .8-1 1.5v.4" />
      <path d="M11.9 17h.1" />
    </Stroke>
  ),
  // "fades by test time" — a clock.
  forget: (
    <Stroke>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.2v5l3.2 2" />
    </Stroke>
  ),
  // "why was it wrong" — the lightbulb moment.
  'why-wrong': (
    <Stroke>
      <path d="M9.3 16.4a5.3 5.3 0 1 1 5.4 0v1.5a1 1 0 0 1-1 1h-3.4a1 1 0 0 1-1-1z" />
      <path d="M10.4 21.2h3.2" />
    </Stroke>
  ),
  // "takes too long" — speed.
  'too-long': (
    <Stroke>
      <path d="M13.2 3 5.8 13.4h5l-1 7.6 7.4-10.4h-5z" />
    </Stroke>
  ),
}

const TARGET_ICON = (
  <Stroke>
    <circle cx="12" cy="12" r="8.2" />
    <circle cx="12" cy="12" r="3.4" />
  </Stroke>
)

const SPARK_ICON = (
  <Stroke>
    <path d="M12 3.6 13.7 9l5.4 1.7-5.4 1.7L12 17.8l-1.7-5.4L4.9 10.7 10.3 9z" />
  </Stroke>
)
