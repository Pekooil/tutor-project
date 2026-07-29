// The one sound in slice 1: tap accepted (spec §9.2 + §0.8).
//
// Synthesized with WebAudio rather than bundled as an asset (Darcy's call,
// 2026-07-29). That buys: zero bundled bytes, a duration guaranteed under the
// spec's 150ms by construction, no web_accessible_resources plumbing for a
// content script, and a timbre that stays tunable in code.
//
// Design constraints this encodes:
//   - under 150ms end to end
//   - pleasant at repetition (it fires 8-25 times a session), so: a soft
//     two-partial blip with a fast attack and an exponential tail, well below
//     full scale, no click on release
//   - NOTHING carries information by sound alone (spec §10) -- this is the
//     same sound for every tap; the reaction chip carries the meaning
//   - one persistent mute toggle, owned by the caller (lib/homeworkStore.ts)

/** Total envelope length. Comfortably inside the spec's 150ms ceiling. */
const DURATION_S = 0.11;
/** Peak gain -- quiet enough to sit under a student's music. */
const PEAK = 0.09;

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (context === null) {
    try {
      context = new Ctor();
    } catch {
      return null;
    }
  }
  return context;
}

/**
 * Plays the tap-accepted blip. Best-effort and synchronous-looking: it never
 * throws and never awaits, because it sits on the ≤100ms visible-reaction path
 * (spec §4) and must not delay the button depress or the bar head moving.
 *
 * A suspended context (no user gesture yet on this page) is resumed
 * opportunistically -- the tap itself IS a user gesture, so this succeeds from
 * the first tap onward.
 */
export function playTapSound(muted: boolean): void {
  if (muted) return;
  const ctx = audioContext();
  if (!ctx) return;

  try {
    if (ctx.state === 'suspended') void ctx.resume();

    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    // Fast but not instant attack (2ms) so there is no click, then an
    // exponential decay -- the shape the ear reads as "wooden", not "beep".
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(PEAK, now + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + DURATION_S);

    // Two partials a perfect fifth apart: the upper one quieter and shorter,
    // which is what keeps it from getting fatiguing on the twentieth tap.
    for (const [frequency, level, length] of [
      [660, 1, DURATION_S],
      [990, 0.4, DURATION_S * 0.6],
    ] as const) {
      const oscillator = ctx.createOscillator();
      const partial = ctx.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(frequency, now);
      partial.gain.setValueAtTime(level, now);
      oscillator.connect(partial);
      partial.connect(gain);
      oscillator.start(now);
      oscillator.stop(now + length);
    }

    // Release the node graph once the tail has finished.
    window.setTimeout(() => gain.disconnect(), Math.ceil(DURATION_S * 1000) + 60);
  } catch {
    // Autoplay policy, a closed context, an exotic embedder -- silence is an
    // entirely acceptable degradation, since no information rides the sound.
  }
}
