import { CalyxaMark } from '@calyxa/ui';
import type { StickingChip } from './session-flow';
import type { PageTopic } from '../types/messages';

// The session-start check-in (design handoff states 05a/05b, later merged
// into one screen per Darcy's follow-up ask): a single confirm step instead
// of the original two-tap flow. The opening scan's detected page topic and
// the top-ranked predicted misconception are both pre-selected -- the
// student reviews and taps one "Start session" button rather than answering
// two separate questions. The old fixed fallback chips ("Homework set",
// "Exam prep", "Something else") are gone: this card only ever renders once
// the scan has actually detected a topic (see Overlay.tsx's showCheckin),
// so there is always a real, specific topic to confirm.
// Presentational only (the Sprint 14 Task 2 decomposition discipline):
// every value and handler is a prop from Overlay.tsx, which owns the
// check-in state and pre-selects the top sticking-point chip the moment the
// scan lands.
export function CheckinCard({
  topic,
  stickingChips,
  selectedSticking,
  disabled,
  onPickSticking,
  onStart,
  onVoice,
}: {
  // The opening scan's detected page topic -- always present while this
  // card renders (Overlay.tsx gates showCheckin on it).
  topic: PageTopic;
  // Already built by Overlay.tsx (session-flow.ts's buildStickingChips) --
  // this component renders whatever it's handed, it doesn't compute rank/
  // personalization itself (the Sprint 14 Task 2 decomposition discipline).
  // The top-ranked chip arrives pre-selected via `selectedSticking`.
  stickingChips: StickingChip[];
  selectedSticking: string | null;
  disabled: boolean;
  onPickSticking: (chip: string) => void;
  onStart: () => void;
  onVoice: () => void;
}) {
  return (
    <div className="flex flex-col gap-3.5 px-[18px] pb-[18px] pt-[18px]">
      <p className="m-0 text-[15.5px] font-semibold tracking-[-0.01em] text-foreground">Ready to start?</p>
      <div className="flex w-full items-center gap-[11px] rounded-[12px] border-[1.5px] border-accent bg-accent-subtle px-3.5 py-3 text-left">
        <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg border border-[#d6f5e1] bg-background">
          <CalyxaMark className="h-[17px] w-[17px]" />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[14px] font-semibold text-accent-foreground">{topic.title}</span>
          <span className="text-[12px] text-accent-emphasis">spotted on this page</span>
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <p className="m-0 text-[13px] font-semibold tracking-[-0.01em] text-foreground">Where it usually goes wrong</p>
        {/* Only claims personalization when at least one chip is actually
            grounded in the student's own recorded history -- a purely
            generic-filled set (cold start on this topic) gets no such
            claim, matching this codebase's grounded/never-fabricate
            discipline. */}
        {stickingChips.some((chip) => chip.personalized) && (
          <p className="m-0 text-[11px] text-accent-emphasis">
            Ranked from mistakes you&rsquo;ve made on this topic before
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {stickingChips.map((chip, index) => {
          const selected = chip.value === selectedSticking;
          return (
            <button
              key={`${chip.rank ?? 'not-sure'}-${index}`}
              type="button"
              onClick={() => onPickSticking(chip.value)}
              disabled={disabled}
              aria-pressed={selected}
              className={`cursor-pointer rounded-[12px] px-[13px] py-[11px] text-left text-[13px] leading-[1.4] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50 ${
                selected
                  ? 'border-[1.5px] border-accent bg-accent-subtle font-semibold text-accent-foreground'
                  : 'border border-border bg-background text-[#46463f] hover:border-accent hover:bg-accent-subtle'
              }`}
            >
              {chip.rank !== null && (
                <span
                  className={`mb-0.5 block text-[9.5px] font-semibold uppercase tracking-[0.05em] ${
                    chip.personalized ? 'text-accent-emphasis' : 'text-muted-foreground'
                  }`}
                >
                  Top {chip.rank} possible misconception
                </span>
              )}
              <span>{selected ? `${chip.label} ✓` : chip.label}</span>
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
      <button
        type="button"
        onClick={onVoice}
        disabled={disabled}
        className="flex cursor-pointer items-center justify-center gap-2.5 border-0 bg-transparent p-0 pt-0.5 text-[12px] text-[#9b988f] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span>or just say it</span>
        <span aria-hidden="true">·</span>
        {/* The same mic glyph the composer's voice button uses -- this slot
            holds ⌥ Space keycaps in the design board; here the row itself
            starts recording. */}
        <span aria-hidden="true" className="block h-[11px] w-[6px] rounded-full bg-[#9b988f]" />
      </button>
    </div>
  );
}
