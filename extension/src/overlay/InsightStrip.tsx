import type { CSSProperties } from 'react';
import type { ProfileOverview, SessionRecap } from '../types/messages';
import { DELTA_EPSILON, TAG_KIND_COLOR_CLASS, humanizeDue, masteryDelta } from './Overlay';

// The overview/recap host (Sprint 13 ADR-024/025; Sprint 14 Task 2
// decomposition; Sprint 14 Task 7 placement move; Sprint 14 fix pass —
// floating window). Task 7 moved BOTH cards' render site out of the
// scrollable transcript to ABOVE the composer. The Sprint 14 fix pass takes
// that one step further per live feedback: instead of a strip wedged inside
// the panel that folds to a one-line handle, the summary now renders as a
// small floating WINDOW above the whole extension (Overlay.tsx positions the
// wrapper and owns the appear/disappear animation + auto-dismiss timer). This
// component is purely the card's contents + the green countdown sweep; the
// glassy surface below matches the panel's own card (bg-background/85 +
// shadow-panel + backdrop-blur) so the window reads as part of Calyxa, not a
// foreign box.
//
// A single component with a `kind` discriminant rather than two exports:
// the two cards are mutually exclusive by construction (showOverviewCard
// requires `!recap`), so one component covers both call sites without
// duplicating the mutual-exclusion logic that already lives in Overlay.tsx.
type InsightStripCardProps =
  | { kind: 'overview'; overview: ProfileOverview }
  | { kind: 'recap'; recap: SessionRecap; baseline: ProfileOverview | null };

type InsightStripProps = InsightStripCardProps & {
  foldDurationMs: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
};

export function InsightStrip(props: InsightStripProps) {
  const { foldDurationMs, onMouseEnter, onMouseLeave } = props;

  // The glassy card surface lives HERE (Sprint 15 fix pass) rather than
  // inside each card, so the auto-dismiss sweep renders INSIDE the summary
  // box, along its bottom edge -- previously it sat below the card as a
  // detached second element.
  return (
    <div
      className="cx-strip relative flex flex-col gap-2.5 rounded-lg border border-border bg-background/90 px-3.5 py-3 shadow-panel backdrop-blur-[18px] backdrop-saturate-[1.5]"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ '--cx-strip-fold-duration': `${foldDurationMs}ms` } as CSSProperties}
    >
      {props.kind === 'overview' ? <OverviewCard overview={props.overview} /> : <RecapCard recap={props.recap} baseline={props.baseline} />}
      {/* The green auto-dismiss sweep (Sprint 14 Task 7; Sprint 15 fix pass
          moved it inside the card, pinned to the bottom): brighter/more
          transient than the composer's own progress bar by design (that
          one is thin/low-saturation and persistent; this one is meant to
          be noticed and counts down to the fold). Purely decorative --
          Overlay.tsx's real setTimeout is the actual fold trigger, this
          just visualizes the same duration via foldDurationMs. */}
      <div aria-hidden="true" className="cx-strip-sweep-track">
        <div className="cx-strip-sweep-bar" />
      </div>
    </div>
  );
}

// One shared bubble-tag treatment for every subject/concept name the summary
// shows (Sprint 15 fix pass) -- the same pill language as the transcript's
// profile-tag pills, so a concept title reads as a tag everywhere, never as
// plain text. Kind-colored variants compose a cx-tag-* class (color +
// border-color) on top; neutral ones use the border/foreground pair.
const SUBJECT_PILL_CLASS = 'inline-block max-w-full truncate rounded-full border bg-surface px-2 py-0.5 text-[11px] font-medium';

// "sign_error.distribution" -> "sign error distribution" for recap
// misconception rows -- the same phrasing rule the server's ping copy uses
// (events.ts's humanizeCategory), applied to the one recap field that
// arrives as a raw category.
function humanizeCategory(category: string): string {
  return category.replace(/[-_.]/g, ' ').replace(/\s+/g, ' ').trim();
}

