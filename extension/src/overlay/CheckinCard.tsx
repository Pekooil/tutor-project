import { useEffect, useState, type CSSProperties } from 'react';
import { CalyxaMark } from '@calyxa/ui';
import type { StickingChip } from './session-flow';
import type { PageTopic } from '../types/messages';

// The 5a scanning state: the panel body while the opening scan is actually
// in flight (the header shows the pulsing "Scanning" chip alongside) -- the
// breathing orb with one expanding ring, and a status line that advances
// from the page read to the profile read. The phase switch is display
// theatre timed locally (the real scan is one round trip with no progress
// signal); the body unmounts the moment the scan resolves either way, so
// the text never outlives the truth.
const SCAN_PHASE_MS = 1200;

export function CheckinScan() {
  const [phase, setPhase] = useState<0 | 1>(0);
  useEffect(() => {
    const timer = window.setTimeout(() => setPhase(1), SCAN_PHASE_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="flex flex-col items-center gap-[18px] px-[18px] pb-[38px] pt-9">
      <div aria-hidden="true" className="relative flex h-16 w-16 items-center justify-center">
        <div className="absolute h-16 w-16 rounded-full border-2 border-accent motion-safe:animate-[cx-ring_2.6s_ease-out_infinite]" />
        <div className="h-[52px] w-[52px] rounded-full bg-[radial-gradient(circle_at_38%_32%,#dcfce7_0%,#86efac_45%,#4ade80_100%)] shadow-[0_0_20px_rgba(74,222,128,0.45)] motion-safe:animate-[cx-orb_2.8s_ease-in-out_infinite]" />
      </div>
      <span aria-live="polite" className="text-[14px] tracking-[0.01em] text-muted-foreground">
        {phase === 0 ? 'Reading the page…' : 'Checking your last session…'}
      </span>
    </div>
  );
}

// The session-start check-in (design state 5a in the revised board: "one
// prediction, not a menu"). The previous pass's 2x2 sticking-point chip
// grid is retired -- the top-ranked prediction (still built by
// session-flow.ts's buildStickingChips, still personalized when the
// student's own misconception history covers it) renders as ONE glow-haloed
// card with the "AI prediction" tag, and correcting a wrong prediction now
// goes through the 5b reframe tool ("No, other") instead of picking from a
// menu. Start session auto-proceeds after AUTO_START_MS (Overlay.tsx owns
// the real timer; the button's fill sweep mirrors it) so the happy path is
// zero taps.
// Presentational only (the Sprint 14 Task 2 decomposition discipline):
// every value and handler is a prop from Overlay.tsx.
export function CheckinCard({
  topic,
  sticking,
  disabled,
  autoStartActive,
  autoStartMs,
  onStart,
  onReframe,
  onDismiss,
}: {
  // The opening scan's detected page topic -- always present while this
  // card renders (Overlay.tsx gates showCheckin on it).
  topic: PageTopic;
  // The top-ranked sticking-point prediction (buildStickingChips' first
  // chip) -- the one card 5a shows. `personalized` drives the honest
  // evidence subline: only a chip grounded in the student's own recorded
  // history may claim to come from their sessions.
  sticking: StickingChip;
  disabled: boolean;
  // True while Overlay.tsx's auto-start countdown is still armed -- the
  // fill sweep and the "Auto-starts in 5s" hint render only then.
  autoStartActive: boolean;
  autoStartMs: number;
  onStart: () => void;
  // "No, other" -- opens the 5b reframe tool (crop the exact problem).
  onReframe: () => void;
  // "Not this — pick something else" -- the topic prediction was wrong:
  // dismisses the card and hands over to the composer to just say/type it.
  onDismiss: () => void;
}) {
  const autoStartSeconds = Math.round(autoStartMs / 1000);
  return (
    <div className="flex flex-col gap-3.5 px-[18px] pb-[18px] pt-[18px]">
      <p className="m-0 text-[15.5px] font-semibold tracking-[-0.01em] text-foreground">
        What are we working on today?
      </p>
      <button
        type="button"
        onClick={onStart}
        disabled={disabled}
        className="flex w-full cursor-pointer items-center gap-[11px] rounded-[12px] border-[1.5px] border-accent bg-accent-subtle px-3.5 py-3 text-left outline-none hover:bg-[var(--calyxa-sage-wash)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg border border-[var(--calyxa-sage-border)] bg-background">
          <CalyxaMark className="h-[17px] w-[17px]" />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[14px] font-semibold text-accent-foreground">{topic.title}</span>
          <span className="text-[12px] text-accent-emphasis">
            from this page and your last session — tap to confirm
          </span>
        </span>
        <span aria-hidden="true" className="ml-auto text-[16px] text-accent-emphasis">
          →
        </span>
      </button>
      <button
        type="button"
        onClick={onDismiss}
        disabled={disabled}
        className="-mt-1 self-start cursor-pointer rounded-full border border-dashed border-[var(--calyxa-placeholder-border)] bg-transparent px-3 py-[7px] text-[12.5px] text-muted-foreground outline-none hover:border-accent hover:bg-accent-subtle hover:text-accent-emphasis focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        Not this — pick something else
      </button>
      <div aria-hidden="true" className="h-px bg-[#eceae5]" />
      <div className="flex items-center gap-2">
        <p className="m-0 text-[15.5px] font-semibold tracking-[-0.01em] text-foreground">
          Where you usually get stuck
        </p>
        <span className="cx-ai-tag rounded-full px-2 py-[2.5px] text-[9.5px] font-bold uppercase tracking-[0.06em]">
          AI prediction
        </span>
      </div>
      <div className="relative">
        <span aria-hidden="true" className="cx-checkin-halo absolute -inset-[3px] rounded-[15px]" />
        <div className="relative flex items-center gap-3 rounded-[13px] border-[1.5px] border-accent bg-accent-subtle px-[15px] py-3.5">
          <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] border border-[var(--calyxa-sage-border)] bg-background">
            <CalyxaMark className="h-[19px] w-[19px]" />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[14.5px] font-semibold text-accent-foreground">{sticking.label}</span>
            {/* Only claims the student's own history when the prediction is
                actually grounded in it -- a generic-filled cold start gets
                honest generic copy instead (the grounded/never-fabricate
                discipline). */}
            <span className="text-[12px] leading-[1.4] text-accent-emphasis">
              {sticking.personalized
                ? 'recorded from your recent sessions on this topic'
                : 'a common first place to check on this topic'}
            </span>
          </span>
        </div>
      </div>
      <div className="mt-0.5 flex gap-[9px]">
        <button
          type="button"
          onClick={onStart}
          disabled={disabled}
          className="relative h-11 flex-1 cursor-pointer overflow-hidden rounded-full border-0 bg-accent text-[14px] font-semibold text-accent-foreground outline-none hover:bg-[var(--calyxa-accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {autoStartActive && (
            <span
              aria-hidden="true"
              className="cx-autostart-fill absolute inset-y-0 left-0 w-full bg-[rgba(20,83,45,0.16)]"
              style={{ '--cx-fill-duration': `${autoStartMs}ms` } as CSSProperties}
            />
          )}
          <span className="relative">Start session</span>
        </button>
        <button
          type="button"
          onClick={onReframe}
          disabled={disabled}
          className="h-11 flex-none cursor-pointer rounded-full border border-border bg-background px-[18px] text-[14px] font-semibold text-[#46463f] outline-none hover:border-accent hover:bg-accent-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          No, other
        </button>
      </div>
      <div className="-mt-[3px] flex items-center gap-1.5 text-[11.5px] text-[var(--calyxa-hint-text)]">
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 flex-none rounded-full bg-accent-glow-strong motion-safe:animate-[cx-dot_1.4s_ease-in-out_infinite]"
        />
        {autoStartActive
          ? `Auto-starts in ${autoStartSeconds}s · tap No, other to reframe the exact spot`
          : 'Tap No, other to reframe the exact spot'}
      </div>
    </div>
  );
}
