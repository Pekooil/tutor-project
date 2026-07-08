import { CalyxaMark } from '@calyxa/ui';
import { WaveformBars } from './Composer';

// The design handoff's shared-header state slot (states 05/06): the right
// side of the header carries the check-in's two 16×4 progress bars, the
// plan's "Today's plan" green-tint chip, or the recap's plain muted meta
// ("18 min · 5 problems") — one at a time, only while the matching
// pre/post-session surface is showing. Rendered just before the window
// controls (the design's header has no controls; ours keeps them).
export type HeaderAccessory =
  | { kind: 'checkin'; step: 1 | 2 }
  | { kind: 'plan' }
  | { kind: 'recap'; meta: string };

// The title card (Sprint 10 header; Sprint 13's End-session control,
// ADR-025; Sprint 14 Task 2 decomposition; Sprint 14 Task 7 window-controls
// redesign, ADR-027). Extracted from Overlay.tsx with zero behavior change
// at Task 2; Task 7 replaces the standalone "End session" text button and
// the Typing/Listening mode chip with real window controls: − minimizes
// (today's old ✕ behavior -- collapse to pill, session continues,
// unchanged recap discipline) and ✕ ends the session (today's old "End
// session" behavior), now wrapped in a green conic-gradient ring that
// sweeps over ~CLOSE_RING_MS while the close choreography runs
// (Overlay.tsx owns the timing; this component only reads `ringing` +
// `ringDurationMs` to animate). Pure presentational -- props in, callbacks
// out; drag state, playback state, and the session-end request all still
// live in Overlay.tsx.
export function TitleBar({
  playing,
  isDragging,
  recording,
  busy,
  ending,
  closing,
  ringing,
  ringDurationMs,
  accessory,
  onHeaderPointerDown,
  onHeaderPointerMove,
  onHeaderPointerUp,
  onInterrupt,
  onMinimize,
  onCloseSession,
}: {
  playing: boolean;
  isDragging: boolean;
  recording: boolean;
  busy: boolean;
  ending: boolean;
  // True for the WHOLE close choreography (completing + ringing) -- both
  // window controls disable during it, not just while the ring itself is
  // sweeping (Task 7 spec: "composer disabled during the close
  // choreography", same discipline applies to the title bar's own controls
  // so a stray click can't fight the close already in flight).
  closing: boolean;
  // True only during the ring's own ~CLOSE_RING_MS sweep (a strict subset
  // of `closing`) -- gates the ring's visibility/animation specifically.
  ringing: boolean;
  ringDurationMs: number;
  // The pre/post-session state slot (see HeaderAccessory above); null while
  // a conversation is live (the Listening/Speaking treatments own the header
  // then, unchanged).
  accessory?: HeaderAccessory | null;
  onHeaderPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onHeaderPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onHeaderPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  onInterrupt: () => void;
  onMinimize: () => void;
  onCloseSession: () => void;
}) {
  const controlsDisabled = busy || recording || ending || closing;

  // The design's state chip / progress-bar slot, right-aligned just before
  // the window controls.
  const accessorySlot = !accessory ? null : accessory.kind === 'checkin' ? (
    <span
      role="img"
      aria-label={`Check-in question ${accessory.step} of 2`}
      className="flex items-center gap-[5px]"
    >
      <span className="h-1 w-4 rounded-full bg-accent-glow-strong" />
      <span className={`h-1 w-4 rounded-full ${accessory.step === 2 ? 'bg-accent-glow-strong' : 'bg-border'}`} />
    </span>
  ) : accessory.kind === 'plan' ? (
    <span className="rounded-full bg-accent-subtle px-2.5 py-1 text-[11.5px] font-semibold text-accent-emphasis">
      Today&rsquo;s plan
    </span>
  ) : (
    <span className="text-[11.5px] text-muted-foreground">{accessory.meta}</span>
  );

  const windowControls = (
    <span className="ml-auto flex items-center gap-1.5">
      {accessorySlot && <span className="mr-1 flex items-center">{accessorySlot}</span>}
      <button
        type="button"
        onClick={onMinimize}
        disabled={closing}
        aria-label="Minimize Calyxa"
        className="flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-full border border-border bg-background p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M1.5 5H8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      <span
        className={ringing ? 'cx-close-ring' : ''}
        style={ringing ? ({ '--cx-ring-duration': `${ringDurationMs}ms` } as React.CSSProperties) : undefined}
      >
        <button
          type="button"
          onClick={onCloseSession}
          disabled={controlsDisabled}
          aria-label="End tutoring session"
          className="relative flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-full border border-border bg-background p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </span>
    </span>
  );

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
        <span className="ml-2 flex items-center gap-2">
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
        {windowControls}
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
      {recording && (
        <span className="ml-2 flex items-center gap-1.5 rounded-full bg-accent-subtle px-[10px] py-1 text-[11.5px] font-semibold text-accent-emphasis">
          <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-accent-glow-strong motion-safe:animate-[cx-dot_1.4s_ease-in-out_infinite]" />
          Listening
        </span>
      )}
      {windowControls}
    </header>
  );
}
