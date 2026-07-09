import { useState, type RefObject } from 'react';
import { CalyxaMark, Card } from '@calyxa/ui';
import type { AnswerField, Annotation } from '../types/messages';
import type { AnnotationColorMap, DisplayMessage } from './Overlay';
import { PinIcon } from './TitlePin';

// (The per-bubble profile-tag pills that rendered here through Sprint 14
// were retired by ADR-034 -- their signal now surfaces as ping toasts over
// the title card, PingToast.tsx, and as the milestone markers below.)

// The color-linked highlighting (Sprint 14 Task 7, ADR-029 amendment): a
// pure function so it's testable without a browser (Task 9's
// transcript-highlight.test.ts). Given the turn's `say` text, its
// annotations, and the SAME per-turn color assignment Overlay.tsx computed
// once (assignAnnotationColors) and stored on the message, returns `say`
// segmented into plain/colored runs. Only `textMatch` annotations with a
// non-empty `target.text` are candidates; a candidate with no assigned
// color (shouldn't happen -- every annotation gets one slot -- but kept as
// a defensive filter) is dropped rather than guessed at. Longest-text-first
// so a short target that happens to be a substring of a longer one (e.g.
// "5x" inside "5x + 6") never steals the match ahead of the longer, more
// specific one. Earliest-in-`say`-wins among the remaining candidates at
// each cursor position -- a near-miss (the model paraphrased instead of
// reusing the exact text) simply never matches, rendering as plain text,
// never a broken/guessed link.
export type HighlightSegment = { text: string; colorClass: string | null };

// Math display blocks (Sprint 15 fix pass): the prompt asks the tutor to wrap
// any equation/expression it is actually working in $$ ... $$ delimiters.
// splitMathBlocks segments a `say` string into prose runs and math blocks so
// the transcript renders the math ChatGPT-style -- on its own centered line,
// slightly larger and bold, with breathing room -- while the prose around it
// renders exactly as before, including the color-linked annotation
// highlighting (applied to prose runs only; a math block is already its own
// visual object, so a second highlight treatment inside it would compete).
// Whitespace adjacent to a block is trimmed (the block supplies its own
// vertical margin; a stray newline around the delimiters would double it
// under whitespace-pre-wrap). An unpaired $$ stays in the prose untouched
// rather than being guessed at.
export type SayBlock = { kind: 'text' | 'math'; text: string };

// Math prettification (Sprint 15 fix pass, round 2): the prompt constrains
// $$ blocks to plain calculator notation (x^2, sqrt(x), pi, <=), and this
// pair of pure functions renders that notation as real math -- ^ becomes a
// true superscript, sqrt/pi/theta/<=/>=/!=/+- become their symbols, * an
// interpunct -- so a block never shows caret-and-keyword syntax to the
// student. Deliberately conservative: anything unrecognized passes through
// verbatim (never a guessed transformation), and none of this touches prose
// runs or the spoken/streamed text (which strip the $$ entirely).
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
 * The board strip's current equation (design 8a: "a board strip pins the
 * current equation... updates as the problem transforms"): the LAST $$ math
 * block in the MOST RECENT tutor message that carries one -- the equation
 * the tutor most recently put up is, by construction, the one being worked.
 * Milestone entries never carry math; a session with no $$ block yet (or a
 * tutor turn of pure prose since) keeps the previous equation on the board
 * by scanning backwards until one is found. Null renders no strip at all.
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

