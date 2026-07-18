import type { FormEvent, RefObject } from 'react';
import { CalyxaMark } from '@calyxa/ui';

// The in-pill text row ("Calyxa Ambient Pill" handoff, pill state `text`).
// The old input-row Composer (fake caret + measurement span + mic/send
// buttons) is retired with the panel: the text state is the pill ITSELF
// morphed to 540×54 — logomark, a borderless input with the native caret
// tinted accent, and a right slot that shows the quiet ↵ hint chip until a
// turn is in flight, then the three pulsing thinking dots, plus a small ✕
// that collapses back to idle. Owns no state — every value and handler is a
// prop from Overlay.tsx, exactly the old decomposition discipline.
export function Composer({
  inputRef,
  value,
  busy,
  disabled,
  placeholder,
  onChange,
  onSubmit,
  onClose,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  // True while a text turn is in flight — the ↵ hint swaps for the pulsing
  // dots and Enter is inert (Overlay.tsx's send path is serialized on busy).
  busy: boolean;
  // Disables input during the close choreography (a turn can't be sent while
  // the session is already on its way out).
  disabled: boolean;
  placeholder: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || disabled || !value.trim()) return;
    onSubmit();
  }

  return (
    <form onSubmit={handleSubmit} className="cx-pill-content flex w-full items-center gap-2.5 pl-4 pr-2.5">
      <CalyxaMark aria-hidden="true" className="h-[18px] w-[18px] flex-none" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        aria-label="Message Calyxa"
        // Mirrors the server's MAX_MESSAGE_LENGTH (web/lib/ai/turn-request.ts):
        // the route 400s past 4000 chars, so stop the overrun at the input
        // instead of surfacing a failed turn. Display hint only — the server
        // stays the authority.
        maxLength={4000}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 border-none bg-transparent p-0 text-[14.5px] text-foreground outline-none placeholder:text-muted-foreground caret-[var(--color-accent)] disabled:cursor-not-allowed"
      />
      {busy ? (
        <span aria-label="Thinking" role="status" className="flex flex-none items-center gap-1 px-1.5">
          <span aria-hidden="true" className="cx-think-dot h-[5px] w-[5px] rounded-full bg-accent-emphasis" />
          <span
            aria-hidden="true"
            className="cx-think-dot h-[5px] w-[5px] rounded-full bg-accent-emphasis"
            style={{ animationDelay: '0.18s' }}
          />
          <span
            aria-hidden="true"
            className="cx-think-dot h-[5px] w-[5px] rounded-full bg-accent-emphasis"
            style={{ animationDelay: '0.36s' }}
          />
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="flex-none rounded-[7px] border border-border bg-[var(--cx-chip-bg)] px-[7px] py-[3px] text-[10.5px] font-semibold text-muted-foreground"
        >
          ↵
        </span>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close text input"
        title="Close"
        className="flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-[13px] leading-none text-muted-foreground outline-none transition-colors hover:bg-[var(--cx-chip-bg)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        ✕
      </button>
    </form>
  );
}
