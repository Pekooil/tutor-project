import { useState } from 'react';
import type { AnswerField, Annotation } from '../types/messages';
import type { AnnotationColorMap, DisplayMessage } from './Overlay';

// The transcript MODULE after the "Calyxa Ambient Pill" redesign: the
// scrolling message-list component is retired (there is no persistent chat
// log — the caption/reference/history cards are the only reply surfaces),
// but its pure display logic lives on unchanged and feeds those cards:
// math tokenization/blocks (caption + reference + chips), the board-equation
// derivation (the reference card's equation), the color-linked highlighting
// (caption prose), and the multi-part answer helpers + panel (the answer
// surface). Everything here stays React-lean and jsdom-testable, exactly as
// before (transcript-highlight.test.ts / transcript-math.test.ts /
// answer-fields.test.ts pin these directly).

// The color-linked highlighting (Sprint 14 Task 7, ADR-029 amendment): a
// pure function so it's testable without a browser. Given the turn's `say`
// text, its annotations, and the SAME per-turn color assignment Overlay.tsx
// computed once (assignAnnotationColors), returns `say` segmented into
// plain/colored runs. Only `textMatch` annotations with a non-empty
// `target.text` are candidates; a candidate with no assigned color is
// dropped rather than guessed at. Longest-text-first so a short target that
// happens to be a substring of a longer one never steals the match;
// earliest-in-`say`-wins among the remaining candidates at each cursor
// position — a near-miss simply never matches, rendering as plain text,
// never a broken/guessed link.
export type HighlightSegment = { text: string; colorClass: string | null };

// Math display blocks (Sprint 15 fix pass): the prompt asks the tutor to wrap
// any equation/expression it is actually working in $$ ... $$ delimiters.
// splitMathBlocks segments a `say` string into prose runs and math blocks.
// Whitespace adjacent to a block is trimmed; an unpaired $$ stays in the
// prose untouched rather than being guessed at.
export type SayBlock = { kind: 'text' | 'math'; text: string };

// Math prettification (Sprint 15 fix pass, round 2): the prompt constrains
// $$ blocks to plain calculator notation (x^2, sqrt(x), pi, <=), and this
// pair of pure functions renders that notation as real math — ^ becomes a
// true superscript, sqrt/pi/theta/<=/>=/!=/+- become their symbols, * an
// interpunct. Deliberately conservative: anything unrecognized passes
// through verbatim, and none of this touches prose runs or the spoken/
// streamed text (which strip the $$ entirely).
export type MathToken = { kind: 'text' | 'sup'; text: string };

function prettifyMathSymbols(text: string): string {
  return text
    .replace(/<=/g, '≤')
    .replace(/>=/g, '≥')
    .replace(/!=/g, '≠')
    .replace(/\+\/-|\+-/g, '±')
    .replace(/\bsqrt\b/g, '√')
    .replace(/\bpi\b/g, 'π')
    .replace(/\btheta\b/g, 'θ')
    .replace(/\binfinity\b|\binf\b/g, '∞')
    .replace(/\s*\*\s*/g, ' · ');
}

// `x^2`, `x^-1`, `x^(2n)`, `x^{2n}` -> a sup token holding "2", "-1", "2n";
// the wrapping parens/braces are display markup, not math, so they drop.
export function tokenizeMathText(raw: string): MathToken[] {
  const text = prettifyMathSymbols(raw);
  const tokens: MathToken[] = [];
  const pattern = /\^(\{[^{}]+\}|\([^()]+\)|-?[A-Za-z0-9]+)/g;
  let cursor = 0;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    if (match.index > cursor) tokens.push({ kind: 'text', text: text.slice(cursor, match.index) });
    const sup = match[1];
    tokens.push({ kind: 'sup', text: /^[{(]/.test(sup) ? sup.slice(1, -1) : sup });
    cursor = pattern.lastIndex;
  }
  if (cursor < text.length) tokens.push({ kind: 'text', text: text.slice(cursor) });
  return tokens;
}

export function splitMathBlocks(say: string): SayBlock[] {
  const blocks: SayBlock[] = [];
  const pattern = /\$\$([^$]+?)\$\$/g;
  let cursor = 0;
  let afterMath = false;
  for (let match = pattern.exec(say); match !== null; match = pattern.exec(say)) {
    let before = say.slice(cursor, match.index).replace(/\s+$/, '');
    if (afterMath) before = before.replace(/^\s+/, '');
    if (before) blocks.push({ kind: 'text', text: before });
    const math = match[1].trim();
    if (math) blocks.push({ kind: 'math', text: math });
    afterMath = true;
    cursor = pattern.lastIndex;
  }
  let tail = say.slice(cursor);
  if (afterMath) tail = tail.replace(/^\s+/, '');
  if (tail) blocks.push({ kind: 'text', text: tail });
  return blocks;
}

/**
 * The current board equation (design 8a's board strip, now the reference
 * card's equation): the LAST $$ math block in the MOST RECENT tutor message
 * that carries one — the equation the tutor most recently put up is, by
 * construction, the one being worked. Milestone entries never carry math; a
 * session with no $$ block yet (or a tutor turn of pure prose since) keeps
 * the previous equation by scanning backwards until one is found. Null
 * renders no equation at all.
 */
export function latestBoardEquation(messages: readonly DisplayMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== 'assistant' || message.milestone) continue;
    const mathBlocks = splitMathBlocks(message.content).filter((block) => block.kind === 'math');
    if (mathBlocks.length > 0) return mathBlocks[mathBlocks.length - 1].text;
  }
  return null;
}

