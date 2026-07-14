import type { CSSProperties, ReactNode } from 'react';
import type { StickingChip } from './session-flow';
import type { PageTopic } from '../types/messages';

// The concept + misconception card ("Calyxa Ambient Pill" handoff, transient
// surface 3) — the ambient redesign of the 5a check-in. The opening scan's
// detected topic + the top predicted sticking point render as ONE floating
// card above the pill, in one of three shipped variants behind a single
// setting (default `banner`). The check-in's BEHAVIOR is kept verbatim
// (Darcy's call, 2026-07-13): the card's bottom drain bar is the auto-start
// countdown — when it empties, Overlay.tsx's real timer fires the same
// structured sessionStart kickoff the old Start button did; tapping the card
// starts immediately; and the "No, other" affordance still opens the 5b
// reframe tool. Presentational only — every value and handler is a prop.

export type ConceptVariant = 'banner' | 'stacked' | 'minimal';

// The one setting the three variants ship behind (handoff: "Three shipped
// variants behind one setting — default banner").
export const CONCEPT_CARD_VARIANT: ConceptVariant = 'banner';

// The drain bar: 2px, accent on the hairline, scaleX 1→0 over the SAME
// window Overlay.tsx's real auto-start timer runs (threaded in as
// --cx-drain-duration — the shared-duration discipline, so the bar can
// never drift from the timer that actually starts the session).
function DrainBar({ active, durationMs, inset }: { active: boolean; durationMs: number; inset: number }) {
  if (!active) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute bottom-2 h-[2px] overflow-hidden rounded-[2px] bg-border"
      style={{ left: inset, right: inset }}
    >
      <span
        className="cx-drain-fill block h-full bg-accent"
        style={{ '--cx-drain-duration': `${durationMs}ms` } as CSSProperties}
      />
    </span>
  );
}

// The quiet correction affordance (kept from the check-in — the handoff's
// card has no buttons, but retiring the reframe path was ruled out): a small
// muted text button after the body copy. Layered ABOVE the stretched start
// button (z-20 vs z-10), so a correction tap can never double as a confirm.
function ReframeLink({ disabled, onReframe }: { disabled: boolean; onReframe: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onReframe}
      className="relative z-20 cursor-pointer self-start border-0 bg-transparent p-0 text-[11.5px] font-medium text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
    >
      No, something else →
    </button>
  );
}

// One card shell shared by the three variants: the whole card is the
// confirm control — via a STRETCHED transparent button covering the card
// (the two actions stay sibling controls, never nested interactives) — with
// the auto-start announced to assistive tech since the drain bar is
// aria-hidden and absent under reduced motion (where the end state renders
// drained but the JS timer still fires).
function ConceptShell({
  width,
  radius,
  disabled,
  autoStartActive,
  autoStartMs,
  onStart,
  children,
  className,
}: {
  width?: number;
  radius?: number;
  disabled: boolean;
  autoStartActive: boolean;
  autoStartMs: number;
  onStart: () => void;
  children: ReactNode;
  className: string;
}) {
  return (
    <div
      className={`cx-card relative text-foreground ${disabled ? 'opacity-60' : ''}`}
      style={{
        ...(width ? { width, maxWidth: 'calc(100vw - 48px)' } : { maxWidth: 'calc(100vw - 48px)' }),
        ...(radius ? { borderRadius: radius } : {}),
      }}
    >
      <div className={className}>{children}</div>
      <button
        type="button"
        disabled={disabled}
        onClick={onStart}
        aria-label="Start session now"
        className="absolute inset-0 z-10 cursor-pointer rounded-[inherit] border-0 bg-transparent p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed"
      />
      {autoStartActive && (
        <span className="sr-only" aria-live="polite">
          {`Session auto-starts in ${Math.round(autoStartMs / 1000)} seconds — tap to start now, or choose "No, something else" to reframe the exact spot instead.`}
        </span>
      )}
    </div>
  );
}

