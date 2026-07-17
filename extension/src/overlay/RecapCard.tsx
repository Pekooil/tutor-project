import { useState } from 'react';
import { API_BASE } from '../lib/api';
import type { SessionRecap, StudyKit, StudyKitResult } from '../types/messages';
import { conceptOutcome } from './session-flow';

// The post-session recap (design state 7b in the revised board): the panel
// body's TERMINAL state. Four sections -- the session's concept, "What
// improved" (the solid/mostly outcome rows, filled sage checks), "Still
// needs practicing" (the worth-one-more-pass rows, empty circles under an
// amber overline), and "Generated for you" -- then one exit, Complete
// session. The outcome lines are still conceptOutcome's mapping of the
// recorded counts (recap.ts builds AFTER the reconcile, so a row can never
// disagree with the profile).
//
// Sprint 21 / Task 5 (ADR-049): "Generated for you" is no longer a
// placeholder. When the study-kit transport + the ended sessionId are both
// present, the section offers a "Make a study kit" action that generates a
// real kit via /api/study/generate. It DEGRADES gracefully to the board's
// reserved placeholder tiles whenever generation is unavailable (no transport
// / no sessionId -- e.g. a test harness or a mount predating this wiring) or
// the route declined/failed (the hard cost cap, a session with nothing to
// generate, or an error). Presentational: Overlay.tsx owns the recap state +
// the transport; the generation UI state is this card's own local state,
// fresh per recap (a new session = a new card).
//
// 2026-07-16 (Darcy's ask): a generated kit renders as a compact SUMMARY --
// what the kit contains, never the materials themselves -- so the recap card
// stays recap-sized instead of growing a long scrolling list of notes/
// problems/flashcards. The full materials live in the dashboard's kit viewer
// (/kits/[key], keyed by session id), which the summary links out to. The
// in-card StudyKitView (notes list / reveal problems / flip flashcards) and
// its toggleIndex reducer retired with that change.

// The generation lifecycle for the "Generated for you" section.
//   idle    -- offer the "Make a study kit" action (transport available).
//   loading -- the /api/study/generate call is in flight.
//   ready   -- a kit came back; render it.
//   refused -- the route declined WITHOUT an error (hard cost cap / nothing to
//              generate); show a gentle message + the placeholder.
//   error   -- a real failure; show a gentle message + a retry + the placeholder.
type GenPhase = 'idle' | 'loading' | 'ready' | 'refused' | 'error';