export function highlightAnnotatedPhrases(
  say: string,
  annotations: Annotation[] | undefined,
  colorMap: AnnotationColorMap | undefined,
): HighlightSegment[] {
  const candidates = (annotations ?? [])
    .filter(
      (annotation): annotation is Annotation & { target: { text: string } } =>
        annotation.target.kind === 'textMatch' &&
        typeof annotation.target.text === 'string' &&
        annotation.target.text.length > 0 &&
        colorMap?.[annotation.id] !== undefined,
    )
    .map((annotation) => ({ text: annotation.target.text, colorClass: `cx-annot-text-${colorMap![annotation.id]}` }))
    .sort((a, b) => b.text.length - a.text.length);

  if (candidates.length === 0 || !say) return [{ text: say, colorClass: null }];

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  while (cursor < say.length) {
    let match: { index: number; text: string; colorClass: string } | null = null;
    for (const candidate of candidates) {
      const index = say.indexOf(candidate.text, cursor);
      if (index !== -1 && (match === null || index < match.index)) {
        match = { index, text: candidate.text, colorClass: candidate.colorClass };
      }
    }
    if (!match) {
      segments.push({ text: say.slice(cursor), colorClass: null });
      break;
    }
    if (match.index > cursor) {
      segments.push({ text: say.slice(cursor, match.index), colorClass: null });
    }
    segments.push({ text: match.text, colorClass: match.colorClass });
    cursor = match.index + match.text.length;
  }
  return segments;
}

// The multi-part answer's outbound form (design 8d): the filled boxes join as
// "<label> = <value>", comma-separated, so the whole answer commits as one
// student turn the model grades at once -- the same calculator notation it
// named the unknowns in. Pure + exported for the jsdom spec (the stripHistory
// precedent), and the single source of truth the component submits through.
export function formatMultiPartAnswer(fields: AnswerField[], values: readonly string[]): string {
  return fields.map((field, index) => `${field.label} = ${(values[index] ?? '').trim()}`).join(', ');
}

// Every box filled -- the check button's enable gate (a half-filled multi-part
// answer is never sent, mirroring the pill input's own empty guard).
export function multiPartComplete(fields: AnswerField[], values: readonly string[]): boolean {
  return fields.length > 0 && fields.every((_, index) => (values[index] ?? '').trim().length > 0);
}

// Multi-part answer fields (design 8d "One field per unknown", restyled to
// the ambient card spec): one labeled textbox per unknown with a single
// "Check answers" button that commits every value at once. Owns only the
// ephemeral typed values -- the field SPEC comes from Overlay (the tutor
// turn), and on submit the joined "<label> = <value>" line goes back up to
// Overlay to commit as one ordinary student turn. Overlay keys the mount on
// the field labels so a NEW multi-part turn always starts empty. The panel
// supplements typing/speaking, never replaces them: the pill stays live.
export function AnswerFields({
  fields,
  disabled,
  onSubmit,
}: {
  fields: AnswerField[];
  disabled: boolean;
  onSubmit: (combined: string) => void;
}) {
  const [values, setValues] = useState<string[]>(() => fields.map(() => ''));

  const allFilled = multiPartComplete(fields, values);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || !allFilled) return;
    onSubmit(formatMultiPartAnswer(fields, values));
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-[10px]">
        {fields.map((field, index) => (
          <label key={field.label} className="flex min-w-[150px] flex-1 flex-col gap-[5px]">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {field.label}
            </span>
            <span className="flex items-center rounded-[10px] border border-border bg-background px-3 py-2 transition-colors focus-within:border-accent">
              <input
                type="text"
                value={values[index]}
                disabled={disabled}
                placeholder={field.placeholder}
                onChange={(event) =>
                  setValues((current) => {
                    const next = [...current];
                    next[index] = event.target.value;
                    return next;
                  })
                }
                className="min-w-0 flex-1 border-none bg-transparent text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
              />
            </span>
          </label>
        ))}
      </div>
      <div className="flex items-center">
        <button
          type="submit"
          disabled={disabled || !allFilled}
          className="cursor-pointer rounded-full border-0 bg-accent px-[15px] py-[7px] text-[12.5px] font-semibold text-accent-foreground outline-none transition-colors hover:bg-[var(--calyxa-accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          Check answers
        </button>
      </div>
    </form>
  );
}
