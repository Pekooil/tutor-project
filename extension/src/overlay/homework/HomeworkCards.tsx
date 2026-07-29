import { useState, type ReactNode } from 'react';
import { CalyxaMark } from '@calyxa/ui';
import { buildQuickChips, parseRangeSelection } from './denominator';
import { denominatorPrompt, type OpenerLines } from './opener';
import { plainTimeLine, type HomeworkSummary } from './summary';
import type { Reaction } from './types';

// The homework session's transient surfaces. Each one is a `.cx-card` --
// the shipped frosted shell -- so they enter and leave through the exact same
// slot, spring, and ghost-fade machinery every other overlay surface uses.

// ---- Shared button vocabulary (the design's "hard bottom edge") ----------

function PrimaryButton({
  children,
  onClick,
  disabled,
  full,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  full?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`cx-hw-key cx-hw-key-primary cursor-pointer rounded-[11px] border-0 px-3.5 py-2 text-[14px] font-semibold outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50 ${full ? 'w-full py-3 text-[14.5px]' : ''}`}
    >
      {children}
    </button>
  );
}

function QuietButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="cursor-pointer rounded-[11px] border border-border bg-transparent px-3 py-2 text-[14px] font-medium text-foreground outline-none transition-colors hover:bg-[var(--cx-chip-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function Chip({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-full border border-border bg-background px-[13px] py-[7px] text-[14px] font-medium text-foreground outline-none transition-colors hover:border-accent hover:bg-accent-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    >
      {children}
    </button>
  );
}

// ---- The opener ----------------------------------------------------------

export type OpenerCardProps = {
  lines: OpenerLines;
  count: number;
  confidence: 'high' | 'low';
  labels: readonly string[];
  /** True while the concept name is still in flight (spec §1's progressive reveal). */
  conceptPending: boolean;
  onConfirmAll: () => void;
  onConfirmSubset: (indexes: number[]) => void;
  onCancel: () => void;
};

/**
 * Scan reveal + denominator confirmation in one card (spec §2 + §3). The
 * headline renders the INSTANT the local count lands; the concept name fills
 * in after, or never. Confirmation is one tap; Adjust is the lightweight path,
 * and it is never a form.
 */
