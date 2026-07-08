import type { SessionRecap } from '../types/messages';
import { conceptOutcome, pickRecapInsight } from './session-flow';

// The post-session recap (design handoff state 6b): the panel body's
// TERMINAL state, replacing the Sprint 14 floating recap window (the
// floating InsightStrip window now only ever shows the session-start
// overview). Headline, one outcome row per recap concept (filled check for
// solid/mostly, empty circle for worth-one-more-pass — conceptOutcome's
// mapping of the recorded counts), the grounded "Worth keeping" process-
// praise callout when the session earned one, and the two exits: Done for
// today (closes the panel) and One more pass (cancels the close, keeps
// working — the next turn auto-starts a fresh session). Presentational
// only; Overlay.tsx owns the recap state and both handlers.
export function RecapCard({
  recap,
  disabled,
  onDone,
  onMorePractice,
}: {
  recap: SessionRecap;
  disabled: boolean;
  onDone: () => void;
  onMorePractice: () => void;
}) {
  const insight = pickRecapInsight(recap);

  return (
    <div className="flex flex-col gap-[13px] px-[18px] pb-[18px] pt-4">
      <p className="m-0 text-[15.5px] font-semibold tracking-[-0.01em] text-foreground">
        Good session. Here&rsquo;s what stuck.
      </p>
      {recap.concepts.length > 0 && (
        <div className="flex flex-col gap-2">
          {recap.concepts.map((concept) => {
            const outcome = conceptOutcome(concept);
            return (
              <div key={concept.conceptKey} className="flex items-center gap-2.5 text-[13.5px] text-foreground">
                {outcome.kind === 'revisit' ? (
                  <span
                    aria-label="worth one more pass"
                    className="h-[18px] w-[18px] flex-none rounded-full border-[1.5px] border-border bg-background"
                  />
                ) : (
                  <span
                    aria-label="mastered"
                    className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-accent text-[10.5px] font-bold text-accent-foreground"
                  >
                    ✓
                  </span>
                )}
                <span className={outcome.kind === 'revisit' ? 'text-[#46463f]' : undefined}>{outcome.line}</span>
              </div>
            );
          })}
        </div>
      )}
      {insight && (
        <div className="rounded-[12px] border border-[#d6f5e1] bg-accent-subtle px-3.5 py-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-accent-emphasis">
            Worth keeping
          </div>
          <div className="text-[13.5px] leading-[1.55] text-accent-foreground">{insight}</div>
        </div>
      )}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onDone}
          disabled={disabled}
          className="h-[42px] flex-1 cursor-pointer rounded-full border-0 bg-accent text-[14px] font-semibold text-accent-foreground outline-none hover:bg-[#6ee7a0] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          Done for today
        </button>
        <button
          type="button"
          onClick={onMorePractice}
          disabled={disabled}
          className="h-[42px] flex-none cursor-pointer rounded-full border border-border bg-background px-4 text-[13px] text-[#46463f] outline-none hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          One more pass
        </button>
      </div>
    </div>
  );
}
