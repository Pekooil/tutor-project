import type { CSSProperties, RefObject } from 'react';
import { VisuallyHidden } from '@calyxa/ui';

// The input row (Sprint 10 Task 6; Sprint 14 Task 2 decomposition; Sprint
// 14 Task 7 progress bar + icon Send, ADR-028). Extracted from Overlay.tsx
// with zero behavior change at Task 2; Task 7 adds the solution-progress
// bar (a thin track along the frame's top edge, filled by Overlay.tsx's
// already-eased/clamped `solutionProgress` -- this component does no
// clamping itself, it only renders the number it's handed) and turns Send
// into an icon-only button. Owns no session state -- every value and
// handler here is a prop from Overlay.tsx, which keeps the input/recording/
// caret state and the submit/mic handlers.
export function Composer({
  hasContent,
  recording,
  level,
  input,
  busy,
  closing,
  solutionProgress,
  inputFocused,
  caretLeft,
  inputElRef,
  measureElRef,
  onSubmit,
  onInputChange,
  onCaretRefresh,
  onInputFocus,
  onInputBlur,
  onMicClick,
}: {
  hasContent: boolean;
  recording: boolean;
  level: number;
  input: string;
  busy: boolean;
  // Disables the whole composer during the close choreography (Sprint 14
  // Task 7 spec) -- a turn can't be sent while the panel is already on its
  // way to closing.
  closing: boolean;
  // 0-1, already eased/clamped by Overlay.tsx (easeProgress, ADR-028) --
  // this component just renders the bar width, no math of its own.
  solutionProgress: number;
  inputFocused: boolean;
  caretLeft: number;
  inputElRef: RefObject<HTMLInputElement | null>;
  measureElRef: RefObject<HTMLSpanElement | null>;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onCaretRefresh: () => void;
  onInputFocus: () => void;
  onInputBlur: () => void;
  onMicClick: () => void;
}) {
  const disabled = busy || closing;

  return (
    <div className={`${hasContent ? 'border-t border-border' : ''} px-[18px] pb-[14px] pt-3`}>
      {/* The solution-progress bar (Sprint 14 Task 7, ADR-028): thin,
          low-saturation, persistent -- visually distinct from the strip's
          brighter, transient auto-dismiss bar (InsightStrip.tsx). Hidden
          entirely at 0 so an unstarted problem shows no track at all. */}
      {solutionProgress > 0 && (
        <div
          role="img"
          aria-label={`Progress on this problem: ${Math.round(solutionProgress * 100)} percent`}
          className="mb-2 h-[3px] w-full overflow-hidden rounded-full bg-border"
        >
          <div
            className="cx-progress-fill h-full rounded-full transition-[width] duration-300 ease-out"
            style={{ width: `${Math.round(Math.max(0, Math.min(1, solutionProgress)) * 100)}%` }}
          />
        </div>
      )}
      <form
        onSubmit={onSubmit}
        className="flex items-center gap-2 rounded-full border border-border bg-background py-[7px] pr-[7px] pl-[18px] shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
      >
        {recording ? (
          <div className="flex h-[34px] flex-1 items-center justify-center">
            <VisuallyHidden>Recording — click the square button to stop and send</VisuallyHidden>
            <WaveformBars count={24} barWidth={3} gap={3} gradientFrom="#4ade80" gradientTo="#86efac" durationBase={0.9} level={level} />
          </div>
        ) : (
          <div className="relative flex flex-1 items-center overflow-hidden">
            {/* Hidden span with the same font as the input. getBoundingClientRect()
                on it gives the text-before-cursor width, letting us position the
                fake caret without caret-width (not supported in Chrome). */}
            <span
              ref={measureElRef}
              aria-hidden="true"
              className="pointer-events-none invisible absolute whitespace-pre text-[14.5px]"
            />
            <input
              ref={inputElRef}
              className="w-full border-none bg-transparent text-[14.5px] text-foreground outline-none placeholder:text-muted-foreground caret-transparent"
              type="text"
              value={input}
              onChange={onInputChange}
              onKeyDown={onCaretRefresh}
              onKeyUp={onCaretRefresh}
              onMouseDown={onCaretRefresh}
              onClick={onCaretRefresh}
              onSelect={onCaretRefresh}
              onScroll={onCaretRefresh}
              onFocus={onInputFocus}
              onBlur={onInputBlur}
              placeholder="Ask a math question…"
              disabled={disabled}
            />
            {inputFocused && !disabled && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 w-[2px] -translate-y-1/2 bg-accent-glow-strong"
                style={{ left: caretLeft, height: '1.05em', animation: 'cx-caret 1s step-end infinite' }}
              />
            )}
          </div>
        )}
        <button
          type="button"
          onClick={onMicClick}
          disabled={disabled && !recording}
          aria-label={recording ? 'Stop recording and send' : 'Switch to voice'}
          title={recording ? 'Stop and send' : 'Switch to voice'}
          className="flex h-[34px] w-[34px] flex-none cursor-pointer items-center justify-center rounded-full border border-border bg-background p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {recording ? (
            <span aria-hidden="true" className="block h-2.5 w-2.5 rounded-[2px] bg-muted-foreground" />
          ) : (
            <span aria-hidden="true" className="block h-[13px] w-[7px] rounded-full bg-muted-foreground" />
          )}
        </button>
        {/* Send is an icon-only ↵ enter-arrow button (Sprint 14 Task 7 spec)
            -- was a "Send" text button through Sprint 13. */}
        <button
          type="submit"
          disabled={!input.trim() || recording || disabled}
          aria-label="Send"
          title="Send"
          className="flex h-[34px] w-[34px] flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-accent p-0 text-accent-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg aria-hidden="true" width="15" height="15" viewBox="0 0 15 15" fill="none">
            <path d="M11 4V9H4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M7 6.5L4.5 9L7 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </form>
    </div>
  );
}

// Shared with TitleBar's "Speaking" waveform -- one canonical definition,
// exported here since Composer's own recording waveform is its more central
// use (Sprint 14 Task 2 decomposition; moved verbatim from Overlay.tsx).
export function WaveformBars({
  count,
  barWidth,
  gap,
  gradientFrom,
  gradientTo,
  durationBase,
  level,
}: {
  count: number;
  barWidth: number;
  gap: number;
  gradientFrom: string;
  gradientTo: string;
  durationBase: number;
  level?: number;
}) {
  const levelDriven = level !== undefined;
  return (
    <div aria-hidden="true" className="flex h-full items-center" style={{ gap }}>
      {Array.from({ length: count }, (_, index) => {
        const style: CSSProperties = {
          width: barWidth,
          background: `linear-gradient(180deg, ${gradientFrom}, ${gradientTo})`,
          transformOrigin: 'center',
        };
        if (levelDriven) {
          const restFloor = 0.12;
          const perBarGain = 0.55 + ((index * 37) % 100) / 100;
          const scale = Math.max(restFloor, Math.min(1, level * perBarGain));
          style.transform = `scaleY(${scale})`;
          style.transition = 'transform 80ms ease-out';
        } else {
          style.animationDuration = `${(durationBase + (index % 5) * 0.12).toFixed(2)}s`;
          style.animationDelay = `${((index * 0.13) % 1).toFixed(2)}s`;
        }
        return (
          <span
            key={index}
            className={levelDriven ? 'block h-full rounded-full' : 'cx-bar block h-full rounded-full'}
            style={style}
          />
        );
      })}
    </div>
  );
}
