'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CalyxaMark } from '@calyxa/ui'
import { HeroDemo } from '@/components/marketing/HeroDemo'
import {
  GRADES,
  GRADE_LABELS,
  MATH_CLASSES,
  MATH_CLASS_LABELS,
  MATH_CLASS_DEMO_NOTE,
  PAIN_POINTS,
  PAIN_LABELS,
  PAIN_DEMO_OPENING,
  PAIN_RECAP,
  savePreflightAnswers,
  type Grade,
  type MathClass,
  type PainPoint,
  type PreflightAnswers,
} from '@/lib/onboarding/preflight'

// The pre-signup onboarding wizard (/start). A linear five-step flow that runs
// BEFORE the existing signup form:
//
//   1. Grade level        (single-select, auto-advances)
//   2. Current math class (single-select, auto-advances)
//   3. Main pain point    (single-select, auto-advances)
//   4. Live demo          (the real HeroDemo, auto-opening with a tutor line
//                          that references the step-3 pain point, framed by a
//                          step-2 class note)
//   5. Recap              (copy specific to the step-3 answer) → "Create your
//                          account", which saves the answers to sessionStorage
//                          and hands off to /signup.
//
// There is no way to reach signup early — the only path out is step 5's CTA.
// The three answers are carried into /signup (sessionStorage) and attached to
// the new user's profile at signup; nothing is re-asked or dropped.
//
// Scoped under `.mkt` so it inherits the landing page's exact design system
// (display face, green wash, accent greens) — no new visual language.

const ACCENT = '#86efac'
const ACCENT_HOVER = '#6ee7a0'
const ACCENT_DEEP = '#14532d'

const TOTAL_STEPS = 5

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

  useEffect(() => () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current)
  }, [])

  // Selecting a single-select option records it and, after a brief beat so the
  // choice reads as "registered", advances to the next step.
  function choose<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
    if (advanceTimer.current) clearTimeout(advanceTimer.current)
    advanceTimer.current = setTimeout(() => setStep((s) => Math.min(s + 1, TOTAL_STEPS)), 240)
  }

  function goBack() {
    if (advanceTimer.current) clearTimeout(advanceTimer.current)
    setStep((s) => Math.max(s - 1, 1))
  }

  // Once all three are chosen (steps 4–5), the answers are complete; persist
  // them so a refresh on the demo/recap step — or the hop to /signup — keeps
  // them. Guarded by the full-answers narrowing below.
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

  return (
    <main
      className="mkt flex min-h-svh flex-col"
      style={{
        background:
          'radial-gradient(70rem 36rem at 50% -12rem, rgba(187,247,208,0.5), rgba(240,253,244,0.5) 42%, transparent 72%), #ffffff',
      }}
    >
      {/* Header: logo home link + progress. */}
      <header className="flex items-center gap-4 px-5 py-5 sm:px-10">
        <Link href="/" className="flex items-center gap-2">
          <CalyxaMark className="h-6 w-6" />
          <span className="text-[16px] font-semibold tracking-[-0.01em] text-foreground">calyxa</span>
        </Link>
        <div className="ml-auto flex items-center gap-3">
          <ProgressDots step={step} />
          <Link
            href="/signup"
            className="text-[13px] font-medium text-(--mkt-faint) underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            Skip
          </Link>
        </div>
      </header>

      <div className="flex flex-1 items-start justify-center px-5 pb-16 pt-4 sm:items-center sm:pt-0">
        <div className="w-full max-w-[560px]">
          {step === 1 && (
            <QuestionStep
              stepIndex={1}
              kicker="A couple quick things"
              title="What grade are you in?"
              options={GRADES.map((g) => ({ value: g, label: GRADE_LABELS[g] }))}
              selected={draft.grade}
              onSelect={(v) => choose('grade', v)}
            />
          )}

          {step === 2 && (
            <QuestionStep
              stepIndex={2}
              kicker="Step 2 of 3"
              title="What math class are you taking?"
              options={MATH_CLASSES.map((c) => ({ value: c, label: MATH_CLASS_LABELS[c] }))}
              selected={draft.mathClass}
              onSelect={(v) => choose('mathClass', v)}
              onBack={goBack}
            />
          )}

          {step === 3 && (
            <QuestionStep
              stepIndex={3}
              kicker="Step 3 of 3"
              title="What trips you up the most?"
              options={PAIN_POINTS.map((p) => ({ value: p, label: PAIN_LABELS[p] }))}
              selected={draft.pain}
              onSelect={(v) => choose('pain', v)}
              onBack={goBack}
              stacked
            />
          )}

          {step === 4 && answers && (
            <DemoStep answers={answers} onBack={goBack} onContinue={() => setStep(5)} />
          )}

          {step === 5 && answers && (
            <RecapStep answers={answers} onBack={goBack} onCreate={toSignup} />
          )}
        </div>
      </div>
    </main>
  )
}