// Message list + streaming tokens + profile-tag pills + typing indicator +
// scroll anchor (Sprint 14 Task 2 decomposition). Extracted from
// Overlay.tsx with zero behavior change -- every value here is a prop;
// state (messages, streamingTokens, busy, notice, liveTranscript) and the
// handlers that mutate it all still live in Overlay.tsx.
//
// Sprint 14 Task 7: the recap card moved OUT of this component -- it now
// renders in Overlay.tsx, above the composer. This component gained the
// FIRST-bubble-is-assistant allowance instead (the opening scan's reply has no
// preceding student message -- a purely presentational allowance; the
// `.map` below already renders whatever role sequence it's handed, so no
// code change was actually needed for that -- it already worked) and the
// color-linked highlighting (highlightAnnotatedPhrases above).
export function Transcript({
  messages,
  streamingTokens,
  busy,
  notice,
  liveTranscript,
  chips,
  chipsDisabled,
  onChipTap,
  answerFields,
  answerFieldsDisabled,
  onAnswerFieldsSubmit,
  chatEndRef,
}: {
  messages: DisplayMessage[];
  streamingTokens: { text: string; id: number }[];
  busy: boolean;
  notice: string | null;
  liveTranscript: string;
  // The LATEST tutor turn's answer chips (design 8a) -- Overlay.tsx owns the
  // state (set at turn commit, cleared the moment any student answer
  // commits), so this component only ever renders the row under the last
  // message. A tap hands the chip's RAW text up; Overlay commits it as a
  // real student turn.
  chips: string[] | null;
  chipsDisabled: boolean;
  onChipTap: (text: string) => void;
  // The LATEST tutor turn's multi-part answer fields (design 8d) -- same
  // Overlay-owned per-turn lifecycle as chips, and mutually exclusive with
  // them (a turn carries at most one). When present they render a labeled
  // textbox per unknown INSTEAD of the chip row; "Check answers" hands the
  // combined "<label> = <value>" line up for Overlay to commit as one turn.
  answerFields: AnswerField[] | null;
  answerFieldsDisabled: boolean;
  onAnswerFieldsSubmit: (combined: string) => void;
  chatEndRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <>
      {messages.map((msg, index) =>
        msg.milestone ? (
          /* Milestone marker (design 8a): a quiet centered rule row -- icon
             + one line between two hairlines, tone-tinted (sage win / amber
             watch-out). These persist after the ping toast fades; with the
             progress bar retired, the markers ARE the progress. role=status
             (not a bubble): it's the session's own annotation, not a turn. */
          <div key={index} role="status" className={`cx-msg cx-milestone-${msg.milestone.tone} my-0.5 flex items-center gap-2.5`}>
            <span aria-hidden="true" className="cx-milestone-rule h-px flex-1" />
            <span className="flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold">
              <PinIcon kind={msg.milestone.kind} size={12} />
              {msg.milestone.line}
            </span>
            <span aria-hidden="true" className="cx-milestone-rule h-px flex-1" />
          </div>
        ) : msg.role === 'user' ? (
          /* Student turns keep a bubble -- right-aligned, sage-tinted,
             radius 14/14/4/14 (design 8a: "only the student gets a
             bubble"). */
          <div key={index} className="cx-msg flex justify-end">
            <p className="m-0 max-w-[78%] rounded-[14px] rounded-br-[4px] border border-[var(--calyxa-sage-border)] bg-accent-subtle px-[13px] py-2 text-[13.5px] leading-normal text-accent-foreground">
              {msg.content}
            </p>
          </div>
        ) : (
          /* Tutor turns get NO bubble -- the 14px mark + open text sitting
             on the panel (design 8a: "Calyxa's words sit open on the
             page"). */
          <div key={index} className="cx-msg flex justify-start gap-[9px]">
            <span aria-hidden="true" className="mt-[3px] flex-none">
              <CalyxaMark className="h-3.5 w-3.5" />
            </span>
            <div className="flex max-w-[92%] flex-col items-start gap-1.5">
              <p className="m-0 w-full whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-foreground">
                {/* ChatGPT-style math layout (Sprint 15 fix pass): prose runs
                    render as before (color-linked highlighting included);
                    each $$ block renders by itself -- centered, slightly
                    larger, bold, with whitespace around it. */}
                {splitMathBlocks(msg.content).map((block, blockIndex) =>
                  block.kind === 'math' ? (
                    // The colorcoat (round 2): the same translucent-tint
                    // treatment the annotation boxes use, here as a green
                    // coat hugging the centered math -- plus real
                    // superscripts/symbols via tokenizeMathText.
                    <span key={blockIndex} className="my-2 block text-center">
                      <span className="inline-block max-w-full rounded-lg bg-accent-subtle px-3 py-1 text-[15.5px] font-semibold leading-relaxed text-accent-emphasis">
                        {tokenizeMathText(block.text).map((token, tokenIndex) =>
                          token.kind === 'sup' ? (
                            <sup key={tokenIndex}>{token.text}</sup>
                          ) : (
                            <span key={tokenIndex}>{token.text}</span>
                          ),
                        )}
                      </span>
                    </span>
                  ) : (
                    <span key={blockIndex}>
                      {highlightAnnotatedPhrases(block.text, msg.annotations, msg.annotationColors).map((segment, segIndex) =>
                        segment.colorClass ? (
                          <span key={segIndex} className={segment.colorClass}>
                            {segment.text}
                          </span>
                        ) : (
                          <span key={segIndex}>{segment.text}</span>
                        ),
                      )}
                    </span>
                  ),
                )}
              </p>
            </div>
          </div>
        ),
      )}

      {/* Answer chips (design 8a): a wrap row of white capsules indented
          23px under the tutor line (the mark's 14px + the 9px gap), hover
          sage; entering with the same message-in motion as a turn. Only the
          LATEST tutor turn ever has them (Overlay.tsx clears/replaces the
          state per turn), so rendering after the list IS "under the tutor
          line". Tapping commits the answer as a student bubble; the student
          can always still type or speak instead. A multi-part turn (design 8d,
          answerFields below) replaces this row wholesale -- the server sends at
          most one of the two, and the field panel wins if both ever arrive. */}
      {chips && chips.length > 0 && !busy && !(answerFields && answerFields.length > 0) && (
        <div className="cx-msg flex flex-wrap gap-[7px] pl-[23px]">
          {chips.map((chip) => (
            <button
              key={chip}
              type="button"
              disabled={chipsDisabled}
              onClick={() => onChipTap(chip)}
              className="cursor-pointer rounded-full border border-border bg-background px-[11px] py-[5px] text-[12px] leading-normal text-[var(--calyxa-chip-text)] outline-none transition-colors hover:border-accent hover:bg-accent-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-default disabled:opacity-50"
            >
              {/* Same superscript/symbol treatment as the transcript's math,
                  so a chip like "x^2" reads as real notation, while the tap
                  still commits the RAW calculator-notation text the model
                  understands. */}
              {tokenizeMathText(chip).map((token, tokenIndex) =>
                token.kind === 'sup' ? (
                  <sup key={tokenIndex}>{token.text}</sup>
                ) : (
                  <span key={tokenIndex}>{token.text}</span>
                ),
              )}
            </button>
          ))}
        </div>
      )}

      {/* Multi-part answer fields (design 8d): when the tutor's question
          carries more than one unknown, one labeled textbox per value replaces
          the chip row above. The key is the field labels joined, so a NEW
          multi-part turn mounts a fresh panel (its inputs reset) rather than
          reusing the previous turn's typed values. Overlay clears answerFields
          on any student answer, so this only ever belongs to the latest turn. */}
      {answerFields && answerFields.length > 0 && !busy && (
        <AnswerFields
          key={answerFields.map((field) => field.label).join('|')}
          fields={answerFields}
          disabled={answerFieldsDisabled}
          onSubmit={onAnswerFieldsSubmit}
        />
      )}

      {/* Live interim transcript from SpeechRecognition, updated word-by-word
          as the user speaks. Kept visible after recording stops until the
          accurate Whisper result is committed, to avoid a visible gap. */}
      {liveTranscript && (
        <div className="flex justify-end">
          <p className="m-0 max-w-[78%] rounded-[14px] rounded-br-[4px] border border-[var(--calyxa-sage-border)] bg-accent-subtle px-[13px] py-2 text-[13.5px] leading-normal text-accent-foreground">
            {liveTranscript}
          </p>
        </div>
      )}

      {/* Streaming text (text turns) or word-reveal (voice turns).
          Each token is a separate <span key={id}> so only newly
          appended tokens trigger the cx-word-in entry animation. */}
      {busy && (
        <div className="flex justify-start gap-[9px]">
          {streamingTokens.length > 0 && (
            <span aria-hidden="true" className="mt-[3px] flex-none">
              <CalyxaMark className="h-3.5 w-3.5" />
            </span>
          )}
          {streamingTokens.length > 0 ? (
            <p className="m-0 max-w-[92%] whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-foreground">
              {streamingTokens.map((token) => (
                <span key={token.id} className="inline-block cx-word-in">
                  {token.text}
                </span>
              ))}
              {/* Green step-blink cursor matching step 04 of the design. */}
              <span
                aria-hidden="true"
                className="inline-block w-[2px] bg-accent-glow-strong ml-[2px]"
                style={{ height: '1.05em', verticalAlign: '-0.18em', animation: 'cx-caret 1s step-end infinite' }}
              />
            </p>
          ) : (
            <TypingIndicator />
          )}
        </div>
      )}

      {notice && (
        <Card role="alert" className="border-danger px-3 py-2 text-xs text-danger !shadow-none">
          {notice}
        </Card>
      )}

      <div ref={chatEndRef} />
    </>
  );
}

