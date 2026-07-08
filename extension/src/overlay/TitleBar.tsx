import { CalyxaMark } from '@calyxa/ui';
import { WaveformBars } from './Composer';
import type { TutorModeKey } from './tutor-modes';

// The design handoff's shared-header state slot (state 06b): the right side
// of the header carries the recap's plain muted meta ("18 min · 5
// problems"), only while the recap is showing. Rendered just before the
// window controls (the design's header has no controls; ours keeps them).
export type HeaderAccessory = { meta: string };

// The session header's identity (design handoff section 8c, tutor modes):
// while a tutoring session is live, the tutor MODE takes the logo's place
// -- glyph chip + mode name where the mark + wordmark sat, with the topic
// and stage dropping to an 11px subtitle, and a live clock joining the
// right side. Null renders the classic CalyxaMark + "Calyxa" identity
// (pre-session states 01-05, unchanged). Overlay.tsx owns the mode state
// and derives it per turn (tutor-modes.ts); this component only renders
// whatever it is handed.
export type SessionHeader = {
  modeKey: TutorModeKey;
  modeName: string;
  modeGlyph: string;
  // "Quadratic equations · Stage 1 of 3" -- the topic (when known) and the
  // live stage label.
  subtitle: string;
  // Elapsed m:ss, ticked by Overlay.tsx.
  clock: string;
};

// The title card (Sprint 10 header; Sprint 13's End-session control,
// ADR-025; Sprint 14 Task 2 decomposition; Sprint 14 Task 7 window-controls
// redesign, ADR-027; design-08 session-header redesign). The Sprint 15
// dynamic-island pin swap is retired -- signals now drop in as the
// PingToast over this header (Overlay.tsx renders it; the identity cluster
// itself never swaps away). `session` (8c) recolors the identity into the
// live tutor mode. Pure presentational -- props in, callbacks out; drag
// state, playback state, the ping queue, and the session-end request all
// still live in Overlay.tsx.
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
  session,
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
  // The post-session state slot (see HeaderAccessory above); null while a
  // conversation is live (the Listening/Speaking treatments own the header
  // then, unchanged) or before the recap arrives.
  accessory?: HeaderAccessory | null;
  // The live-session identity (see SessionHeader above), or null for the
  // classic wordmark header.
  session?: SessionHeader | null;
  onHeaderPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onHeaderPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onHeaderPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  onInterrupt: () => void;
  onMinimize: () => void;
  onCloseSession: () => void;
}) {
  const controlsDisabled = busy || recording || ending || closing;

  // The identity cluster: the live tutor mode (8c) when a session is
  // running -- chip and name recolor with a calm .45s transition on every
  // mode switch (cx-mode-<key> carries the tokens; Overlay.css) -- or the
  // mark + wordmark otherwise. min-w-0 lets the subtitle truncate before
  // the clock/controls ever get squeezed.
  const identity = session ? (
    <span className={`cx-mode-${session.modeKey} flex min-w-0 items-center gap-2.5`}>
      <span
        aria-hidden="true"
        className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border text-[14px] font-bold transition-colors duration-[450ms]"
        style={{
          color: 'var(--cx-mode-text)',
          background: 'var(--cx-mode-bg)',
          borderColor: 'var(--cx-mode-border)',
        }}
      >
        {session.modeGlyph}
      </span>
      <span className="flex min-w-0 flex-col gap-px">
        <span
          aria-live="polite"
          className="truncate text-[13.5px] font-semibold tracking-[-0.01em] transition-colors duration-[450ms]"
          style={{ color: 'var(--cx-mode-text)' }}
        >
          {session.modeName}
        </span>
        <span className="truncate text-[11px] text-muted-foreground">{session.subtitle}</span>
      </span>
    </span>
  ) : (
    <span className="flex min-w-0 items-center gap-[9px]">
      <CalyxaMark className="h-[19px] w-[19px] flex-none" />
      <span className="text-[13.5px] font-semibold text-foreground">Calyxa</span>
    </span>
  );

  // The design's state chip slot, right-aligned just before the window
  // controls.
  const accessorySlot = accessory ? (
    <span className="text-[11.5px] text-muted-foreground">{accessory.meta}</span>
  ) : null;

  // The live clock (8a): elapsed m:ss with the breathing green dot, only
  // while a session is running.
  const clockSlot = session ? (
    <span className="flex flex-none items-center gap-1.5 text-[11.5px] tabular-nums text-muted-foreground">
      <span
        aria-hidden="true"
        className="h-[7px] w-[7px] rounded-full bg-accent-glow-strong motion-safe:animate-[cx-dot_2.2s_ease-in-out_infinite]"
      />
      {session.clock}
    </span>
  ) : null;

  // 24px circles per the 8a spec; minimize hovers sage (collapse back to
  // the pill), close hovers the warm red (ends the session) -- theme.css's
  // --calyxa-close-hover-* set.
  const windowControls = (
    <span className="ml-auto flex items-center gap-1.5">
      {accessorySlot && <span className="mr-1 flex items-center">{accessorySlot}</span>}
      {clockSlot}
      <button
        type="button"
        onClick={onMinimize}
        disabled={closing}
        aria-label="Minimize Calyxa"
        className="flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded-full border border-border bg-background p-0 text-muted-foreground outline-none hover:border-accent hover:bg-accent-subtle hover:text-accent-emphasis focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
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
          className="relative flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded-full border border-border bg-background p-0 text-muted-foreground outline-none hover:border-[var(--calyxa-close-hover-border)] hover:bg-[var(--calyxa-close-hover-bg)] hover:text-[var(--calyxa-close-hover-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
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
        className={`flex items-center gap-2.5 border-b border-border px-3.5 pb-[9px] pt-[10px] ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
      >
        {identity}
        <span className="ml-2 flex flex-none items-center gap-2">
          <span className="flex h-4 items-center">
            <WaveformBars count={7} barWidth={3} gap={3} gradientFrom="#22a06b" gradientTo="#4ade80" durationBase={0.65} />
          </span>
          <span className="text-[11.5px] text-muted-foreground">Speaking</span>
          <button
            type="button"
            onClick={onInterrupt}
            aria-label="Stop speaking"
            className="flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded-full border border-border bg-background p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
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
      className={`flex items-center gap-2.5 border-b border-border px-3.5 pb-[9px] pt-[10px] ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      onPointerDown={onHeaderPointerDown}
      onPointerMove={onHeaderPointerMove}
      onPointerUp={onHeaderPointerUp}
    >
      {identity}
      {recording && (
        <span className="ml-2 flex flex-none items-center gap-1.5 rounded-full bg-accent-subtle px-[10px] py-1 text-[11.5px] font-semibold text-accent-emphasis">
          <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-accent-glow-strong motion-safe:animate-[cx-dot_1.4s_ease-in-out_infinite]" />
          Listening
        </span>
      )}
      {windowControls}
    </header>
  );
}