export function ConceptCard({
  variant,
  topic,
  sticking,
  disabled,
  autoStartActive,
  autoStartMs,
  onStart,
  onReframe,
}: {
  variant: ConceptVariant;
  // The opening scan's detected page topic — always present while this card
  // renders (Overlay.tsx gates the concept surface on it).
  topic: PageTopic;
  // The top-ranked sticking-point prediction (buildStickingChips' first
  // chip). `personalized` keeps the honest-evidence copy: only a chip
  // grounded in the student's own recorded history may claim to come from
  // their sessions.
  sticking: StickingChip;
  disabled: boolean;
  // True while Overlay.tsx's auto-start countdown is armed — the drain bar
  // renders only then.
  autoStartActive: boolean;
  autoStartMs: number;
  onStart: () => void;
  // "No, something else" — opens the 5b reframe tool (crop the exact problem
  // and say what's tripping you up), the check-in's single correction path.
  onReframe: () => void;
}) {
  const watchLine = sticking.label.charAt(0).toLowerCase() + sticking.label.slice(1);
  const evidence = sticking.personalized
    ? 'recorded from your recent sessions'
    : 'a common first place to check';

  if (variant === 'stacked') {
    return (
      <ConceptShell
        width={400}
        disabled={disabled}
        autoStartActive={autoStartActive}
        autoStartMs={autoStartMs}
        onStart={onStart}
        className="flex flex-col gap-[11px] px-[18px] pb-[22px] pt-[15px]"
      >
        <span className="flex flex-col gap-[3px]">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Concept detected
          </span>
          <span className="text-[15px] font-semibold leading-[1.4] tracking-[-0.01em]">{topic.title}</span>
        </span>
        <span aria-hidden="true" className="block h-px bg-border" />
        <span className="flex items-start gap-[9px]">
          <span className="mt-px flex-none rounded-full bg-[var(--cx-warn-bg)] px-[9px] py-[3px] text-[10px] font-semibold uppercase tracking-[0.09em] text-danger">
            Likely slip
          </span>
          <span className="text-[13px] leading-[1.5] text-muted-foreground">
            {sticking.label} — {evidence}.
          </span>
        </span>
        <ReframeLink disabled={disabled} onReframe={onReframe} />
        <DrainBar active={autoStartActive} durationMs={autoStartMs} inset={18} />
      </ConceptShell>
    );
  }

  if (variant === 'minimal') {
    return (
      <ConceptShell
        radius={99}
        disabled={disabled}
        autoStartActive={autoStartActive}
        autoStartMs={autoStartMs}
        onStart={onStart}
        className="flex items-center gap-[9px] whitespace-nowrap px-[18px] pb-[15px] pt-[11px]"
      >
        <span aria-hidden="true" className="text-[13px] text-accent-emphasis">
          ✧
        </span>
        <span className="text-[13.5px] font-semibold tracking-[-0.005em]">{topic.title}</span>
        <span aria-hidden="true" className="text-[12px] text-muted-foreground">
          ·
        </span>
        <span className="text-[13px] text-muted-foreground">watch for {watchLine}</span>
        <DrainBar active={autoStartActive} durationMs={autoStartMs} inset={18} />
      </ConceptShell>
    );
  }

  // banner (the default)
  return (
    <ConceptShell
      width={420}
      disabled={disabled}
      autoStartActive={autoStartActive}
      autoStartMs={autoStartMs}
      onStart={onStart}
      className="flex items-start gap-3 px-[17px] pb-5 pt-3.5"
    >
      <span
        aria-hidden="true"
        className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] bg-accent-subtle text-[15px] text-accent-emphasis"
      >
        ✧
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[14px] font-semibold leading-[1.4] tracking-[-0.005em]">{topic.title}</span>
        <span className="text-[12.5px] leading-[1.55] text-muted-foreground">
          <strong className="font-semibold text-danger">Watch for:</strong> {watchLine} — {evidence}.
        </span>
        <ReframeLink disabled={disabled} onReframe={onReframe} />
      </span>
      <DrainBar active={autoStartActive} durationMs={autoStartMs} inset={17} />
    </ConceptShell>
  );
}

// The no-detection fallback (Sprint 19, restyled to the card spec): the scan
// settled without naming a topic, so there is nothing to confirm and no
// auto-start — this card routes into the SAME reframe tool the concept
// card's correction path uses, and typing/speaking from the pill stays one
// hover away the whole time.
export function ConceptFallbackCard({
  disabled,
  onFrame,
}: {
  disabled: boolean;
  onFrame: () => void;
}) {
  return (
    <div className="cx-card flex w-[400px] max-w-[calc(100vw-48px)] flex-col gap-2 px-[17px] pb-4 pt-3.5 text-foreground">
      <span className="text-[14px] font-semibold tracking-[-0.005em]">Point me to your problem</span>
      <p className="m-0 text-[12.5px] leading-[1.55] text-muted-foreground">
        I couldn&rsquo;t spot a specific problem on this page. Frame the part you&rsquo;re working on and
        I&rsquo;ll pick it up &mdash; or ask from the pill below.
      </p>
      <button
        type="button"
        onClick={onFrame}
        disabled={disabled}
        className="mt-1 flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-full border-0 bg-accent text-[13px] font-semibold text-accent-foreground outline-none hover:bg-[var(--calyxa-accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
          <path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" strokeLinecap="round" />
        </svg>
        Frame the problem
      </button>
    </div>
  );
}
