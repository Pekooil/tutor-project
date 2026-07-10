import { useRef, useState } from 'react';
import { CalyxaMark } from '@calyxa/ui';
import type { AssessmentChoiceOption, AssessmentItem, AssessmentResult } from '../types/messages';

// Sprint 17 / Task 7 (ADR-042): the cold-start onboarding assessment surface.
// Mounted by Overlay.tsx BEFORE the check-in/scanning/composer states, gated
// on the server's {needed:true} signal (GET /api/onboarding, relayed through
// the background -- ADR-006) -- a brand-new user with an empty knowledge
// graph answers a short self-check per concept once, instead of the tutor
// "calibrating" live on turn one. Presentational + a small local state
// machine (current item index, collected answers, submit/done phase); it
// never touches the tutoring loop's own state -- Overlay.tsx's
// messages/session state is untouched until onComplete/onSkip fires.
//
// The item bank (web/lib/onboarding/item-bank.ts) emits ONLY `kind: 'choice'`
// items today -- `kind: 'free'` exists in the union for a future open-
// reflection item, but AssessmentResult has no slot to grade free text into
// (seed.ts only ever derives an FSRS observation from outcome/selfConfidence),
// so there is no wire path for a free answer yet. A `free` item (should one
// ever appear) is defensively advanced past with no result recorded, rather
// than inventing an ungraded submission shape.
const CALIBRATED_HOLD_MS = 1400;

type Phase = 'answering' | 'submitting' | 'calibrated' | 'error';

export function Onboarding({
  items,
  onSubmit,
  onSkip,
  onComplete,
}: {
  items: AssessmentItem[];
  // Posts the collected results via ONBOARDING_SUBMIT (content/index.ts);
  // rejects on failure so this component can offer a retry.
  onSubmit: (results: AssessmentResult[]) => Promise<{ seededCount: number }>;
  // A true SKIP (plan: "skipping just leaves the profile empty and the tutor
  // calibrates live exactly as today") -- never calls onSubmit. Client-side
  // only for THIS page's lifetime; onboarding_completed_at is never written,
  // so a fresh page load will offer it again (no persisted "don't ask again").
  onSkip: () => void;
  // Fired once, only on a real completion (never on skip) -- Overlay.tsx uses
  // this to emit the onboarding_completed telemetry event (ADR-043).
  onComplete: (info: { itemCount: number; ms: number }) => void;
}) {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('answering');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const resultsRef = useRef<AssessmentResult[]>([]);
  const startedAtRef = useRef(performance.now());

  const total = items.length;
  const item = items[Math.min(index, total - 1)];
  const isChoice = item.kind === 'choice' && !!item.options && item.options.length > 0;

  function advance() {
    if (index + 1 < total) {
      setIndex((i) => i + 1);
    } else {
      void finish();
    }
  }

  async function finish() {
    setPhase('submitting');
    setErrorMessage(null);
    try {
      await onSubmit(resultsRef.current);
      setPhase('calibrated');
      window.setTimeout(() => {
        onComplete({
          itemCount: resultsRef.current.length,
          ms: Math.round(performance.now() - startedAtRef.current),
        });
      }, CALIBRATED_HOLD_MS);
    } catch (error) {
      setPhase('error');
      setErrorMessage(error instanceof Error ? error.message : 'Could not save your answers.');
    }
  }

  function handleChoice(option: AssessmentChoiceOption) {
    if (phase !== 'answering') return;
    resultsRef.current = [
      ...resultsRef.current,
      { conceptKey: item.conceptKey, outcome: option.outcome, selfConfidence: option.selfConfidence },
    ];
    advance();
  }

  // Retries the SAME collected results -- never re-asks already-answered
  // questions.
  function handleRetry() {
    void finish();
  }

  if (phase === 'calibrated') {
    return (
      <div className="flex flex-col items-center gap-3 px-[18px] pb-9 pt-9">
        <span className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--calyxa-sage-border)] bg-accent-subtle">
          <CalyxaMark className="h-6 w-6" />
        </span>
        <p className="m-0 text-[14.5px] font-semibold text-foreground">Calibrated</p>
        <p className="m-0 text-center text-[12.5px] text-muted-foreground">
          Your profile is ready — Calyxa now knows where to start.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-4 pb-4 pt-[15px]">
      <div className="flex items-center justify-between">
        <p className="m-0 text-[14.5px] font-semibold tracking-[-0.01em] text-foreground">Getting to know you</p>
        <span className="text-[11.5px] tabular-nums text-muted-foreground">
          {Math.min(index + 1, total)} of {total}
        </span>
      </div>

      {/* Progress dots -- filled for every already-answered question, half-
          filled for the current one. */}
      <div aria-hidden="true" className="flex gap-1">
        {items.map((_, i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full ${
              i < index ? 'bg-accent' : i === index ? 'bg-accent/50' : 'bg-border'
            }`}
          />
        ))}
      </div>

      <span className="w-fit rounded-full bg-accent-subtle px-2 py-[2.5px] text-[9.5px] font-bold uppercase tracking-[0.06em] text-accent-emphasis">
        {item.strandLabel}
      </span>
      <p className="m-0 text-[14px] font-semibold leading-snug text-foreground">{item.prompt}</p>

      {isChoice ? (
        <div className="flex flex-col gap-1.5">
          {item.options!.map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => handleChoice(option)}
              disabled={phase !== 'answering'}
              className="w-full cursor-pointer rounded-[11px] border border-border bg-background px-3 py-[9px] text-left text-[13px] font-medium text-foreground outline-none hover:border-accent hover:bg-accent-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : (
        // Defensive fallback for a kind:'free' item (never emitted by the
        // item bank today -- see file comment): no graded wire shape exists
        // for a free answer, so this advances without recording a result.
        <button
          type="button"
          onClick={advance}
          disabled={phase !== 'answering'}
          className="h-10 w-full cursor-pointer rounded-full border border-border bg-background text-[13.5px] font-semibold text-foreground outline-none hover:border-accent hover:bg-accent-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          Continue
        </button>
      )}

      {phase === 'submitting' && (
        <p aria-live="polite" className="m-0 text-center text-[12px] text-muted-foreground">
          Calibrating your profile…
        </p>
      )}

      {phase === 'error' && (
        <div className="flex flex-col gap-1.5">
          <p aria-live="assertive" className="m-0 text-[12px] text-danger">
            {errorMessage ?? 'Could not save your answers.'}
          </p>
          <button
            type="button"
            onClick={handleRetry}
            className="h-9 cursor-pointer rounded-full border border-border bg-background text-[12.5px] font-semibold text-foreground outline-none hover:border-accent hover:bg-accent-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            Try again
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onSkip}
        disabled={phase === 'submitting'}
        className="mt-0.5 cursor-pointer self-center bg-transparent text-[12px] font-medium text-muted-foreground outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        Skip for now
      </button>
    </div>
  );
}
