import { useState } from 'react';

// The report/rate affordance (Sprint 17 Task 7, ADR-039), re-homed by the
// "Calyxa Ambient Pill" redesign: the form that lived in TitleBar's popover
// now mounts as a transient card in the single surface slot (opened from
// the hover pill's feedback button while a session is live). The form's
// state machine — kind, star rating, optional message, submit phase — is
// ported verbatim from the retired TitleBar; only the shell changed.
// Overlay.tsx wires onSubmit to onReportFeedback + the fresh sessionId
// lookup, exactly as before.

export type FeedbackKind = 'bug' | 'rating' | 'idea';

export function FeedbackCard({
  onSubmit,
  onClose,
}: {
  // Rejects on a save failure so the card can surface a retry.
  onSubmit: (payload: { kind: FeedbackKind; rating?: number; message?: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<FeedbackKind>('idea');
  const [rating, setRating] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'sent' | 'error'>('idle');

  async function handleSend() {
    setPhase('submitting');
    try {
      await onSubmit({
        kind,
        ...(kind === 'rating' && rating !== null ? { rating } : {}),
        ...(message.trim() ? { message: message.trim() } : {}),
      });
      setPhase('sent');
      window.setTimeout(onClose, 1400);
    } catch {
      setPhase('error');
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Send feedback"
      className="cx-card w-[280px] max-w-[calc(100vw-48px)] p-3.5 text-foreground"
    >
      {phase === 'sent' ? (
        <p className="m-0 py-1 text-center text-[12.5px] font-medium">Thanks for the feedback!</p>
      ) : (
        <>
          <div className="mb-2 flex gap-1.5">
            {(['bug', 'idea', 'rating'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setKind(option)}
                className={`flex-1 cursor-pointer rounded-full border px-2 py-1 text-[11px] font-semibold outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
                  kind === option
                    ? 'border-accent bg-accent-subtle text-accent-emphasis'
                    : 'border-border bg-transparent text-muted-foreground hover:border-accent'
                }`}
              >
                {option === 'bug' ? 'Bug' : option === 'idea' ? 'Idea' : 'Rate'}
              </button>
            ))}
          </div>
          {kind === 'rating' && (
            <div className="mb-2 flex justify-center gap-1">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRating(value)}
                  aria-label={`Rate ${value} of 5`}
                  className={`h-6 w-6 cursor-pointer rounded-full border text-[11px] font-semibold outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
                    rating === value
                      ? 'border-accent bg-accent text-accent-foreground'
                      : 'border-border bg-transparent text-muted-foreground hover:border-accent'
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          )}
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Optional details…"
            rows={2}
            className="mb-2 w-full resize-none rounded-md border border-border bg-transparent p-1.5 text-[12px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          />
          {phase === 'error' && <p className="mb-2 mt-0 text-[11px] text-danger">Could not send — try again.</p>}
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-full border border-border bg-transparent px-2.5 py-1 text-[11px] font-medium text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={phase === 'submitting' || (kind === 'rating' && rating === null)}
              className="cursor-pointer rounded-full border-0 bg-accent px-2.5 py-1 text-[11px] font-semibold text-accent-foreground outline-none hover:bg-[var(--calyxa-accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </>
      )}
    </div>
  );
}
