import { useRef, useState } from 'react';
import { CalyxaMark } from '@calyxa/ui';

// Public launch (2026-07-17): the first-run TUTORIAL surface, replacing the
// Sprint 17 diagnostic self-check (Onboarding.tsx, retired) in the overlay's
// single surface slot. Instead of calibrating the mastery profile with quiz
// items (the profile now calibrates live from real sessions), the first
// expansion teaches how Calyxa is actually used: the pill, the scan, voice/
// text turns, and the end-of-session recap.
//
// Presentational + a tiny local step machine, exactly like the surface it
// replaces: Overlay.tsx state is untouched until onDone fires. Whether the
// tour was already seen is persisted CLIENT-side (chrome.storage.local via
// content/index.ts's transport) — there is no server call at all, unlike the
// old ONBOARDING_STATUS/SUBMIT round-trips.
const FINISHED_HOLD_MS = 1200;

export type TutorialStep = {
  kicker: string;
  title: string;
  body: string;
};

// Exported for the a11y spec (tests/a11y-overlay.test.ts), the same
// "export internals for the test task" convention as Overlay.tsx.
export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    kicker: 'your tutor',
    title: 'This pill is your tutor',
    body: 'It sits at the bottom of any page you study on. Move your mouse over it to wake it up — press Escape any time to tuck it away.',
  },
  {
    kicker: 'scan',
    title: 'Scan the problem you’re stuck on',
    body: 'Tap the viewfinder button and Calyxa reads the problem on your page, then checks in on where you are with it. Nothing is scanned until you ask.',
  },
  {
    kicker: 'voice & text',
    title: 'Talk it through — or type',
    body: 'Tap the mic to speak, or the Aa button to type. Calyxa coaches you to the step you’re missing, out loud — it never just hands you the answer.',
  },
  {
    kicker: 'recap',
    title: 'End with a recap you keep',
    body: 'When you finish, Calyxa recaps what clicked and can turn the session into notes, practice problems, and flashcards. Your progress lives at calyxa.app.',
  },
];

export function Tutorial({
  onDone,
}: {
  // Fired once when the tour ends. `completed` is true only when the student
  // stepped through every card (never on "Skip the tour") — Overlay.tsx uses
  // it to emit the first-run-completed telemetry, and persists "seen" either
  // way so no page load ever nags twice.
  onDone: (info: { completed: boolean; stepCount: number; ms: number }) => void;
}) {
  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const startedAtRef = useRef(performance.now());

  const total = TUTORIAL_STEPS.length;
  const step = TUTORIAL_STEPS[Math.min(index, total - 1)];

  function elapsedMs() {
    return Math.round(performance.now() - startedAtRef.current);
  }

  function handleNext() {
    if (index + 1 < total) {
      setIndex((i) => i + 1);
      return;
    }
    // A short "you're set" hold, mirroring the old surface's calibrated beat,
    // then hand the slot back to the normal first-run flow (the scan).
    setFinished(true);
    window.setTimeout(() => {
      onDone({ completed: true, stepCount: total, ms: elapsedMs() });
    }, FINISHED_HOLD_MS);
  }

  function handleSkip() {
    onDone({ completed: false, stepCount: total, ms: elapsedMs() });
  }

  if (finished) {
    return (
      <div className="flex flex-col items-center gap-3 px-[18px] pb-9 pt-9">
        <span className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--calyxa-sage-border)] bg-accent-subtle">
          <CalyxaMark className="h-6 w-6" />
        </span>
        <p className="m-0 text-[14.5px] font-semibold text-foreground">You’re set</p>
        <p className="m-0 text-center text-[12.5px] text-muted-foreground">
          Tap the viewfinder whenever you’re stuck — Calyxa takes it from there.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-4 pb-4 pt-[15px]">
      <div className="flex items-center justify-between">
        <p className="m-0 text-[14.5px] font-semibold tracking-[-0.01em] text-foreground">How Calyxa works</p>
        <span className="text-[11.5px] tabular-nums text-muted-foreground">
          {index + 1} of {total}
        </span>
      </div>

      {/* Progress dots — filled for every already-visited step, half-filled
          for the current one (the Onboarding surface's idiom, kept). */}
      <div aria-hidden="true" className="flex gap-1">
        {TUTORIAL_STEPS.map((_, i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full ${
              i < index ? 'bg-accent' : i === index ? 'bg-accent/50' : 'bg-border'
            }`}
          />
        ))}
      </div>

      <span className="w-fit rounded-full bg-accent-subtle px-2 py-[2.5px] text-[9.5px] font-bold uppercase tracking-[0.06em] text-accent-emphasis">
        {step.kicker}
      </span>
      <p className="m-0 text-[14px] font-semibold leading-snug text-foreground">{step.title}</p>
      <p className="m-0 text-[12.5px] leading-relaxed text-muted-foreground">{step.body}</p>

      <div className="flex gap-1.5">
        {index > 0 && (
          <button
            type="button"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            className="h-10 cursor-pointer rounded-full border border-border bg-background px-4 text-[13.5px] font-semibold text-foreground outline-none hover:border-accent hover:bg-accent-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            Back
          </button>
        )}
        <button
          type="button"
          onClick={handleNext}
          className="h-10 flex-1 cursor-pointer rounded-full border border-border bg-background text-[13.5px] font-semibold text-foreground outline-none hover:border-accent hover:bg-accent-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          {index + 1 < total ? 'Next' : 'Got it — let’s go'}
        </button>
      </div>

      <button
        type="button"
        onClick={handleSkip}
        className="mt-0.5 cursor-pointer self-center bg-transparent text-[12px] font-medium text-muted-foreground outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        Skip the tour
      </button>
    </div>
  );
}
