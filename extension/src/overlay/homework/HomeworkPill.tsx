import type { CSSProperties, ReactNode } from 'react';
import type { CompletedProblem, Outcome } from './types';
import { trioLabels } from './vocabulary';

// The pill's homework contents (design "the one morphing object"): the charge
// bar, the elapsed/remaining indicator, and the completion trio.
//
// Everything here is presentational -- no timers, no persistence, no chrome.*.
// Overlay.tsx owns the state and hands it down.

// ---- The charge bar ------------------------------------------------------

// Deterministic per-dot jitter. The design's own hash, kept verbatim so the
// texture matches the handoff exactly and, more usefully, so a given dot looks
// the same on every render instead of shimmering position on each re-render.
function jitter(index: number): number {
  const value = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

type Dot = { background: string; opacity: number; twinkle: string | null };

/**
 * The filled-vessel dot matrix. `fraction` is 0..1; columns left of the fill
 * boundary light up on the green ladder (deep at the left, bright at the
 * right), the rest stay track-colored. Pure and exported so the spec can pin
 * the boundary math.
 */
export function chargeDots(fraction: number, columns: number, rows: number): Dot[] {
  const filledColumns = Math.round(Math.max(0, Math.min(1, fraction)) * columns);
  const dots: Dot[] = [];
  for (let i = 0; i < columns * rows; i++) {
    const column = i % columns;
    const across = columns > 1 ? column / (columns - 1) : 0;
    const noise = jitter(i);
    if (column >= filledColumns) {
      dots.push({ background: 'var(--cx-hw-track)', opacity: 1, twinkle: null });
      continue;
    }
    let background =
      across > 0.85
        ? 'var(--cx-hw-d4)'
        : across > 0.6
          ? 'var(--cx-hw-d3)'
          : across > 0.35
            ? 'var(--cx-hw-d2)'
            : 'var(--cx-hw-d1)';
    if (noise > 0.82 && across > 0.2) background = 'var(--cx-hw-ds)';
    dots.push({
      background,
      opacity: Math.min(1, 0.3 + 0.7 * (0.35 + 0.65 * across) * (0.55 + 0.45 * noise)),
      twinkle: `${(1.2 + noise * 1.6).toFixed(2)}s ${(-noise * 2.4).toFixed(2)}s`,
    });
  }
  return dots;
}

/** Non-`ok` outcomes get a mark on the track -- blue tutored, green shaky. */
function outcomeMarks(completed: readonly CompletedProblem[], denominator: number) {
  return completed
    .map((problem, index) => ({ problem, index }))
    .filter((entry) => entry.problem.outcome !== 'ok')
    .map((entry) => ({
      key: entry.index,
      left: ((entry.index + 0.5) / Math.max(1, denominator)) * 100,
      background:
        entry.problem.outcome === 'tutored' ? 'var(--cx-hw-info)' : 'var(--color-accent-glow-strong)',
      title: entry.problem.outcome === 'tutored' ? 'Worked through with Calyxa' : 'Done but shaky',
    }));
}

export function ProgressTrack({
  completed,
  denominator,
  width,
  columns,
  rows,
  dotSize,
  headHeight,
  framed,
  showMarks,
}: {
  completed: readonly CompletedProblem[];
  denominator: number;
  width: number;
  columns: number;
  rows: number;
  dotSize: number;
  headHeight: number;
  framed: boolean;
  showMarks: boolean;
}) {
  const done = completed.length;
  const fraction = denominator > 0 ? done / denominator : 0;
  const dots = chargeDots(fraction, columns, rows);
  // The head never sits fully at 0 -- a bar with nothing on it still needs to
  // read as "here is where you are", not as an empty control.
  const headLeft = Math.max(fraction * 100, 3);

  const track = (
    <span className="relative block" style={{ width }}>
      <span
        aria-hidden="true"
        className="grid"
        style={{ gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 1, width }}
      >
        {dots.map((dot, index) => (
          <span
            key={index}
            className={dot.twinkle ? 'cx-hw-twinkle block' : 'block'}
            style={{
              width: dotSize,
              height: dotSize,
              borderRadius: 99,
              background: dot.background,
              opacity: dot.opacity,
              ...(dot.twinkle ? ({ '--cx-hw-twinkle': dot.twinkle } as CSSProperties) : {}),
            }}
          />
        ))}
      </span>
      <span
        aria-hidden="true"
        className="cx-hw-head absolute top-1/2"
        style={{ left: `${headLeft}%`, height: headHeight }}
      />
      {showMarks &&
        outcomeMarks(completed, denominator).map((mark) => (
          <span
            key={mark.key}
            title={mark.title}
            className="absolute top-1/2 block -translate-x-1/2 -translate-y-1/2 rounded-full border"
            style={{
              left: `${mark.left}%`,
              width: 5,
              height: 5,
              background: mark.background,
              borderColor: 'var(--cx-pill-bg)',
            }}
          />
        ))}
    </span>
  );

  return (
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={denominator}
      aria-valuenow={done}
      aria-label={`${done} of ${denominator} problems done`}
      className={
        framed
          ? 'cx-hw-frame relative flex items-center rounded-full border px-1.5 py-[5px]'
          : 'relative flex items-center'
      }
    >
      {track}
    </span>
  );
}

// ---- The remaining-time indicator ----------------------------------------

/**
 * A ring, never a countdown that can be "missed" (spec §2). It has no amber or
 * red state by construction -- there is exactly one stroke color, and it is
 * the progress green.
 */
export function RemainingRing({ minutes, fraction, size }: { minutes: number | null; fraction: number; size: number }) {
  if (minutes === null) return null;
  const radius = size >= 28 ? 13.5 : 13;
  const circumference = 2 * Math.PI * radius;
  return (
    <span
      title={`About ${minutes} min left at your pace`}
      className="relative flex-none"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 32 32" style={{ width: size, height: size, transform: 'rotate(-90deg)' }} aria-hidden="true">
        <circle cx="16" cy="16" r={radius} fill="none" stroke="var(--cx-hw-track)" strokeWidth={size >= 28 ? 3 : 4} />
        <circle
          cx="16"
          cy="16"
          r={radius}
          fill="none"
          stroke="var(--color-accent-glow-strong)"
          strokeWidth={size >= 28 ? 3 : 4}
          strokeLinecap="round"
          strokeDasharray={circumference.toFixed(1)}
          strokeDashoffset={(circumference * (1 - Math.max(0, Math.min(1, fraction)))).toFixed(1)}
          style={{ transition: 'stroke-dashoffset .5s cubic-bezier(.3,1.4,.4,1)' }}
        />
      </svg>
      {size >= 28 && (
        <span className="absolute inset-0 flex items-center justify-center text-[9.5px] font-semibold tabular-nums text-muted-foreground">
          {minutes}
        </span>
      )}
      <span className="sr-only">About {minutes} minutes left at your pace</span>
    </span>
  );
}

// ---- The completion trio -------------------------------------------------

function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]" aria-hidden="true">
      <path d="M4.5 12.5l5 5 10-11" />
    </svg>
  );
}

function QuestionGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="h-[17px] w-[17px]" aria-hidden="true">
      <path d="M9 9.5a3 3 0 1 1 4.2 2.8c-.9.45-1.2 1-1.2 1.9" />
      <circle cx="12" cy="17.6" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CrossGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="h-[15px] w-[15px]" aria-hidden="true">
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </svg>
  );
}

function TrioButton({
  label,
  primary,
  disabled,
  onClick,
  children,
}: {
  label: string;
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  // The physical press: a hard bottom edge that collapses on :active. The
  // depress is CSS-only so it lands within the spec's 100ms budget regardless
  // of what the handler goes on to do.
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`cx-hw-key flex h-[38px] w-11 flex-none cursor-pointer items-center justify-center rounded-xl outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-45 ${
        primary ? 'cx-hw-key-primary border-0' : 'cx-hw-key-secondary border'
      }`}
    >
      {children}
    </button>
  );
}

export function CompletionTrio({
  graded,
  disabled,
  onTap,
}: {
  graded: boolean;
  disabled: boolean;
  onTap: (outcome: Outcome) => void;
}) {
  const labels = trioLabels(graded);
  return (
    <div className="flex flex-none gap-1.5">
      <TrioButton label={labels.ok} primary disabled={disabled} onClick={() => onTap('ok')}>
        <CheckGlyph />
      </TrioButton>
      <TrioButton label={labels.shaky} disabled={disabled} onClick={() => onTap('shaky')}>
        <QuestionGlyph />
      </TrioButton>
      <TrioButton label={labels.stuck} disabled={disabled} onClick={() => onTap('tutored')}>
        <CrossGlyph />
      </TrioButton>
    </div>
  );
}

export function PauseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      title="Pause session — progress saved"
      aria-label="Pause session, progress saved"
      onClick={onClick}
      className="flex h-[34px] w-[34px] flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-muted-foreground outline-none transition-colors hover:bg-[var(--cx-chip-bg)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-[15px] w-[15px]" aria-hidden="true">
        <path d="M9 5.5v13M15 5.5v13" />
      </svg>
    </button>
  );
}

export function MuteButton({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      title={muted ? 'Unmute Calyxa sounds' : 'Mute Calyxa sounds'}
      aria-label={muted ? 'Unmute Calyxa sounds' : 'Mute Calyxa sounds'}
      aria-pressed={muted}
      onClick={onToggle}
      className="flex h-[34px] w-[34px] flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-muted-foreground outline-none transition-colors hover:bg-[var(--cx-chip-bg)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]" aria-hidden="true">
        <path d="M11 5.5 6.5 9H4v6h2.5L11 18.5V5.5Z" />
        {muted ? <path d="M15.5 10l4 4m0-4-4 4" /> : <path d="M15 9.5a3.5 3.5 0 0 1 0 5M17.5 7a7 7 0 0 1 0 10" />}
      </svg>
    </button>
  );
}
