import type { ProfileOverview, SessionRecap } from '../types/messages';
import { DELTA_EPSILON, humanizeDue, masteryDelta } from './Overlay';

// The overview/recap host (Sprint 13 ADR-024/025; Sprint 14 Task 2
// decomposition). Extracted from Overlay.tsx with zero behavior change --
// both cards render exactly where Sprint 13 put them (before the first
// question / once on session end); this task only moves the JSX into this
// component. Placement (e.g. above the composer as an auto-dismissing
// strip) is Task 6's job, not this one's.
//
// A single component with a `kind` discriminant rather than two exports:
// the two cards are mutually exclusive by construction (showOverviewCard
// requires `!recap`), so one component covers both call sites without
// duplicating the mutual-exclusion logic that already lives in Overlay.tsx.
type InsightStripProps =
  | { kind: 'overview'; overview: ProfileOverview }
  | { kind: 'recap'; recap: SessionRecap; baseline: ProfileOverview | null };

export function InsightStrip(props: InsightStripProps) {
  if (props.kind === 'overview') return <OverviewCard overview={props.overview} />;
  return <RecapCard recap={props.recap} baseline={props.baseline} />;
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
      {weakSpots.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Working through
          </p>
          {weakSpots.map((spot, index) => (
            <p key={index} className="m-0 text-[12px] leading-relaxed text-muted-foreground">
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
            <p key={index} className="m-0 text-[12px] leading-relaxed text-muted-foreground">
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
