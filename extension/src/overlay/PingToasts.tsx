import type { TurnPing } from '../types/messages';

// Event-ping toasts (Sprint 13, ADR-026): extracted as-is from Overlay.tsx
// (Sprint 14 Task 2 decomposition -- zero behavior change). Transient
// frosted-glass pills anchored ABOVE the panel (bottom-full), so they can
// never block or overlap the input row. Entry animation is motion-safe:
// gated; auto-dismiss (~4s) and the dedupe gate live in Overlay.tsx
// (filterPingsForDisplay/showPings) -- this component only renders whatever
// active ping list it's handed. aria-live polite.
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
            className="h-2 w-2 flex-none rounded-full bg-accent-glow-strong shadow-[0_0_0_3px_rgba(134,239,172,0.35)]"
          />
          <span className="text-[12px] font-semibold text-accent-emphasis">{ping.label}</span>
        </div>
      ))}
    </div>
  );
}
