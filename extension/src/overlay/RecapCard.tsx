import type { SessionRecap } from '../types/messages';
import { conceptOutcome } from './session-flow';

// The post-session recap (design state 7b in the revised board): the panel
// body's TERMINAL state. Four sections -- the session's concept, "What
// improved" (the solid/mostly outcome rows, filled sage checks), "Still
// needs practicing" (the worth-one-more-pass rows, empty circles under an
// amber overline), and "Generated for you" -- then one exit, Complete
// session. The outcome lines are still conceptOutcome's mapping of the
// recorded counts (recap.ts builds AFTER the reconcile, so a row can never
// disagree with the profile).
//
// "Generated for you" is a PLACEHOLDER slot: study-material generation is
// deferred to the post-beta sprints (sprint-plan call), so the two tiles
// render the board's reserved-space treatment (Overlay.css's
// .cx-recap-placeholder) and nothing else. Presentational only; Overlay.tsx
// owns the recap state and the handler.
export function RecapCard({
  recap,
  topicTitle,
  disabled,
  onDone,
}: {
  recap: SessionRecap;
  // The session's confirmed topic (check-in state), when known -- the
  // Concept headline; falls back to the recap's own first concept row.
  topicTitle: string | null;
  disabled: boolean;
  onDone: () => void;
}) {
  const outcomes = recap.concepts.map((concept) => ({
    conceptKey: concept.conceptKey,
    ...conceptOutcome(concept),
  }));
  const improved = outcomes.filter((outcome) => outcome.kind !== 'revisit');
  const practicing = outcomes.filter((outcome) => outcome.kind === 'revisit');
  const conceptTitle = topicTitle ?? recap.concepts[0]?.title ?? null;

  return (
    <div className="flex flex-col gap-3.5 px-[18px] pb-[17px] pt-[15px]">
      {conceptTitle && (
        <div>
          <div className="mb-[3px] text-[10.5px] font-semibold uppercase tracking-[0.11em] text-[var(--calyxa-hint-text)]">
            Concept
          </div>
          <div className="text-[16px] font-semibold tracking-[-0.015em] text-foreground">{conceptTitle}</div>
          {/* The board shows a curriculum unit line here ("Algebra II ·
              Unit 4"); curriculum titles never ship in this bundle
              (@calyxa/curriculum is server-side), so no line renders until
              the wire carries one -- omitted, never invented. */}
        </div>
      )}
      {improved.length > 0 && (
        <div>
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-accent-emphasis">
            What improved
          </div>
          <div className="flex flex-col gap-[7px]">
            {improved.map((outcome) => (
              <div key={outcome.conceptKey} className="flex items-center gap-2.5 text-[13.5px] text-foreground">
                <span
                  aria-label="mastered"
                  className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-accent text-[10.5px] font-bold text-accent-foreground"
                >
                  ✓
                </span>
                {outcome.line}
              </div>
            ))}
          </div>
        </div>
      )}
      {practicing.length > 0 && (
        <div>
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-[var(--calyxa-recap-practice-text)]">
            Still needs practicing
          </div>
          <div className="flex flex-col gap-[7px]">
            {practicing.map((outcome) => (
              <div key={outcome.conceptKey} className="flex items-center gap-2.5 text-[13.5px] text-[#46463f]">
                <span
                  aria-label="worth one more pass"
                  className="h-[18px] w-[18px] flex-none rounded-full border-[1.5px] border-border bg-background"
                />
                {outcome.line}
              </div>
            ))}
          </div>
        </div>
      )}
      <div>
        <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-[var(--calyxa-hint-text)]">
          Generated for you
        </div>
        <div className="grid grid-cols-2 gap-2">
          {/* Post-beta placeholders (see the component comment) -- two
              reserved tiles, straight from the board. */}
          <div className="cx-recap-placeholder flex h-[52px] items-center justify-center rounded-[10px] px-1.5 text-center font-mono text-[10px]">
            study material
          </div>
          <div className="cx-recap-placeholder flex h-[52px] items-center justify-center rounded-[10px] px-1.5 text-center font-mono text-[10px]">
            study material
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onDone}
        disabled={disabled}
        className="h-[42px] w-full cursor-pointer rounded-full border-0 bg-accent text-[14px] font-semibold text-accent-foreground outline-none hover:bg-[var(--calyxa-accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        Complete session
      </button>
    </div>
  );
}
