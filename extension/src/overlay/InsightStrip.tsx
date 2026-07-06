import type { CSSProperties } from 'react';
import type { ProfileOverview, SessionRecap } from '../types/messages';
import { DELTA_EPSILON, TAG_KIND_COLOR_CLASS, humanizeDue, masteryDelta } from './Overlay';

// The overview/recap host (Sprint 13 ADR-024/025; Sprint 14 Task 2
// decomposition; Sprint 14 Task 7 auto-dismiss fold + placement move).
// Extracted from Overlay.tsx with zero behavior change at Task 2. Task 7
// moves BOTH cards' render site out of the scrollable transcript (recap
// used to render inside Transcript.tsx, overview inside the same
// scrollable div) to ABOVE the composer, as a strip that auto-dismisses:
// shown expanded for ~foldDurationMs (a green sweep bar counts it down),
// then folds to a compact one-line handle rather than disappearing --
// hover peeks it back open, a click un-folds it more durably. Overlay.tsx
// owns the actual fold timer/state; this component is still purely
// presentational (folded/onExpand/etc. are all props).
//
// A single component with a `kind` discriminant rather than two exports:
// the two cards are mutually exclusive by construction (showOverviewCard
// requires `!recap`), so one component covers both call sites without
// duplicating the mutual-exclusion logic that already lives in Overlay.tsx.
type InsightStripCardProps =
  | { kind: 'overview'; overview: ProfileOverview }
  | { kind: 'recap'; recap: SessionRecap; baseline: ProfileOverview | null };

type InsightStripProps = InsightStripCardProps & {
  folded: boolean;
  foldDurationMs: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onExpand: () => void;
};

export function InsightStrip(props: InsightStripProps) {
  const { folded, foldDurationMs, onMouseEnter, onMouseLeave, onExpand } = props;
  const label = props.kind === 'recap' ? 'Session recap' : 'Where you are';

  if (folded) {
    return (
      <button
        type="button"
        onClick={onExpand}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-3.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
      >
        {label}
        <span aria-hidden="true" className="text-[13px] leading-none">
          ⌃
        </span>
      </button>
    );
  }

  return (
    <div
      className="cx-strip relative"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ '--cx-strip-fold-duration': `${foldDurationMs}ms` } as CSSProperties}
    >
      {props.kind === 'overview' ? <OverviewCard overview={props.overview} /> : <RecapCard recap={props.recap} baseline={props.baseline} />}
      {/* The green auto-dismiss sweep (Sprint 14 Task 7): brighter/more
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
      <div className="rounded-lg border border-border bg-surface px-3.5 py-3">
        <p className="m-0 text-[12.5px] leading-relaxed text-muted-foreground">
          I&rsquo;m still getting to know you — ask your first question.
        </p>
      </div>
    );
  }

  const mastery = overview.mastery.slice(0, 5);
  const weakSpots = overview.weakSpots.slice(0, 3);
  const due = overview.dueForReview.slice(0, 3);

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface px-3.5 py-3">
      <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        Where you are
      </p>
      <div className="flex flex-col gap-1.5">
        {mastery.map((node) => (
          <div key={node.conceptKey} className="flex items-center gap-2">
            <span className="w-[45%] flex-none truncate text-[12px] text-foreground">{node.title}</span>
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
          everywhere it appears in the overlay, not just on pills. */}
      {weakSpots.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Working through
          </p>
          {weakSpots.map((spot, index) => (
            <p key={index} className={`${TAG_KIND_COLOR_CLASS['known-gap']} m-0 text-[12px] leading-relaxed`}>
              {spot.title} — {humanizeCategory(spot.category)}
            </p>
          ))}
        </div>
      )}
      {due.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Due for review
          </p>
          {due.map((item, index) => (
            <p key={index} className={`${TAG_KIND_COLOR_CLASS['due-review']} m-0 text-[12px] leading-relaxed`}>
              {item.title} — {item.reason}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// The end-of-session recap card (Sprint 13, ADR-025): per-concept mastery
// with delta arrows against the panel-open baseline when one exists
// (absolute otherwise), misconceptions resolved/added, trend lines when
// earned (most sessions have none, by design), and the FSRS forward look.
function RecapCard({ recap, baseline }: { recap: SessionRecap; baseline: ProfileOverview | null }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface px-3.5 py-3">
      <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        Session recap
      </p>
      <div className="flex flex-col gap-1">
        {recap.concepts.map((concept) => {
          const delta = masteryDelta(baseline, concept.conceptKey, concept.mastery);
          const showArrow = delta !== null && Math.abs(delta) >= DELTA_EPSILON;
          return (
            <div key={concept.conceptKey} className="flex items-center justify-between gap-2">
              <span className="truncate text-[12.5px] text-foreground">{concept.title}</span>
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
            <p key={index} className="m-0 text-[12px] leading-relaxed text-accent-emphasis">
              ✓ Gap closed: {humanizeCategory(item.category)}
            </p>
          ))}
        </div>
      )}
      {recap.misconceptionsAdded.length > 0 && (
        <div className="flex flex-col gap-1">
          {recap.misconceptionsAdded.map((item, index) => (
            <p key={index} className="m-0 text-[12px] leading-relaxed text-muted-foreground">
              Something to work on: {humanizeCategory(item.category)}
            </p>
          ))}
        </div>
      )}
      {recap.trends.length > 0 && (
        <div className="flex flex-col gap-1">
          {recap.trends.map((trend, index) => (
            <p key={index} className="m-0 text-[12px] font-medium leading-relaxed text-accent-emphasis">
              {trend.title}: {trend.line}
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
            <p key={index} className="m-0 text-[12px] leading-relaxed text-muted-foreground">
              {review.title} — {humanizeDue(review.dueAt)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