export function HomeworkOpenerCard({
  lines,
  count,
  confidence,
  labels,
  conceptPending,
  onConfirmAll,
  onConfirmSubset,
  onCancel,
}: OpenerCardProps) {
  const [adjusting, setAdjusting] = useState(confidence === 'low');
  const [range, setRange] = useState('');
  const [rangeError, setRangeError] = useState(false);
  const prompt = denominatorPrompt(count, confidence);
  const chips = buildQuickChips(labels);

  function submitRange() {
    const indexes = parseRangeSelection(range, labels);
    if (indexes.length === 0) {
      setRangeError(true);
      return;
    }
    onConfirmSubset(indexes);
  }

  return (
    <div
      role="dialog"
      aria-label="Start homework session"
      className="cx-card flex w-[460px] max-w-[calc(100vw-48px)] items-start gap-3 px-[18px] py-4 text-foreground"
    >
      <CalyxaMark aria-hidden="true" className="mt-0.5 h-[18px] w-[18px] flex-none" />
      <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
        <span className="text-[15.5px] font-semibold tracking-[-0.005em]">
          {lines.headline}
          {conceptPending && (
            <span className="cx-shimmer-text ml-1.5 text-[13px] font-medium">naming the topic…</span>
          )}
        </span>
        {lines.misconceptionLine && <span className="text-[14.5px] leading-[1.5]">{lines.misconceptionLine}</span>}
        {lines.comparisonLine && (
          <span className="text-[13.5px] text-muted-foreground">{lines.comparisonLine}</span>
        )}
        {lines.estimateLine && (
          <span className="flex items-center gap-1.5 text-[13.5px] text-muted-foreground">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[13px] w-[13px] flex-none" aria-hidden="true">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 7.5V12l3 1.8" />
            </svg>
            {lines.estimateLine}
          </span>
        )}
        {lines.forwardLine && <span className="text-[13.5px] text-muted-foreground">{lines.forwardLine}</span>}

        <span aria-hidden="true" className="my-1.5 block h-px bg-border" />

        {adjusting ? (
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[14px] text-muted-foreground">Which ones?</span>
              {chips.map((chip) => (
                <Chip key={chip.id} onClick={() => onConfirmSubset(chip.indexes)}>
                  {chip.label}
                </Chip>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                value={range}
                onChange={(event) => {
                  setRange(event.target.value);
                  setRangeError(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    submitRange();
                  }
                }}
                placeholder="1-6, 9, 11"
                aria-label="Which problems are assigned"
                aria-invalid={rangeError}
                className="min-w-0 flex-1 rounded-[10px] border border-border bg-background px-3 py-2 text-[14px] text-foreground caret-[var(--color-accent)] outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring"
              />
              <PrimaryButton onClick={submitRange}>Use these</PrimaryButton>
            </div>
            {rangeError && (
              <span role="alert" className="text-[12.5px] text-danger">
                None of those matched a problem on the page — try numbers like 1-6, 9.
              </span>
            )}
            <div className="flex items-center gap-2">
              <QuietButton onClick={() => onConfirmAll()}>All {count}</QuietButton>
              <QuietButton onClick={onCancel}>Not now</QuietButton>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[14px]">{prompt.text}</span>
            <div className="ml-auto flex gap-1.5">
              {prompt.leadWithAdjust ? (
                <>
                  <PrimaryButton onClick={() => setAdjusting(true)}>Adjust</PrimaryButton>
                  <QuietButton onClick={onConfirmAll}>All {count}</QuietButton>
                </>
              ) : (
                <>
                  <PrimaryButton onClick={onConfirmAll}>All {count}</PrimaryButton>
                  <QuietButton onClick={() => setAdjusting(true)}>Adjust</QuietButton>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- The manual-count fallback (spec §1, "0 problems found") -------------

/**
 * Never fail silently and never show a broken session: when the scan finds
 * nothing, ask. The session then proceeds completely normally.
 */
export function ManualCountCard({
  onConfirm,
  onCancel,
}: {
  onConfirm: (count: number) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const parsed = Number.parseInt(value, 10);
  const valid = Number.isFinite(parsed) && parsed > 0 && parsed <= 120;

  return (
    <div
      role="dialog"
      aria-label="How many problems are you doing?"
      className="cx-card flex w-[430px] max-w-[calc(100vw-48px)] items-start gap-3 px-[18px] py-4 text-foreground"
    >
      <CalyxaMark aria-hidden="true" className="mt-0.5 h-[18px] w-[18px] flex-none" />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <span className="text-[14.5px] leading-[1.5]">
          I couldn&apos;t pick out the problems on this page. How many are you doing?
        </span>
        <div className="flex items-center gap-2">
          <input
            value={value}
            onChange={(event) => setValue(event.target.value.replace(/[^\d]/g, ''))}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && valid) {
                event.preventDefault();
                onConfirm(parsed);
              }
            }}
            inputMode="numeric"
            placeholder="8"
            aria-label="Number of problems"
            className="w-[84px] rounded-[10px] border border-border bg-background px-3 py-2 text-[14px] text-foreground caret-[var(--color-accent)] outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring"
          />
          <PrimaryButton disabled={!valid} onClick={() => valid && onConfirm(parsed)}>
            Start
          </PrimaryButton>
          <QuietButton onClick={onCancel}>Not now</QuietButton>
        </div>
      </div>
    </div>
  );
}

// ---- The reaction chip ---------------------------------------------------

const TONE_CLASS: Record<Reaction['tone'], string> = {
  whisper: 'cx-hw-rx-whisper',
  moment: 'cx-hw-rx-moment',
  review: 'cx-hw-rx-review',
  watch: 'cx-hw-rx-watch',
};

/**
 * One reaction, with the undo folded into the chip itself (spec §4): the bar
 * can't move backward, so a mis-tap needs a way out, and the chip is already
 * the thing the student is looking at when they realise.
 */
export function ReactionChip({ reaction, onUndo }: { reaction: Reaction; onUndo: (() => void) | null }) {
  return (
    <span
      aria-live="polite"
      className={`cx-hw-rx inline-flex max-w-[460px] items-center gap-2.5 rounded-[14px] border px-[15px] py-[9px] text-[14px] font-medium leading-[1.45] ${TONE_CLASS[reaction.tone]}`}
    >
      <span>{reaction.text}</span>
      {onUndo && (
        <button
          type="button"
          onClick={onUndo}
          className="flex-none cursor-pointer rounded-full border-0 bg-transparent px-1.5 py-0.5 text-[12.5px] font-semibold underline underline-offset-2 opacity-70 outline-none transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          style={{ color: 'inherit' }}
        >
          Undo
        </button>
      )}
    </span>
  );
}

// ---- Resume (spec §7) ----------------------------------------------------

export function ResumeChip({
  label,
  onResume,
  onDismiss,
}: {
  label: string;
  onResume: () => void;
  onDismiss: () => void;
}) {
  return (
    <span className="cx-card inline-flex items-center gap-2 rounded-full py-1.5 pl-4 pr-1.5">
      <span className="text-[14px] font-semibold text-accent-emphasis">{label}</span>
      <button
        type="button"
        onClick={onResume}
        className="cx-hw-key cx-hw-key-primary cursor-pointer rounded-full border-0 px-3.5 py-1.5 text-[13px] font-semibold outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        Resume
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        title="Not now"
        className="flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-muted-foreground outline-none transition-colors hover:bg-[var(--cx-chip-bg)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-[13px] w-[13px]" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </span>
  );
}

// ---- The summary (spec §8) ----------------------------------------------

// Three tiles across a 400px card: the value must never wrap (a stat broken
// over two lines stops reading as a stat), so it is sized to fit the widest
// real string ("8 in a row") and the caption carries the wrap instead.
function StatTile({ value, caption, accent }: { value: string; caption: string; accent?: boolean }) {
  return (
    <div
      className={`flex min-w-0 flex-1 flex-col items-center rounded-xl border px-2 py-2 text-center ${
        accent ? 'border-accent bg-accent-subtle' : 'border-border bg-[var(--cx-chip-bg)]'
      }`}
    >
      <span
        className={`whitespace-nowrap text-[16px] font-semibold leading-tight ${accent ? 'text-accent-emphasis' : ''}`}
      >
        {value}
      </span>
      <span className="mt-0.5 text-[11.5px] font-medium leading-tight text-muted-foreground">{caption}</span>
    </div>
  );
}

export function HomeworkSummaryCard({
  summary,
  studyKit,
  onDone,
}: {
  summary: HomeworkSummary;
  /** Rendered only when a real kit exists -- never a promise of one. */
  studyKit: ReactNode;
  onDone: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label="Set complete"
      className="cx-card relative flex w-[400px] max-w-[calc(100vw-48px)] flex-col items-center overflow-hidden rounded-[20px] px-[22px] pb-[18px] pt-[22px] text-foreground"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(120% 60% at 50% 0%, var(--color-accent-glow), transparent 62%)', opacity: 0.35 }}
      />
      <div
        className="cx-hw-check relative flex h-12 w-12 items-center justify-center rounded-full"
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="#14532D" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-[22px] w-[22px]">
          <path d="M4.5 12.5l5 5 10-11" />
        </svg>
      </div>
      <span className="relative mt-[11px] text-[19px] font-semibold tracking-[-0.01em]">That&apos;s the set.</span>
      <span className="relative mt-1 text-[14px] font-semibold text-accent-emphasis">
        {summary.comparisonLine ?? plainTimeLine(summary.totalMinutes)}
      </span>

      <div className="relative mt-[13px] flex w-full gap-[7px]">
        <StatTile accent value={`${summary.totalMinutes} min`} caption="total" />
        <StatTile accent value={`${summary.longestRun} in a row`} caption="without help" />
        <StatTile
          value={`${summary.counts.ok} · ${summary.counts.shaky} · ${summary.counts.tutored}`}
          caption="sure · shaky · together"
        />
      </div>

      {summary.mismatchLine && (
        <span className="cx-hw-rx-watch relative mt-3 w-full rounded-xl border px-3 py-2 text-[13px] leading-[1.5]">
          {summary.mismatchLine}
        </span>
      )}

      <span className="relative mt-[11px] max-w-[330px] text-center text-[13.5px] leading-[1.5] text-muted-foreground">
        {summary.scopeLine}
      </span>

      {studyKit}

      <div className="relative mt-3.5 w-full">
        <PrimaryButton full onClick={onDone}>
          Done for tonight
        </PrimaryButton>
      </div>
    </div>
  );
}
