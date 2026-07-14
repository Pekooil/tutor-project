import type { StatusPin } from '../types/messages';
import { PIN_TONE } from './pings';
import { PinIcon } from './TitlePin';

// The ping toast (design 8a/8b, re-homed by the "Calyxa Ambient Pill"
// redesign): the same tone-tinted capsule, now mounted as a transient card
// in the single surface slot above the pill (there is no session header
// anymore) — one at a time, held for PIN_DISPLAY_MS by Overlay.tsx's queue,
// which only advances while the slot is actually free (a caption/concept/
// answer card outranks a ping, so a signal is never burned invisibly).
//
// Pure presentational: Overlay.tsx owns the queue/dedupe/timing and keys
// this by the queue entry's id so every ping re-runs the entry animation,
// including back-to-back pins of the same kind. The cx-ping-<tone> classes
// (Overlay.css) carry the design's three tones from theme.css's
// --calyxa-ping-* tokens; the icon inherits the tone's text color through
// currentColor, same one-class-tints-everything discipline as before.
export function PingToast({ pin }: { pin: StatusPin }) {
  return (
    <div
      className={`cx-ping-${PIN_TONE[pin.kind]} flex items-center gap-[7px] whitespace-nowrap rounded-full border py-[7px] pl-[11px] pr-3.5 text-[12.5px] font-semibold shadow-[0_8px_22px_rgba(15,23,42,0.16)] backdrop-blur-[22px] backdrop-saturate-[1.5]`}
    >
      <PinIcon kind={pin.kind} />
      <span>{pin.label}</span>
    </div>
  );
}
