import type { CSSProperties, RefObject } from 'react';
import { VisuallyHidden } from '@calyxa/ui';

// The input row (Sprint 10 Task 6; Sprint 14 Task 2 decomposition; Sprint
// 14 Task 7 icon Send; design-08 restyle). The Sprint 14 solution-progress
// bar is RETIRED per the design ("the progress bar is gone -- pings and
// markers ARE the progress"); the progress signal itself still drives the
// stage label and the final-step pin in Overlay.tsx. Owns no session state
// -- every value and handler here is a prop from Overlay.tsx, which keeps
// the input/recording/caret state and the submit/mic handlers.
export function Composer({
  hasContent,
  recording,
  connecting,
  level,
  input,
  busy,
  closing,
  placeholder,
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
  // Task 5 (ADR-033): true from the moment the mic button is clicked until
  // capture is actually live -- an honest "connecting…" state distinct from
  // `recording` (never faked as already-listening before the stream is
  // real). Mutually exclusive with `recording` in practice (Overlay.tsx
  // flips one off exactly as the other flips on).
  connecting: boolean;
  level: number;
  input: string;
  busy: boolean;
  // Disables the whole composer during the close choreography (Sprint 14
  // Task 7 spec) -- a turn can't be sent while the panel is already on its
  // way to closing.
  closing: boolean;
  // Contextual hint (design 8a): "Answer out loud or type here" during a
  // session, the classic ask prompt before one. Overlay.tsx decides.
  placeholder: string;
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
  const micBusy = connecting || (disabled && !recording);

  return (
    <div className={`${hasContent ? 'border-t border-border' : ''} px-[11px] pb-[10px] pt-2`}>
      <form
        onSubmit={onSubmit}
        className="flex items-center gap-[7px] rounded-full border border-border bg-background py-[5px] pr-1.5 pl-[13px] shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
      >
        {connecting ? (
          <div className="flex h-[32px] flex-1 items-center justify-center gap-2 text-[13px] text-muted-foreground">
            <VisuallyHidden>Connecting to the microphone…</VisuallyHidden>
            <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" />
            <span aria-hidden="true">Connecting…</span>
          </div>
        ) : recording ? (
          <div className="flex h-[32px] flex-1 items-center justify-center">
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
              className="pointer-events-none invisible absolute whitespace-pre text-[12.5px]"
            />
            <input
              ref={inputElRef}
              className="h-[32px] w-full border-none bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground caret-transparent"
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
              placeholder={placeholder}
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
          disabled={micBusy}
          aria-label={connecting ? 'Connecting to microphone…' : recording ? 'Stop recording and send' : 'Switch to voice'}
          title={connecting ? 'Connecting…' : recording ? 'Stop and send' : 'Switch to voice'}
          className="flex h-[26px] w-[26px] flex-none cursor-pointer items-center justify-center rounded-full border border-border bg-background p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {recording ? (
            <span aria-hidden="true" className="block h-2 w-2 rounded-[2px] bg-muted-foreground" />
          ) : (
            <span aria-hidden="true" className="block h-2.5 w-[5px] rounded-full bg-muted-foreground" />
          )}
        </button>
        {/* Send is the accent ↑ circle (design 8a compact spec: 32px). */}
        <button
          type="submit"
          disabled={!input.trim() || recording || connecting || disabled}
          aria-label="Send"
          title="Send"
          className="flex h-[32px] w-[32px] flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-accent p-0 text-[14px] font-semibold text-accent-foreground outline-none hover:bg-[var(--calyxa-accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span aria-hidden="true">↑</span>
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
