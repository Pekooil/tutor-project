import type { RefObject } from 'react';
import { Card } from '@calyxa/ui';
import type { Annotation, ProfileTagKind } from '../types/messages';
import { capTags, TAG_KIND_COLOR_CLASS, type AnnotationColorMap, type DisplayMessage } from './Overlay';

// One visual language for all five kinds (Task 8 spec): a short
// student-facing prefix per kind, rendered as `[prefix: label]` pills.
const TAG_KIND_PREFIX: Record<ProfileTagKind, string> = {
  reviewing: 'reviewing',
  'known-gap': 'known gap',
  'due-review': 'due review',
  strength: 'strength',
  callback: 'from a previous session',
};

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
// renders in Overlay.tsx, above the composer, alongside the overview
// (InsightStrip's new placement). This component gained the FIRST-bubble-
// is-assistant allowance instead (the opening scan's reply has no
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
  chatEndRef,
}: {
  messages: DisplayMessage[];
  streamingTokens: { text: string; id: number }[];
  busy: boolean;
  notice: string | null;
  liveTranscript: string;
  chatEndRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <>
      {messages.map((msg, index) =>
        msg.role === 'user' ? (
          <div key={index} className="flex justify-end">
            <p className="m-0 max-w-[80%] rounded-2xl rounded-tr-sm bg-surface px-3.5 py-2 text-[13.5px] leading-relaxed text-foreground">
              {msg.content}
            </p>
          </div>
        ) : (
          <div key={index} className="flex justify-start">
            <div className="flex max-w-[88%] flex-col items-start gap-1.5">
              <p className="m-0 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-foreground">
                {highlightAnnotatedPhrases(msg.content, msg.annotations, msg.annotationColors).map((segment, segIndex) =>
                  segment.colorClass ? (
                    <span key={segIndex} className={segment.colorClass}>
                      {segment.text}
                    </span>
                  ) : (
                    <span key={segIndex}>{segment.text}</span>
                  ),
                )}
              </p>
              {/* Profile-tag pills (Sprint 13, ADR-024; color-coded per
                  kind, Sprint 14 Task 7): ≤2, one visual language for all
                  five kinds, now with a kind->color border/text treatment
                  instead of one flat neutral style. Display-only --
                  stripHistory keeps them out of the outbound wire. */}
              {msg.tags && msg.tags.length > 0 && (
                <span className="flex flex-wrap gap-1.5">
                  {capTags(msg.tags).map((tag, tagIndex) => (
                    <span
                      key={tagIndex}
                      className={`${TAG_KIND_COLOR_CLASS[tag.kind]} rounded-full border bg-surface px-2 py-0.5 text-[11px] font-medium`}
                    >
                      {TAG_KIND_PREFIX[tag.kind]}: {tag.label}
                    </span>
                  ))}
                </span>
              )}
            </div>
          </div>
        ),
      )}

      {/* Live interim transcript from SpeechRecognition, updated word-by-word
          as the user speaks. Kept visible after recording stops until the
          accurate Whisper result is committed, to avoid a visible gap. */}
      {liveTranscript && (
        <div className="flex justify-end">
          <p className="m-0 max-w-[80%] rounded-2xl rounded-tr-sm bg-surface px-3.5 py-2 text-[13.5px] leading-relaxed text-foreground">
            {liveTranscript}
          </p>
        </div>
      )}

      {/* Streaming text (text turns) or word-reveal (voice turns).
          Each token is a separate <span key={id}> so only newly
          appended tokens trigger the cx-word-in entry animation. */}
      {busy && (
        <div className="flex justify-start">
          {streamingTokens.length > 0 ? (
            <p className="m-0 max-w-[88%] whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-foreground">
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
