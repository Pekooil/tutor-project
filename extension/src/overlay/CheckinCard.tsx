import { CalyxaMark } from '@calyxa/ui';
import { STICKING_CHIPS, TOPIC_FALLBACK_CHIPS } from './session-flow';
import type { PageTopic } from '../types/messages';

// The session-start check-in (design handoff state 05, "two taps, not a
// form"): the designated pre-conversation UI, replacing Sprint 15's
// KickoffCard. Two questions, chips over text fields:
//   5a "What are we working on today?" — the opening scan's detected page
//      topic as the primary suggestion card ("spotted on this page"), three
//      fixed fallback chips, and the voice escape hatch ("or just say it" —
//      the design's ⌥ Space slot; this build starts the mic directly, per
//      Darcy's carve-out, since Alt+Shift+C toggles the whole panel).
//   5b "Where does it usually go wrong?" — the answered topic with a
//      "change" link back, four sticking-point chips in a 2×2 grid, and the
//      full-width Start session button (enabled once a chip is picked).
// Presentational only (the Sprint 14 Task 2 decomposition discipline):
// every value and handler is a prop from Overlay.tsx, which owns the
// check-in stage machine and both answers.
export function CheckinCard({
  stage,
  suggestion,
  topic,
  selectedSticking,
  disabled,
  onPickTopic,
  onChangeTopic,
  onPickSticking,
  onStart,
  onVoice,
}: {
  stage: 'topic' | 'sticking';
  // The opening scan's detected page topic — absent (no card) when the scan
  // found nothing or the page carried no recognizable topic.
  suggestion?: PageTopic;
  // The 5a answer, shown on 5b's answered line.
  topic: string | null;
  selectedSticking: string | null;
  disabled: boolean;
  onPickTopic: (topic: string) => void;
  onChangeTopic: () => void;
  onPickSticking: (chip: string) => void;
  onStart: () => void;
  onVoice: () => void;
}) {
  if (stage === 'topic') {
    return (
      <div className="flex flex-col gap-3.5 px-[18px] pb-[18px] pt-[18px]">
        <p className="m-0 text-[15.5px] font-semibold tracking-[-0.01em] text-foreground">
          What are we working on today?
        </p>
        {suggestion && (
          <button
            type="button"
            onClick={() => onPickTopic(suggestion.title)}
            disabled={disabled}
            className="flex w-full cursor-pointer items-center gap-[11px] rounded-[12px] border-[1.5px] border-accent bg-accent-subtle px-3.5 py-3 text-left outline-none hover:bg-[#dcfce7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg border border-[#d6f5e1] bg-background">
              <CalyxaMark className="h-[17px] w-[17px]" />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-[14px] font-semibold text-accent-foreground">{suggestion.title}</span>
              <span className="text-[12px] text-accent-emphasis">spotted on this page — tap to confirm</span>
            </span>
            <span aria-hidden="true" className="ml-auto flex-none text-[16px] text-accent-emphasis">
              →
            </span>
          </button>
        )}
        <div className="flex flex-wrap gap-2">
          {TOPIC_FALLBACK_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => onPickTopic(chip)}
              disabled={disabled}
              className="cursor-pointer rounded-full border border-border bg-background px-3.5 py-2 text-[13px] text-[#46463f] outline-none hover:border-accent hover:bg-accent-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {chip}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onVoice}
          disabled={disabled}
          className="flex cursor-pointer items-center justify-center gap-2.5 border-0 bg-transparent p-0 pt-0.5 text-[12px] text-[#9b988f] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span>or just say it</span>
          <span aria-hidden="true">·</span>
          {/* The same mic glyph the composer's voice button uses — this slot
              holds ⌥ Space keycaps in the design board; here the row itself
              starts recording. */}
          <span aria-hidden="true" className="block h-[11px] w-[6px] rounded-full bg-[#9b988f]" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[13px] px-[18px] pb-[18px] pt-4">
      <div className="flex items-center gap-[7px] text-[12px] text-muted-foreground">
        <span aria-hidden="true" className="font-semibold text-accent-emphasis">
          ✓
        </span>
        <span className="min-w-0 truncate">{topic}</span>
        <button
          type="button"
          onClick={onChangeTopic}
          disabled={disabled}
          className="ml-auto flex-none cursor-pointer border-0 bg-transparent p-0 text-[12px] text-[#9b988f] underline underline-offset-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          change
        </button>
      </div>
      <p className="m-0 text-[15.5px] font-semibold tracking-[-0.01em] text-foreground">
        Where does it usually go wrong?
      </p>
      <div className="grid grid-cols-2 gap-2">
        {STICKING_CHIPS.map((chip) => {
          const selected = chip === selectedSticking;
          return (
            <button
              key={chip}
              type="button"
              onClick={() => onPickSticking(chip)}
              disabled={disabled}
              aria-pressed={selected}
              className={`cursor-pointer rounded-[12px] px-[13px] py-[11px] text-left text-[13px] leading-[1.4] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50 ${
                selected
                  ? 'border-[1.5px] border-accent bg-accent-subtle font-semibold text-accent-foreground'
                  : 'border border-border bg-background text-[#46463f] hover:border-accent hover:bg-accent-subtle'
              }`}
            >
              {selected ? `${chip} ✓` : chip}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onStart}
        disabled={disabled || !selectedSticking}
        className="h-[42px] w-full cursor-pointer rounded-full border-0 bg-accent text-[14px] font-semibold text-accent-foreground outline-none hover:bg-[#6ee7a0] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        Start session
      </button>
    </div>
  );
}