// The pre-question "where you are" card (Sprint 13, ADR-024): mastery bars
// ≤5, weak spots ≤3, due items ≤3 -- all server-titled, all read-only. The
// calibrating variant is the cold-start experience; it never blocks the
// input row below it.
function OverviewCard({ overview }: { overview: ProfileOverview }) {
  if (overview.calibrating) {
    return (
      <p className="m-0 text-[12.5px] leading-relaxed text-muted-foreground">
        I&rsquo;m still getting to know you — ask your first question.
      </p>
    );
  }

  // Display caps (Sprint 15 fix pass round 2): mastery shows the top 3 MOST
  // RECENTLY UPDATED topics (sorted by lastPracticedAt, newest first;
  // missing timestamps sort last, preserving the server's own order among
  // themselves); weak spots and due items show at most 2 each, with a
  // "+N mistakes" / "+N topics" line for the rest.
  const mastery = [...overview.mastery]
    .sort((a, b) => (b.lastPracticedAt ? Date.parse(b.lastPracticedAt) : 0) - (a.lastPracticedAt ? Date.parse(a.lastPracticedAt) : 0))
    .slice(0, 3);
  const weakSpots = overview.weakSpots.slice(0, 2);
  const moreWeakSpots = overview.weakSpots.length - weakSpots.length;
  const due = overview.dueForReview.slice(0, 2);
  const moreDue = overview.dueForReview.length - due.length;

  return (
    <>
      <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        Where you are
      </p>
      <div className="flex flex-col gap-1.5">
        {mastery.map((node) => (
          <div key={node.conceptKey} className="flex items-center gap-2">
            <span className="w-[45%] min-w-0 flex-none">
              <span className={`${SUBJECT_PILL_CLASS} border-border text-foreground`}>{node.title}</span>
            </span>
            <span
              role="img"
              aria-label={`${node.title}: ${Math.round(node.mastery * 100)} percent mastery`}
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-border"
            >
              <span
                className="block h-full rounded-full bg-accent-glow-strong"
                style={{ width: `${Math.round(Math.max(0, Math.min(1, node.mastery)) * 100)}%` }}
              />
            </span>
          </div>
        ))}
      </div>
      {/* Sprint 14 Task 7: colored per the SAME kind->color mapping the
          transcript's tag pills use ("shared with the strip") -- a weak
          spot reads as the known-gap red, a due item reads as the
          due-review blue, so the color vocabulary means the same thing
          everywhere it appears in the overlay, not just on pills. Sprint 15
          fix pass: the concept title is a bubble tag in that kind's color,
          matching the transcript's pills outright, with the detail text
          beside it. */}
      {weakSpots.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Working through
          </p>
          {weakSpots.map((spot, index) => (
            <p key={index} className="m-0 flex items-center gap-1.5 text-[12px] leading-relaxed">
              <span className={`${TAG_KIND_COLOR_CLASS['known-gap']} ${SUBJECT_PILL_CLASS}`}>{spot.title}</span>
              <span className="min-w-0 truncate text-muted-foreground">{humanizeCategory(spot.category)}</span>
            </p>
          ))}
          {moreWeakSpots > 0 && (
            <p className="m-0 text-[11px] leading-relaxed text-muted-foreground">+{moreWeakSpots} mistakes</p>
          )}
        </div>
      )}
      {due.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Due for review
          </p>
          {due.map((item, index) => (
            <p key={index} className="m-0 flex items-center gap-1.5 text-[12px] leading-relaxed">
              <span className={`${TAG_KIND_COLOR_CLASS['due-review']} ${SUBJECT_PILL_CLASS}`}>{item.title}</span>
              <span className="min-w-0 truncate text-muted-foreground">{item.reason}</span>
            </p>
          ))}
          {moreDue > 0 && (
            <p className="m-0 text-[11px] leading-relaxed text-muted-foreground">+{moreDue} topics</p>
          )}
        </div>
      )}
    </>
  );
}

// The end-of-session recap card (Sprint 13, ADR-025): per-concept mastery
// with delta arrows against the panel-open baseline when one exists
// (absolute otherwise), misconceptions resolved/added, trend lines when
// earned (most sessions have none, by design), and the FSRS forward look.
function RecapCard({ recap, baseline }: { recap: SessionRecap; baseline: ProfileOverview | null }) {
  return (
    <>
      <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        Session recap
      </p>
      <div className="flex flex-col gap-1">
        {recap.concepts.map((concept) => {
          const delta = masteryDelta(baseline, concept.conceptKey, concept.mastery);
          const showArrow = delta !== null && Math.abs(delta) >= DELTA_EPSILON;
          return (
            <div key={concept.conceptKey} className="flex items-center justify-between gap-2">
              <span className="min-w-0">
                <span className={`${SUBJECT_PILL_CLASS} border-border text-foreground`}>{concept.title}</span>
              </span>
              <span className="flex flex-none items-center gap-1 text-[12px] text-muted-foreground">
                {Math.round(concept.mastery * 100)}%
                {showArrow && (
                  <span
                    aria-label={delta > 0 ? 'improved this session' : 'slipped this session'}
                    className={delta > 0 ? 'text-accent-emphasis' : 'text-muted-foreground'}
                  >
                    {delta > 0 ? '▲' : '▼'}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {recap.misconceptionsResolved.length > 0 && (
        <div className="flex flex-col gap-1">
          {recap.misconceptionsResolved.map((item, index) => (
            <p key={index} className="m-0 flex items-center gap-1.5 text-[12px] leading-relaxed text-accent-emphasis">
              <span className="flex-none">✓ Gap closed:</span>
              <span className={`${SUBJECT_PILL_CLASS} border-accent-emphasis text-accent-emphasis`}>
                {humanizeCategory(item.category)}
              </span>
            </p>
          ))}
        </div>
      )}
      {recap.misconceptionsAdded.length > 0 && (
        <div className="flex flex-col gap-1">
          {recap.misconceptionsAdded.map((item, index) => (
            <p key={index} className="m-0 flex items-center gap-1.5 text-[12px] leading-relaxed text-muted-foreground">
              <span className="flex-none">Something to work on:</span>
              <span className={`${SUBJECT_PILL_CLASS} border-border text-muted-foreground`}>
                {humanizeCategory(item.category)}
              </span>
            </p>
          ))}
        </div>
      )}
      {recap.trends.length > 0 && (
        <div className="flex flex-col gap-1">
          {recap.trends.map((trend, index) => (
            <p key={index} className="m-0 flex items-center gap-1.5 text-[12px] font-medium leading-relaxed text-accent-emphasis">
              <span className={`${SUBJECT_PILL_CLASS} border-accent-emphasis text-accent-emphasis`}>{trend.title}</span>
              <span className="min-w-0 truncate">{trend.line}</span>
            </p>
          ))}
        </div>
      )}
      {recap.nextReviews.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Coming back
          </p>
          {recap.nextReviews.map((review, index) => (
            <p key={index} className="m-0 flex items-center gap-1.5 text-[12px] leading-relaxed text-muted-foreground">
              <span className={`${SUBJECT_PILL_CLASS} border-border text-foreground`}>{review.title}</span>
              <span className="min-w-0 truncate">{humanizeDue(review.dueAt)}</span>
            </p>
          ))}
        </div>
      )}
    </>
  );
}
