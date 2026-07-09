import type { CSSProperties, ReactNode } from 'react';

// The section-complete celebration (design state 06 in the revised board:
// "a bloom, not confetti"). The earlier body-swap version is retired -- the
// completion no longer replaces the panel body. Instead the panel's own
// frame lights up: for ~BLOOM_MS Overlay.tsx wraps the live card in this
// frame while `bloom` is non-null, and the card underneath (header, the
// last tutor line, the input) stays fully readable the whole time -- a live
// edge, not a takeover.
//
// Three layers, all decorative (aria-hidden): a one-shot burst ring that
// expands just past the frame and fades (cx-bloom-burst), a rotating sage
// conic-gradient riding the 2px border (cx-bloom-spin), and a fade envelope
// (cx-bloom-fade) that reads the REAL unmount duration so the glow eases in
// and back out over exactly the window the JS timer runs -- the same
// shared-duration discipline as the close ring, so CSS can never drift from
// the timer that removes it. The screen-reader line names what was earned,
// since the glow itself carries no text. No confetti, no sound, no badges.
export function SectionBloomFrame({
  children,
  line,
  durationMs,
}: {
  children: ReactNode;
  // The completion line ("Choosing a method · every step was yours") --
  // announced to assistive tech, since the visual treatment is glow-only.
  line: string;
  durationMs: number;
}) {
  return (
    <div className="relative" style={{ '--cx-bloom-duration': `${durationMs}ms` } as CSSProperties}>
      <span role="status" className="sr-only">
        Section complete. {line}
      </span>
      {/* One-shot burst ring: expands just past the frame, then fades. */}
      <div
        aria-hidden="true"
        className="cx-bloom-burst pointer-events-none absolute -inset-0.5 rounded-[19px] border-[2.5px] border-accent opacity-0"
      />
      {/* Rotating gradient border: a 2px sage conic ring around the card.
          The wrapper's own border-colour fallback shows through as the
          conic fades, so the swap back to the plain card at unmount is
          seamless rather than a blink. */}
      <div className="cx-bloom-frame relative overflow-hidden rounded-[18px] p-0.5 shadow-panel">
        <div aria-hidden="true" className="cx-bloom-spin absolute inset-[-90%]" />
        <div className="relative overflow-hidden rounded-lg bg-background/90 backdrop-blur-[18px] backdrop-saturate-[1.5]">
          {children}
        </div>
      </div>
    </div>
  );
}
