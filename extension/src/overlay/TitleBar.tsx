import { CalyxaMark } from '@calyxa/ui';
import { WaveformBars } from './Composer';

// The title card (Sprint 10 header; Sprint 13's End-session control,
// ADR-025; Sprint 14 Task 2 decomposition). Extracted from Overlay.tsx with
// zero behavior change: logo/wordmark, the close control, and all
// session-state chrome (speaking/listening/typing badges, End session).
// Pure presentational -- props in, callbacks out; drag state, playback
// state, and the end-session request all still live in Overlay.tsx.
export function TitleBar({
  playing,
  isDragging,
  recording,
  busy,
  ending,
  onHeaderPointerDown,
  onHeaderPointerMove,
  onHeaderPointerUp,
  onInterrupt,
  onClose,
  onEndSession,
}: {
  playing: boolean;
  isDragging: boolean;
  recording: boolean;
  busy: boolean;
  ending: boolean;
  onHeaderPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onHeaderPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onHeaderPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  onInterrupt: () => void;
  onClose: () => void;
  onEndSession: () => void;
}) {
  if (playing) {
    return (
      <header
        className={`flex items-center gap-[9px] border-b border-border px-4 pb-3 pt-[14px] ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
      >
        <CalyxaMark className="h-[19px] w-[19px] flex-none" />
        <span className="text-[13.5px] font-semibold text-foreground">Calyxa</span>
        <span className="ml-auto flex items-center gap-2">
          <span className="flex h-4 items-center">
            <WaveformBars count={7} barWidth={3} gap={3} gradientFrom="#22a06b" gradientTo="#4ade80" durationBase={0.65} />
          </span>
          <span className="text-[11.5px] text-muted-foreground">Speaking</span>
          <button
            type="button"
            onClick={onInterrupt}
            aria-label="Stop speaking"
            className="flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-full border border-border bg-background p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <span aria-hidden="true" className="block h-2.5 w-2.5 rounded-[2px] bg-foreground" />
          </button>
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Calyxa"
          className="flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-full border border-border bg-background p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </header>
    );
  }

  return (
    <header
      className={`flex items-center gap-[9px] border-b border-border px-4 pb-3 pt-[14px] ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      onPointerDown={onHeaderPointerDown}
      onPointerMove={onHeaderPointerMove}
      onPointerUp={onHeaderPointerUp}
    >
      <CalyxaMark className="h-[19px] w-[19px] flex-none" />
      <span className="text-[13.5px] font-semibold text-foreground">Calyxa</span>
      {recording ? (
        <span className="ml-auto flex items-center gap-1.5 rounded-full bg-accent-subtle px-[10px] py-1 text-[11.5px] font-semibold text-accent-emphasis">
          <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-accent-glow-strong motion-safe:animate-[cx-dot_1.4s_ease-in-out_infinite]" />
          Listening
        </span>
      ) : (
        <span className="ml-auto rounded-full border border-border bg-surface px-[10px] py-1 text-[11.5px] font-semibold text-muted-foreground">
          Typing
        </span>
      )}
      {/* End-session (Sprint 13, ADR-025): the overlay's ONE new
          session control -- same END_SESSION path as the popup.
          Disabled while a turn is in flight; distinct from Close,
          which only dismisses the panel and ends nothing. */}
      <button
        type="button"
        onClick={onEndSession}
        disabled={busy || recording || ending}
        aria-label="End session"
        className="flex h-7 flex-none cursor-pointer items-center rounded-full border border-border bg-background px-2.5 text-[11px] font-semibold text-muted-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        End session
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close Calyxa"
        className="flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-full border border-border bg-background p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </header>
  );
}