// Small breathing orb shown while waiting for the first streaming chunk.
// Uses the same cx-orb / cx-ring keyframes as the old full-size thinking
// state but scaled down to ~20 px so it sits inline in the chat bubble row,
// matching the ChatGPT-style pulsing dot pattern.
function TypingIndicator() {
  return (
    <div aria-label="Calyxa is thinking" className="flex items-center py-1">
      <div className="relative flex h-5 w-5 items-center justify-center">
        <div
          aria-hidden="true"
          className="absolute h-5 w-5 rounded-full border border-accent motion-safe:animate-[cx-ring_2.6s_ease-out_infinite]"
        />
        <div
          aria-hidden="true"
          className="h-3.5 w-3.5 rounded-full shadow-[0_0_6px_rgba(74,222,128,0.45)] motion-safe:animate-[cx-orb_2.8s_ease-in-out_infinite]"
          style={{ background: 'radial-gradient(circle at 38% 32%, #dcfce7 0%, #86efac 45%, #4ade80 100%)' }}
        />
      </div>
    </div>
  );
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
// answer is never sent, mirroring the composer's own empty-input guard).
export function multiPartComplete(fields: AnswerField[], values: readonly string[]): boolean {
  return fields.length > 0 && fields.every((_, index) => (values[index] ?? '').trim().length > 0);
}

// Multi-part answer fields (design 8d "One field per unknown"): one labeled
// textbox per unknown, indented under the tutor line where the chip row would
// sit, with a single "Check answers" button that commits every value at once.
// Owns only the ephemeral typed values -- the field SPEC comes from Overlay
// (the tutor turn), and on submit the joined "<label> = <value>" line goes
// back up to Overlay to commit as one ordinary student turn (the model grades
// it, same as a typed answer -- there is no client-side answer key). A fresh
// panel mounts per multi-part turn (Transcript keys it on the labels), so the
// inputs always start empty. The panel supplements typing/speaking, never
// replaces them: the composer below stays live the whole time.
function AnswerFields({
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
    <form
      onSubmit={handleSubmit}
      className="cx-msg ml-[23px] flex flex-col gap-3 rounded-[12px] border border-border bg-[#fbfaf8] px-[15px] py-[14px]"
    >
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
