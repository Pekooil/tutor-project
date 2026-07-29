import type { Outcome } from './types';

// Voice and text parity (spec §4 + §10). Saying "done" / "shaky" / "stuck", or
// typing them into the pill's input, must be EXACTLY equivalent to tapping the
// corresponding button. The UI must never assume the student can speak out
// loud, and it must never assume they can only speak either.

/**
 * Maps a spoken or typed utterance onto a completion tap. Returns null when
 * the utterance isn't a completion at all -- which is the normal case for a
 * real question, and the caller then routes it to the tutor as a message.
 *
 * Order matters: `stuck` is checked before `ok`, because "I got stuck" and
 * "no idea, I'm done trying" both contain an affirmative-sounding token but
 * mean help. `shaky` is checked before `ok` for the same reason ("got it but
 * not sure why" contains "got it").
 */
export function parseCompletionUtterance(raw: string): Outcome | null {
  const text = raw.toLowerCase().trim();
  if (!text) return null;
  // Anything long enough to be a real question is a question, not a tap --
  // "stuck on why the sign flips when I distribute" is a message to the tutor.
  if (text.split(/\s+/).length > 6) return null;

  if (/\b(stuck|wrong|help|no idea|nope|can'?t|cannot|lost|give up)\b/.test(text)) return 'tutored';
  if (/\b(shaky|not sure|unsure|kind of|kinda|sort of|guessed|lucky|maybe)\b/.test(text)) return 'shaky';
  if (/\b(done|got it|next|yes|yep|yeah|ok|okay|easy|finished|complete)\b/.test(text)) return 'ok';
  return null;
}

/**
 * The trio's labels (spec §1). `graded: true` means the page exposes
 * per-problem correctness, so Calyxa can honestly say "Got it" vs "Wrong".
 * Where there's no answer key the wording drops the correctness claim -- it is
 * honest in both cases, while the graded wording is dishonest if you're wrong.
 */
export function trioLabels(graded: boolean): { ok: string; shaky: string; stuck: string } {
  return graded
    ? { ok: 'Got it', shaky: 'Got it, but not sure why', stuck: 'Wrong or stuck' }
    : { ok: 'Done', shaky: 'Done but shaky', stuck: 'Stuck' };
}
