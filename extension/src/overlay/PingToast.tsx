import type { StatusPin } from '../types/messages';
import { PIN_TONE } from './pings';
import { PinIcon } from './TitlePin';

// The ping toast (design handoff 8a/8b, replacing ADR-034's dynamic-island
// title swap -- the island was tried and reverted in the design pass; the
// final call is this): a single tone-tinted capsule that drops into the
// top-center of the session header whenever Calyxa records or resolves
// something, holds ~3s (Overlay.tsx's PIN_DISPLAY_MS drives the removal),
// and fades up and out. One at a time -- Overlay.tsx's queue advances a
// new signal in as the old one leaves.
//
// Pure presentational: Overlay.tsx owns the queue/dedupe/timing and keys
// this by the queue entry's id so every ping re-runs the cx-ping cycle,
// including back-to-back pins of the same kind. The cx-ping-<tone> classes
// (Overlay.css) carry the design's three tones from theme.css's
// --calyxa-ping-* tokens; the icon inherits the tone's text color through
// currentColor, same one-class-tints-everything discipline as the old pin.
export function PingToast({ pin }: { pin: StatusPin }) {
  return (
    <div
      className={`cx-ping cx-ping-${PIN_TONE[pin.kind]} pointer-events-none absolute left-1/2 top-[9px] z-30 flex items-center gap-[7px] whitespace-nowrap rounded-full border py-[7px] pl-[11px] pr-3.5 text-[12.5px] font-semibold shadow-[0_8px_22px_rgba(15,23,42,0.16)]`}
    >
      <PinIcon kind={pin.kind} />
      <span>{pin.label}</span>
    </div>
  );
}
