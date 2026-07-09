import type { CSSProperties } from 'react';
import { CalyxaMark } from '@calyxa/ui';

// The section-complete celebration (design state 06 in the revised board):
// "a bloom, not confetti" -- and now contained ENTIRELY in the panel card,
// replacing the earlier full-page version (whose page-edge glow visually
// claimed the host page; the revised board keeps the page untouched even
// visually). Fired by Overlay.tsx when a turn lands with session.complete +
// reason "solved": for ~BLOOM_MS the panel body swaps to this -- the
// card-inset sage glow, the mark in its white orb with two staggered
// expanding rings and a radial halo, and the quiet line naming what was
// earned -- then recedes (the close choreography keeps running underneath,
// so the recap is on screen when this fades). Overlay.css's cx-bloom-cycle
// fades the whole body in and back out over the same window the JS unmount
// timer runs. No confetti, no sound, no badges.
export function SectionBloom({ line, durationMs }: { line: string; durationMs: number }) {
  return (
    <div
      role="status"
      className="cx-bloom relative overflow-hidden"
      // The same shared-duration technique as the close ring: the fade
      // cycle reads the REAL unmount timer's duration, so the CSS can never
      // drift from the JS actually removing it.
      style={{ '--cx-bloom-duration': `${durationMs}ms` } as CSSProperties}
    >
      <div aria-hidden="true" className="cx-bloom-edge pointer-events-none absolute inset-0 rounded-lg" />
      <div className="relative flex flex-col items-center px-[18px] pb-[22px] pt-[26px]">
        <div aria-hidden="true" className="relative flex h-[100px] w-[100px] items-center justify-center">
          <div className="cx-bloom-ring absolute h-[74px] w-[74px] rounded-full border-2 border-accent" />
          <div className="cx-bloom-ring cx-bloom-ring--late absolute h-[74px] w-[74px] rounded-full border-2 border-accent" />
          <div className="cx-bloom-halo absolute h-[92px] w-[92px] rounded-full" />
          <div className="relative flex h-[54px] w-[54px] items-center justify-center rounded-full border border-[var(--calyxa-sage-border)] bg-background shadow-[0_8px_24px_rgba(22,101,52,0.22)]">
            <CalyxaMark className="h-[27px] w-[27px]" />
          </div>
        </div>
        <div className="mt-3 text-[16px] font-semibold tracking-[-0.01em] text-foreground">Section complete</div>
        <div className="mt-[3px] text-[13px] text-muted-foreground">{line}</div>
      </div>
    </div>
  );
}