// ── Progress ────────────────────────────────────────────────────────────────

function ProgressDots({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-hidden="true">
      {Array.from({ length: TOTAL_STEPS }, (_, i) => {
        const n = i + 1
        const done = n <= step
        return (
          <span
            key={n}
            className="h-1.5 rounded-full transition-all duration-300"
            style={{
              width: n === step ? 22 : 8,
              background: done ? ACCENT_DEEP : 'var(--mkt-hairline)',
              opacity: done ? 1 : 0.9,
            }}
          />
        )
      })}
    </div>
  )
}

// ── Question step (steps 1–3) ────────────────────────────────────────────────

type Option<V extends string> = { value: V; label: string }

function QuestionStep<V extends string>({
  stepIndex,
  kicker,
  title,
  options,
  selected,
  onSelect,
  onBack,
  stacked = false,
}: {
  stepIndex: number
  kicker: string
  title: string
  options: Option<V>[]
  selected: V | null
  onSelect: (value: V) => void
  onBack?: () => void
  stacked?: boolean
}) {
  return (
    <section key={stepIndex} className="mkt-fade-up flex flex-col">
      <p className="mkt-eyebrow mb-3">{kicker}</p>
      <h1 className="mkt-display text-[30px] leading-[1.1] tracking-[-0.02em] text-foreground sm:text-[38px]">
        {title}
      </h1>

      <div
        role="radiogroup"
        aria-label={title}
        className={stacked ? 'mt-8 flex flex-col gap-2.5' : 'mt-8 grid grid-cols-2 gap-2.5'}
      >
        {options.map((opt) => {
          const isSelected = selected === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onSelect(opt.value)}
              onMouseEnter={(e) => {
                if (!isSelected) e.currentTarget.style.borderColor = 'rgba(20,83,45,0.35)'
              }}
              onMouseLeave={(e) => {
                if (!isSelected) e.currentTarget.style.borderColor = 'var(--mkt-hairline)'
              }}
              className={`flex items-center gap-3 rounded-2xl border bg-white/70 text-left text-[15px] font-medium text-foreground transition-colors ${
                stacked ? 'px-5 py-4' : 'px-5 py-4'
              }`}
              style={{
                borderColor: isSelected ? ACCENT_DEEP : 'var(--mkt-hairline)',
                background: isSelected ? 'rgba(187,247,208,0.35)' : 'rgba(255,255,255,0.7)',
                boxShadow: isSelected ? '0 6px 18px rgba(28,40,30,0.1)' : 'var(--mkt-shadow-1)',
              }}
            >
              <span
                aria-hidden="true"
                className="flex h-5 w-5 flex-none items-center justify-center rounded-full border transition-colors"
                style={{
                  borderColor: isSelected ? ACCENT_DEEP : 'var(--mkt-hairline)',
                  background: isSelected ? ACCENT_DEEP : 'transparent',
                }}
              >
                {isSelected && (
                  <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3">
                    <path
                      d="M5 12.5 10 17 19 7"
                      stroke="#ffffff"
                      strokeWidth={2.6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              {opt.label}
            </button>
          )
        })}
      </div>

      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="mt-7 self-start text-[13.5px] font-medium text-(--mkt-faint) transition-colors hover:text-foreground"
        >
          ← Back
        </button>
      )}
    </section>
  )
}

