import { useState } from 'react';
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
// real kit (notes / practice problems with revealable solutions / flip
// flashcards) via /api/study/generate and renders it in place. It DEGRADES
// gracefully to the board's reserved placeholder tiles whenever generation is
// unavailable (no transport / no sessionId -- e.g. a test harness or a mount
// predating this wiring) or the route declined/failed (the hard cost cap, a
// session with nothing to generate, or an error). Presentational: Overlay.tsx
// owns the recap state + the transport; the generation UI state is this card's
// own local state, fresh per recap (a new session = a new card).

// Pure flip/reveal toggle (exported for the recap-kit unit test, Task 7 --
// the annotations.ts testable-helper precedent): flips one index in a set of
// currently-open indices, returning a new set (never mutating the input) so
// it can drive a useState<ReadonlySet<number>> directly. Shared by the
// flashcard flip state and the practice-problem solution-reveal state, which
// are the same "which of these N cards are open" shape.
export function toggleIndex(open: ReadonlySet<number>, index: number): Set<number> {
  const next = new Set(open);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  return next;
}

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
        <StudyKitView kit={kit} />
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

// Renders a generated kit: notes (ordered list), practice problems (statement
// + tap-to-reveal solution), and flip flashcards. Only non-empty groups render
// (the route never persists a fully-empty kit, but any one group can be empty).
// No host-DOM mutation -- everything lives inside the overlay's shadow root.
function StudyKitView({ kit }: { kit: StudyKit }) {
  const [revealed, setRevealed] = useState<ReadonlySet<number>>(() => new Set());

  return (
    <div className="flex flex-col gap-3">
      {kit.notes.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-semibold text-foreground">Study notes</div>
          <ol className="ml-4 flex list-decimal flex-col gap-1 text-[12.5px] text-foreground marker:text-[var(--calyxa-hint-text)]">
            {kit.notes.map((note, i) => (
              <li key={i} className="pl-1 leading-snug">
                {note}
              </li>
            ))}
          </ol>
        </div>
      )}

      {kit.problems.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-semibold text-foreground">Practice problems</div>
          <div className="flex flex-col gap-1.5">
            {kit.problems.map((problem, i) => (
              <div key={i} className="rounded-[10px] border border-border bg-background px-2.5 py-2">
                <div className="text-[12.5px] leading-snug text-foreground">{problem.statement}</div>
                {problem.solution && (
                  <>
                    <button
                      type="button"
                      onClick={() => setRevealed((open) => toggleIndex(open, i))}
                      aria-expanded={revealed.has(i)}
                      className="mt-1 cursor-pointer text-[11px] font-semibold text-accent-emphasis outline-none hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                    >
                      {revealed.has(i) ? 'Hide solution' : 'Show solution'}
                    </button>
                    {revealed.has(i) && (
                      <div className="mt-1 border-t border-border pt-1 text-[12px] leading-snug text-[#46463f]">
                        {problem.solution}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {kit.flashcards.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-semibold text-foreground">Flashcards</div>
          <div className="flex flex-col gap-1.5">
            {kit.flashcards.map((card, i) => (
              <FlipCard key={i} front={card.front} back={card.back} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// A tap-to-flip flashcard, mirroring the marketing Flashcard's flip (the
// StudyLoopSection component) -- tap/keyboard driven (no hover flip; a hover
// flip is too twitchy in the dense recap card). The 3D transform is inline so
// it never depends on the extension's Tailwind arbitrary-property support.
// Local flip state per card -- independent of its siblings.
function FlipCard({ front, back }: { front: string; back: string }) {
  const [flipped, setFlipped] = useState(false);
  const toggle = () => setFlipped((value) => !value);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={flipped}
      aria-label={flipped ? `Flashcard answer: ${back}` : `Flashcard question: ${front}`}
      onClick={toggle}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggle();
        }
      }}
      className="relative h-[64px] w-full cursor-pointer select-none outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      style={{ perspective: '800px' }}
    >
      <div
        className="relative h-full w-full transition-transform duration-500"
        style={{ transformStyle: 'preserve-3d', transform: flipped ? 'rotateY(180deg)' : 'none' }}
      >
        <div
          className="absolute inset-0 flex items-center justify-center rounded-[10px] border border-border bg-background px-3 text-center text-[12px] leading-snug text-foreground"
          style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
        >
          {front}
        </div>
        <div
          className="absolute inset-0 flex items-center justify-center rounded-[10px] border border-border bg-background px-3 text-center text-[12px] font-medium leading-snug text-accent-emphasis"
          style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
        >
          {back}
        </div>
      </div>
    </div>
  );
}