export function RecapCard({
  recap,
  topicTitle,
  disabled,
  onDone,
  sessionId,
  onGenerateStudyKit,
}: {
  recap: SessionRecap;
  // The session's confirmed topic (check-in state), when known -- the
  // Concept headline; falls back to the recap's own first concept row.
  topicTitle: string | null;
  disabled: boolean;
  onDone: () => void;
  // The just-ended session's id (Sprint 21 Task 5) -- what a kit is generated
  // for. null when the recap broadcast carried none; generation is then
  // unavailable and the placeholder shows.
  sessionId: string | null;
  // The study-kit generation transport (optional -- see the component comment's
  // degrade note). Resolves { kit } / { refused }; rejects on a real failure.
  onGenerateStudyKit?: (sessionId: string) => Promise<StudyKitResult>;
}) {
  const outcomes = recap.concepts.map((concept) => ({
    conceptKey: concept.conceptKey,
    ...conceptOutcome(concept),
  }));
  const improved = outcomes.filter((outcome) => outcome.kind !== 'revisit');
  const practicing = outcomes.filter((outcome) => outcome.kind === 'revisit');
  const conceptTitle = topicTitle ?? recap.concepts[0]?.title ?? null;

  return (
    <div className="flex flex-col gap-3.5 px-[18px] pb-[17px] pt-[15px]">
      {conceptTitle && (
        <div>
          <div className="mb-[3px] text-[10.5px] font-semibold uppercase tracking-[0.11em] text-[var(--calyxa-hint-text)]">
            Concept
          </div>
          <div className="text-[16px] font-semibold tracking-[-0.015em] text-foreground">{conceptTitle}</div>
          {/* The board shows a curriculum unit line here ("Algebra II ·
              Unit 4"); curriculum titles never ship in this bundle
              (@calyxa/curriculum is server-side), so no line renders until
              the wire carries one -- omitted, never invented. */}
        </div>
      )}
      {improved.length > 0 && (
        <div>
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-accent-emphasis">
            What improved
          </div>
          <div className="flex flex-col gap-[7px]">
            {improved.map((outcome) => (
              <div key={outcome.conceptKey} className="flex items-center gap-2.5 text-[13.5px] text-foreground">
                <span
                  aria-label="mastered"
                  className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-accent text-[10.5px] font-bold text-accent-foreground"
                >
                  ✓
                </span>
                {outcome.line}
              </div>
            ))}
          </div>
        </div>
      )}
      {practicing.length > 0 && (
        <div>
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-[var(--calyxa-recap-practice-text)]">
            Still needs practicing
          </div>
          <div className="flex flex-col gap-[7px]">
            {practicing.map((outcome) => (
              <div key={outcome.conceptKey} className="flex items-center gap-2.5 text-[13.5px] text-[#46463f]">
                <span
                  aria-label="worth one more pass"
                  className="h-[18px] w-[18px] flex-none rounded-full border-[1.5px] border-border bg-background"
                />
                {outcome.line}
              </div>
            ))}
          </div>
        </div>
      )}
      <StudyKitSection
        sessionId={sessionId}
        disabled={disabled}
        onGenerateStudyKit={onGenerateStudyKit}
      />
      <button
        type="button"
        onClick={onDone}
        disabled={disabled}
        className="h-[42px] w-full cursor-pointer rounded-full border-0 bg-accent text-[14px] font-semibold text-accent-foreground outline-none hover:bg-[var(--calyxa-accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        Complete session
      </button>
    </div>
  );
}

