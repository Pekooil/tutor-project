import type { RefObject } from 'react';
import { Card } from '@calyxa/ui';
import type { ProfileOverview, ProfileTagKind, SessionRecap } from '../types/messages';
import { InsightStrip } from './InsightStrip';
import { capTags, type DisplayMessage } from './Overlay';

// One visual language for all five kinds (Task 8 spec): a short
// student-facing prefix per kind, rendered as `[prefix: label]` pills.
const TAG_KIND_PREFIX: Record<ProfileTagKind, string> = {
  reviewing: 'reviewing',
  'known-gap': 'known gap',
  'due-review': 'due review',
  strength: 'strength',
  callback: 'from a previous session',
};

// Message list + streaming tokens + profile-tag pills + typing indicator +
// scroll anchor (Sprint 14 Task 2 decomposition). Extracted from
// Overlay.tsx with zero behavior change -- every value here is a prop;
// state (messages, streamingTokens, busy, notice, liveTranscript) and the
// handlers that mutate it all still live in Overlay.tsx.
//
// The recap card renders in its exact original DOM position (between the
// message list and the live-transcript bubble, ADR-025) by delegating to
// InsightStrip -- the recap/overview JSX has one home, InsightStrip, and
// this component just calls it at the right point in the sequence rather
// than duplicating its markup.
export function Transcript({
  messages,
  streamingTokens,
  busy,
  notice,
  liveTranscript,
  recap,
  baseline,
  chatEndRef,
}: {
  messages: DisplayMessage[];
  streamingTokens: { text: string; id: number }[];
  busy: boolean;
  notice: string | null;
  liveTranscript: string;
  recap: SessionRecap | null;
  baseline: ProfileOverview | null;
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
                {msg.content}
              </p>
              {/* Profile-tag pills (Sprint 13, ADR-024): ≤2, one
                  visual language for all five kinds. Display-only --
                  stripHistory keeps them out of the outbound wire. */}
              {msg.tags && msg.tags.length > 0 && (
                <span className="flex flex-wrap gap-1.5">
                  {capTags(msg.tags).map((tag, tagIndex) => (
                    <span
                      key={tagIndex}
                      className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
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

      {/* The session recap card (Sprint 13, ADR-025): rendered once
          on SESSION_ENDED, discarded on panel close / next message. */}
      {recap && <InsightStrip kind="recap" recap={recap} baseline={baseline} />}

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
