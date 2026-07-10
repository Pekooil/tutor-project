import { useState } from 'react';
import { CalyxaMark } from '@calyxa/ui';
import { WaveformBars } from './Composer';
import type { TutorModeKey } from './tutor-modes';

// Sprint 17 / Task 7 (ADR-039): the in-panel feedback capture kind -- mirrors
// SendFeedbackPayload['kind'] (types/messages.ts) by convention, same
// re-declaration discipline this file already follows for its own state
// slots (a small literal union, not worth an import for).
export type FeedbackKind = 'bug' | 'rating' | 'idea';

// The design handoff's shared-header state slot (state 06b): the right side
// of the header carries the recap's plain muted meta ("18 min · 5
// problems"), only while the recap is showing. Rendered just before the
// window controls (the design's header has no controls; ours keeps them).
export type HeaderAccessory = { meta: string };

// The design's sage state chip (revised board, state 5a): "Scanning" (with
// the pulsing dot) while the opening scan is in flight, "New session" while
// the check-in card is up. Overlay.tsx owns which (if either) shows.
export type HeaderChip = { label: string; pulsing: boolean };

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
  chip,
  session,
  onHeaderPointerDown,
  onHeaderPointerMove,
  onHeaderPointerUp,
  onInterrupt,
  onMinimize,
  onCloseSession,
  onSubmitFeedback,
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
  // The pre-session state chip (see HeaderChip above); null outside the
  // scanning/check-in window.
  chip?: HeaderChip | null;
  // The live-session identity (see SessionHeader above), or null for the
  // classic wordmark header.
  session?: SessionHeader | null;
  onHeaderPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onHeaderPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onHeaderPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  onInterrupt: () => void;
  onMinimize: () => void;
  onCloseSession: () => void;
  // The report/rate affordance's submit (Sprint 17 Task 7, ADR-039): the
  // popover's own open/kind/rating/message/phase state is LOCAL to this
  // component (the CheckinScan precedent -- a small, purely presentational
  // state machine that doesn't need to be shared with Overlay.tsx); this is
  // the one callback out. Overlay.tsx wires it to onReportFeedback +
  // attaches the current sessionId when one is active.
  onSubmitFeedback: (payload: { kind: FeedbackKind; rating?: number; message?: string }) => Promise<void>;
}) {
  const controlsDisabled = busy || recording || ending || closing;

  // ---- The feedback popover's local state (Sprint 17 Task 7, ADR-039) ----
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackKind, setFeedbackKind] = useState<FeedbackKind>('idea');
  const [feedbackRating, setFeedbackRating] = useState<number | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackPhase, setFeedbackPhase] = useState<'idle' | 'submitting' | 'sent' | 'error'>('idle');

  function resetFeedbackForm() {
    setFeedbackKind('idea');
    setFeedbackRating(null);
    setFeedbackMessage('');
    setFeedbackPhase('idle');
  }

  function toggleFeedback() {
    setFeedbackOpen((open) => {
      if (open) resetFeedbackForm();
      return !open;
    });
  }

  async function handleFeedbackSend() {
    setFeedbackPhase('submitting');
    try {
      await onSubmitFeedback({
        kind: feedbackKind,
        ...(feedbackKind === 'rating' && feedbackRating !== null ? { rating: feedbackRating } : {}),
        ...(feedbackMessage.trim() ? { message: feedbackMessage.trim() } : {}),
      });
      setFeedbackPhase('sent');
      window.setTimeout(() => {
        setFeedbackOpen(false);
        resetFeedbackForm();
      }, 1400);
    } catch {
      setFeedbackPhase('error');
    }
  }

  const feedbackButton = (
    <span className="relative">
      <button
        type="button"
        onClick={toggleFeedback}
        disabled={closing}
        aria-label="Send feedback"
        aria-expanded={feedbackOpen}
        className="flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded-full border border-border bg-background p-0 text-muted-foreground outline-none hover:border-accent hover:bg-accent-subtle hover:text-accent-emphasis focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg aria-hidden="true" width="11" height="10" viewBox="0 0 12 11" fill="none">
          <path
            d="M1.5 2.25C1.5 1.56 2.06 1 2.75 1h6.5c.69 0 1.25.56 1.25 1.25v4c0 .69-.56 1.25-1.25 1.25H4.75L2 9.5V7.5h-.25C1.56 7.5 1 6.94 1 6.25v-4Z"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {feedbackOpen && (
        <div className="absolute right-0 top-[34px] z-30 w-[230px] rounded-lg border border-border bg-background p-3 shadow-panel">
          {feedbackPhase === 'sent' ? (
            <p className="m-0 text-center text-[12.5px] font-medium text-foreground">Thanks for the feedback!</p>
          ) : (
            <>
              <div className="mb-2 flex gap-1.5">
                {(['bug', 'idea', 'rating'] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setFeedbackKind(kind)}
                    className={`flex-1 cursor-pointer rounded-full border px-2 py-1 text-[11px] font-semibold outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
                      feedbackKind === kind
                        ? 'border-accent bg-accent-subtle text-accent-emphasis'
                        : 'border-border bg-background text-muted-foreground hover:border-accent'
                    }`}
                  >
                    {kind === 'bug' ? 'Bug' : kind === 'idea' ? 'Idea' : 'Rate'}
                  </button>
                ))}
              </div>
              {feedbackKind === 'rating' && (
                <div className="mb-2 flex justify-center gap-1">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setFeedbackRating(value)}
                      aria-label={`Rate ${value} of 5`}
                      className={`h-6 w-6 cursor-pointer rounded-full border text-[11px] font-semibold outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
                        feedbackRating === value
                          ? 'border-accent bg-accent text-accent-foreground'
                          : 'border-border bg-background text-muted-foreground hover:border-accent'
                      }`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              )}
              <textarea
                value={feedbackMessage}
                onChange={(event) => setFeedbackMessage(event.target.value)}
                placeholder="Optional details…"
                rows={2}
                className="mb-2 w-full resize-none rounded-md border border-border bg-background p-1.5 text-[12px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              />
              {feedbackPhase === 'error' && <p className="mb-2 text-[11px] text-danger">Could not send — try again.</p>}
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={toggleFeedback}
                  className="cursor-pointer rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleFeedbackSend()}
                  disabled={feedbackPhase === 'submitting' || (feedbackKind === 'rating' && feedbackRating === null)}
                  className="cursor-pointer rounded-full border-0 bg-accent px-2.5 py-1 text-[11px] font-semibold text-accent-foreground outline-none hover:bg-[var(--calyxa-accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </span>
  );

  // The identity cluster: the live tutor mode (8c) when a session is
  // running -- chip and name recolor with a calm .45s transition on every
  // mode switch (cx-mode-<key> carries the tokens; Overlay.css) -- or the
  // mark + wordmark otherwise. min-w-0 lets the subtitle truncate before
  // the clock/controls ever get squeezed.
  const identity = session ? (
    <span className={`cx-mode-${session.modeKey} flex min-w-0 items-center gap-2.5`}>
      <span
        aria-hidden="true"
        className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border text-[14px] font-bold transition-[color,background-color,border-color,box-shadow] duration-[450ms]"
        style={{
          color: 'var(--cx-mode-text)',
          background: 'var(--cx-mode-bg)',
          borderColor: 'var(--cx-mode-border)',
          boxShadow: 'var(--cx-mode-glow)',
        }}
      >
        {session.modeGlyph}
      </span>
      {/* Tight line-heights on both lines: without them each span inherits
          the panel root's text-base 24px line-height, which pushes the mode
          name and the topic/stage subtitle far apart -- 8a stacks them
          snug (gap 1px, natural leading). */}
      <span className="flex min-w-0 flex-col gap-px">
        <span
          aria-live="polite"
          className="truncate text-[13.5px] font-semibold leading-tight tracking-[-0.01em] transition-colors duration-[450ms]"
          style={{ color: 'var(--cx-mode-text)' }}
        >
          {session.modeName}
        </span>
        <span className="truncate text-[11px] leading-tight text-muted-foreground">{session.subtitle}</span>
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
  ) : chip ? (
    <span className="flex items-center gap-1.5 rounded-full bg-accent-subtle px-[10px] py-1 text-[11.5px] font-semibold text-accent-emphasis">
      {chip.pulsing && (
        <span
          aria-hidden="true"
          className="h-[7px] w-[7px] rounded-full bg-accent-glow-strong motion-safe:animate-[cx-dot_1.4s_ease-in-out_infinite]"
        />
      )}
      {chip.label}
    </span>
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
      {feedbackButton}
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
