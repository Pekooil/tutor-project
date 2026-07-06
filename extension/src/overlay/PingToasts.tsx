import type { TurnPing } from '../types/messages';
import { PING_KIND_COLOR_CLASS } from './Overlay';

// Event-ping toasts (Sprint 13, ADR-026; widened Sprint 14 Task 5's ping
// kinds, colored per kind Task 7). Extracted as-is from Overlay.tsx
// (Sprint 14 Task 2 decomposition -- zero behavior change at that task).
// Transient frosted-glass pills anchored ABOVE the panel (bottom-full), so
// they can never block or overlap the input row. Entry animation is
// motion-safe: gated; auto-dismiss (~4s) and the per-concept-per-kind
// dedupe gate live in Overlay.tsx (filterPingsForDisplay/showPings) -- this
// component only renders whatever active ping list it's handed, now with
// PING_KIND_COLOR_CLASS's dot/text color instead of one flat green for
// every kind. aria-live polite.
export function PingToasts({ pings }: { pings: { id: number; ping: TurnPing }[] }) {
  if (pings.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute bottom-full left-0 right-0 mb-2.5 flex flex-col items-center gap-2"
    >
      {pings.map(({ id, ping }) => (
        <div
          key={id}
          className="flex items-center gap-2 rounded-full border border-border bg-background/85 px-3.5 py-1.5 shadow-panel backdrop-blur-[18px] backdrop-saturate-[1.5] motion-safe:animate-[cx-rise_0.32s_cubic-bezier(0.2,0.8,0.2,1)_both]"
        >
          <span
            aria-hidden="true"
            className={`${PING_KIND_COLOR_CLASS[ping.kind]}-dot h-2 w-2 flex-none rounded-full`}
          />
          <span className={`${PING_KIND_COLOR_CLASS[ping.kind]} text-[12px] font-semibold`}>{ping.label}</span>
        </div>
      ))}
    </div>
  );
}
