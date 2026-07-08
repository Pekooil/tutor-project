import type { CSSProperties } from 'react';
import { CalyxaMark } from '@calyxa/ui';

// The section-complete celebration (design handoff state 07): "a bloom,
// not confetti". Fired by Overlay.tsx when a turn lands with
// session.complete + reason "solved" (the closest real signal to a section
// boundary — the agreed mapping), replacing Sprint 15's whole-panel solved
// glow. Plays ~3 seconds over the page, then recedes (Overlay.tsx's
// BLOOM_MS timer unmounts it; the cx-bloom-cycle keyframe fades the whole
// stack in and back out over the same window). Three layers, per the
// design: the page-edge sage glow, the center orb with its halo and two
// staggered expanding rings, and the quiet frosted card naming what was
// earned. No confetti, no sound, no badges.
//
// pointer-events: none throughout — the page underneath stays fully
// interactive; z-index sits one below the panel (the annotation layer's
// slot) so the overlay itself still draws on top if they overlap.
export function SectionBloom({ line, durationMs }: { line: string; durationMs: number }) {
  return (
    <div
      role="status"
      className="cx-bloom pointer-events-none fixed inset-0 z-[2147483646] font-sans"
      // The same shared-duration technique as the close ring: the fade
      // cycle reads the REAL unmount timer's duration, so the CSS can never
      // drift from the JS actually removing it.
      style={{ '--cx-bloom-duration': `${durationMs}ms` } as CSSProperties}
    >
      <div aria-hidden="true" className="cx-bloom-edge absolute inset-0" />
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
        <div aria-hidden="true" className="relative flex h-[120px] w-[120px] items-center justify-center">
          <div className="cx-bloom-ring absolute h-[90px] w-[90px] rounded-full border-2 border-accent" />
          <div className="cx-bloom-ring cx-bloom-ring--late absolute h-[90px] w-[90px] rounded-full border-2 border-accent" />
          <div className="cx-bloom-halo absolute h-[110px] w-[110px] rounded-full" />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-full border border-[#d6f5e1] bg-background shadow-[0_8px_24px_rgba(22,101,52,0.22)]">
            <CalyxaMark className="h-8 w-8" />
          </div>
        </div>
        <div className="mt-3.5 flex flex-col items-center gap-1 rounded-lg border border-border/90 bg-background/90 px-[26px] py-4 shadow-[0_8px_24px_rgba(15,23,42,0.16)] backdrop-blur-[14px] backdrop-saturate-[1.4]">
          <div className="text-[16px] font-semibold tracking-[-0.01em] text-foreground">Section complete</div>
          <div className="text-[13px] text-muted-foreground">{line}</div>
        </div>
      </div>
    </div>
  );
}