// The "Generated for you" section: the whole generate-on-click lifecycle,
// self-contained so RecapCard's outer render stays the recap layout it always
// was. `disabled` is the parent's "session is ending" gate -- while it's set
// (the Complete-session teardown is underway) a new generation is blocked too.
function StudyKitSection({
  sessionId,
  disabled,
  onGenerateStudyKit,
}: {
  sessionId: string | null;
  disabled: boolean;
  onGenerateStudyKit?: (sessionId: string) => Promise<StudyKitResult>;
}) {
  const [phase, setPhase] = useState<GenPhase>('idle');
  const [kit, setKit] = useState<StudyKit | null>(null);
  const [refusal, setRefusal] = useState<'cost' | 'empty' | null>(null);

  // Generation needs both the transport and the ended session's id. Without
  // either, the section shows the reserved placeholder tiles and offers
  // nothing -- there is nothing to generate against.
  const canGenerate = !!onGenerateStudyKit && !!sessionId;

  async function handleGenerate() {
    if (!onGenerateStudyKit || !sessionId) return;
    setPhase('loading');
    try {
      const result = await onGenerateStudyKit(sessionId);
      if ('kit' in result) {
        setKit(result.kit);
        setPhase('ready');
      } else {
        setRefusal(result.refused);
        setPhase('refused');
      }
    } catch {
      // A rejected transport (an { error } reply or an unreachable worker) --
      // the route never leaks provider/DB detail, and neither does the card.
      setPhase('error');
    }
  }

  return (
    <div>
      <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-[var(--calyxa-hint-text)]">
        Generated for you
      </div>

      {!canGenerate || phase === 'idle' || phase === 'loading' ? (
        canGenerate ? (
          <button
            type="button"
            onClick={handleGenerate}
            disabled={disabled || phase === 'loading'}
            className="flex h-[46px] w-full cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-border bg-background px-3 text-[13px] font-semibold text-foreground outline-none hover:bg-[var(--calyxa-sage-border)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            {phase === 'loading' ? (
              'Generating your study kit…'
            ) : (
              <>
                <span aria-hidden="true">✦</span>
                <span className="flex flex-col items-start leading-tight">
                  <span>Make a study kit</span>
                  <span className="text-[10.5px] font-normal text-[var(--calyxa-hint-text)]">
                    Notes, practice, and flashcards from this session
                  </span>
                </span>
              </>
            )}
          </button>
        ) : (
          // Generation unavailable (no transport / no sessionId): the board's
          // reserved placeholder, unchanged from pre-Sprint-21.
          <PlaceholderTiles />
        )
      ) : phase === 'ready' && kit ? (
        <StudyKitSummary kit={kit} sessionId={sessionId} />
      ) : (
        // refused / error: a gentle message over the placeholder tiles, plus a
        // retry when the failure was transient (never for a deterministic
        // refusal -- the hard cap, or a session with nothing to generate).
        <div className="flex flex-col gap-2">
          <p className="text-[12px] text-[var(--calyxa-hint-text)]">
            {phase === 'refused' && refusal === 'cost'
              ? 'Calyxa is resting for today — study kits are back tomorrow.'
              : phase === 'refused'
                ? "There wasn't enough in this session to build a study kit."
                : "Couldn't generate a study kit right now."}
          </p>
          <PlaceholderTiles />
          {phase === 'error' && (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={disabled}
              className="self-start text-[12px] font-semibold text-accent-emphasis underline underline-offset-2 outline-none hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// The board's reserved-space treatment (Overlay.css's .cx-recap-placeholder):
// the two dashed, candy-striped tiles. Now shown only as the degrade target,
// not the default.
function PlaceholderTiles() {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="cx-recap-placeholder flex h-[52px] items-center justify-center rounded-[10px] px-1.5 text-center font-mono text-[10px]">
        study material
      </div>
      <div className="cx-recap-placeholder flex h-[52px] items-center justify-center rounded-[10px] px-1.5 text-center font-mono text-[10px]">
        study material
      </div>
    </div>
  );
}

// Pluralized count line for one summary row.
function countLine(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

// The generated kit's SUMMARY (2026-07-16 ask): what the kit contains --
// per-kind counts only, never the materials themselves -- plus a link out to
// the dashboard's kit viewer (/kits/[key] is keyed by the session id) where
// the full notes/problems/flashcards live. Only non-empty groups get a row
// (the route never persists a fully-empty kit, but any one group can be
// empty).
function StudyKitSummary({ kit, sessionId }: { kit: StudyKit; sessionId: string | null }) {
  const rows = [
    kit.notes.length > 0 ? { name: 'Study notes', detail: countLine(kit.notes.length, 'key point') } : null,
    kit.problems.length > 0
      ? { name: 'Practice problems', detail: `${countLine(kit.problems.length, 'problem')}, solutions included` }
      : null,
    kit.flashcards.length > 0 ? { name: 'Flashcards', detail: countLine(kit.flashcards.length, 'card') } : null,
  ].filter((row): row is { name: string; detail: string } => row !== null);

  return (
    <div className="rounded-[10px] border border-border bg-background px-3 pb-2.5 pt-2">
      <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
        <span aria-hidden="true">✦</span> Your study kit is ready
      </div>
      <div className="mt-1.5 flex flex-col gap-1">
        {rows.map((row) => (
          <div key={row.name} className="flex items-baseline justify-between gap-2 text-[12px]">
            <span className="text-foreground">{row.name}</span>
            <span className="text-[var(--calyxa-hint-text)]">{row.detail}</span>
          </div>
        ))}
      </div>
      {sessionId && (
        <a
          href={`${API_BASE}/kits/${sessionId}`}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-[11.5px] font-semibold text-accent-emphasis underline underline-offset-2 outline-none hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          Open it in your dashboard ↗
        </a>
      )}
    </div>
  );
}