// ── Demo step (step 4) ───────────────────────────────────────────────────────

function DemoStep({
  answers,
  onBack,
  onContinue,
}: {
  answers: PreflightAnswers
  onBack: () => void
  onContinue: () => void
}) {
  return (
    <section className="mkt-fade-up flex flex-col items-center text-center">
      <p className="mkt-eyebrow mb-3">See it work</p>
      <h1 className="mkt-display max-w-[30ch] text-[27px] leading-[1.12] tracking-[-0.02em] text-foreground sm:text-[34px]">
        {MATH_CLASS_DEMO_NOTE[answers.mathClass]}
      </h1>

      {/* The real landing-page demo, auto-opening with a tutor line that
          references the chosen pain point. `key` on the pain point remounts it
          if the student went back and changed their answer, so the opening
          line always matches. */}
      <div className="mt-8 w-full">
        <HeroDemo
          key={answers.pain}
          showPlaceholders={false}
          autoOpen
          openingText={PAIN_DEMO_OPENING[answers.pain]}
        />
      </div>

      <button
        type="button"
        onClick={onContinue}
        onMouseEnter={(e) => (e.currentTarget.style.background = ACCENT_HOVER)}
        onMouseLeave={(e) => (e.currentTarget.style.background = ACCENT)}
        className="mt-9 inline-flex items-center justify-center rounded-full px-8 py-3.5 text-[15px] font-semibold"
        style={{
          background: ACCENT,
          color: ACCENT_DEEP,
          border: '1px solid rgba(20,83,45,0.18)',
          boxShadow: '0 12px 30px rgba(28,40,30,0.16)',
        }}
      >
        Looks good — keep going
      </button>
      <button
        type="button"
        onClick={onBack}
        className="mt-4 text-[13.5px] font-medium text-(--mkt-faint) transition-colors hover:text-foreground"
      >
        ← Back
      </button>
    </section>
  )
}

// ── Recap step (step 5) ──────────────────────────────────────────────────────

function RecapStep({
  answers,
  onBack,
  onCreate,
}: {
  answers: PreflightAnswers
  onBack: () => void
  onCreate: () => void
}) {
  const recap = PAIN_RECAP[answers.pain]
  return (
    <section className="mkt-fade-up flex flex-col">
      <div className="mb-5 flex flex-wrap gap-2">
        <span className="mkt-chip">{GRADE_LABELS[answers.grade]}</span>
        <span className="mkt-chip">{MATH_CLASS_LABELS[answers.mathClass]}</span>
      </div>

      <h1 className="mkt-display text-[30px] leading-[1.1] tracking-[-0.02em] text-foreground sm:text-[40px]">
        {recap.headline}
      </h1>
      <p className="mt-5 max-w-[46ch] text-[16px] leading-[1.6] text-(--mkt-strip-text) sm:text-[17px]">
        {recap.body}
      </p>

      <button
        type="button"
        onClick={onCreate}
        onMouseEnter={(e) => (e.currentTarget.style.background = ACCENT_HOVER)}
        onMouseLeave={(e) => (e.currentTarget.style.background = ACCENT)}
        className="mt-9 inline-flex w-full items-center justify-center rounded-full px-8 py-4 text-[15.5px] font-semibold sm:w-auto sm:self-start"
        style={{
          background: ACCENT,
          color: ACCENT_DEEP,
          border: '1px solid rgba(20,83,45,0.18)',
          boxShadow: '0 14px 36px rgba(28,40,30,0.18)',
        }}
      >
        Create your account
      </button>
      <button
        type="button"
        onClick={onBack}
        className="mt-4 self-start text-[13.5px] font-medium text-(--mkt-faint) transition-colors hover:text-foreground"
      >
        ← Back
      </button>
    </section>
  )
}
