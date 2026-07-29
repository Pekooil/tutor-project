'use client'

import Link from 'next/link'
import type { SessionQuota } from '@/lib/learning/activity-read'
import type { ReviewConcept } from '@/components/dashboard/premium/derive'
import { longDate, reviewMinutes } from '@/components/dashboard/premium/derive'
import { T, ORDINAL, RULE, RADIUS, eyebrow, pageEyebrow, mintTile, accentButton, pill } from './tokens'
import { CalendarIcon, ClockIcon, LightbulbIcon } from './icons'
import { strandColorVar } from './chart-tokens'
import type { ReviewSchedule } from './schedule'
import { ScheduleSection } from './ScheduleSection'
import { LatestSetBlock, ResumeBlock } from './HomeworkBlocks'
import type { HomeworkSessionRow } from '@/lib/learning/homework-read'
import { STORE_URL } from '@/lib/store-url'

// Screen 1 — the studio dashboard. ONE job: answer "what do I do right now?" —
// the status header, the dominant Today's Review card, and the schedule those
// reviews come from.
//
// The subject → concept browser used to live below all of this, which made the
// only route to a concept "scroll past everything and open the right accordion".
// It moved to /notes (studio/LibraryScreen), which was previously a bare
// redirect and is now the index it always should have been. This page stays
// short on purpose.

/** Named concepts in Today's Review before it collapses to "+N more". */
const CHIP_LIMIT = 3




function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// ── Bits ─────────────────────────────────────────────────────────────────────

/** "August 12" — the day the free allowance rolls over. UTC because `resetsAt`
 *  is derived from a stored timestamp, not a local calendar day. */
function resetDay(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', timeZone: 'UTC' })
}

/** The session allowance, and — since Sprint 23 — a way to act on it.
 *
 *  This used to be an inert <span>. A capped free user was shown "No sessions
 *  left this month" and given nowhere to go: the only working upgrade button
 *  lives on /account, two clicks away behind an unlabelled avatar in the rail,
 *  and nothing in the product linked to /billing at all. It is a link in every
 *  state now — a free user to upgrade, a Pro user to manage or cancel. */
function SessionsLeftPill({ quota }: { quota: SessionQuota }) {
  const capped = !quota.isPro && quota.remaining <= 0
  const set = capped ? ORDINAL.amber : ORDINAL.green
  const copy = quota.isPro
    ? 'Unlimited sessions'
    : capped
      ? 'No sessions left this month'
      : `${quota.remaining} of ${quota.limit} ${quota.remaining === 1 ? 'session' : 'sessions'} left this month`

  return (
    <Link
      href="/billing"
      className="cx-quota-pill"
      title={quota.isPro ? 'Manage your subscription' : 'See plans and upgrade'}
      style={{ ...pill, ...set, padding: '5px 13px', fontSize: 12.5, fontWeight: 600 }}
    >
      <CalendarIcon size={13} />
      {copy}
    </Link>
  )
}

/** Shown only when a free account has spent its allowance.
 *
 *  A cap is a blocking state, so it gets a band of its own rather than being left
 *  to a pill: it names what stopped, when it comes back on its own, and — the
 *  part the pill could never carry — what still works meanwhile, so the student
 *  reads it as "do your reviews" rather than "the app is broken". */
function CappedNotice({ quota }: { quota: SessionQuota }) {
  const resets = resetDay(quota.resetsAt)
  return (
    <section
      className="cx-card-soft cx-rise"
      style={{
        marginTop: 22,
        // The one signal of state. A full amber tint band is a status FILL —
        // light with dark ink — which on the dark studio reads as a warning slab;
        // a rule carries the same meaning at the right volume.
        borderLeft: `3px solid ${T.amber}`,
        padding: '18px 22px',
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        flexWrap: 'wrap',
        ['--cx-i' as string]: 1,
      }}
    >
      <div style={{ flex: '1 1 340px', minWidth: 260 }}>
        <div style={{ ...eyebrow, color: T.amber }}>Session limit reached</div>
        <h3 style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em', margin: '7px 0 0' }}>
          You&rsquo;ve used all {plural(quota.limit, 'session')} this month
        </h3>
        <p style={{ margin: '6px 0 0', fontSize: 13.5, lineHeight: 1.55, color: T.muted }}>
          {resets ? `Your allowance resets on ${resets}. ` : ''}Reviews and notes stay open — only new sessions are
          paused.
        </p>
      </div>
      <Link href="/billing" style={{ ...accentButton, padding: '11px 20px', fontSize: 14, flexShrink: 0 }}>
        See plans →
      </Link>
    </section>
  )
}

/** Cold start — a brand-new account has nothing to browse, so the dashboard's job
 *  is activation, not navigation: one instruction set and one CTA into the
 *  install/setup flow. (Carried over from the pre-studio dashboard, which had
 *  this state; a muted "nothing here yet" card would waste the most important
 *  screen a new signup sees.) */
function ActivationView({ now }: { now: Date }) {
  return (
    <div style={{ padding: '26px 40px 56px', maxWidth: 1020, margin: '0 auto' }}>
      <div style={{ ...pageEyebrow, color: T.muted }}>{longDate(now)}</div>
      <h2 style={{ fontSize: 32, lineHeight: '38px', fontWeight: 600, letterSpacing: '-0.015em', margin: '6px 0 0' }}>
        Welcome to Calyxa
      </h2>
      <p style={{ marginTop: 8, marginBottom: 0, fontSize: 14.5, color: T.muted }}>
        Your notes, quizzes and flashcards are built from your tutoring sessions — so the first one is the
        only setup there is.
      </p>

      <section className="cx-card cx-rise" style={{ marginTop: 22, padding: '24px 26px', ['--cx-i' as string]: 1 }}>
        <div style={{ ...eyebrow, color: T.accentInk }}>Get started</div>
        <h3 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.015em', margin: '8px 0 0' }}>
          Start your first session
        </h3>
        <ol
          style={{
            margin: '16px 0 22px',
            padding: 0,
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {[
            'Add Calyxa to Chrome and pin it to your toolbar.',
            'Open any math problem online and start a session.',
            'Come back here — this page fills in with everything it covered.',
          ].map((step, i) => (
            <li key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span
                aria-hidden="true"
                style={{
                  width: 22,
                  height: 22,
                  flexShrink: 0,
                  borderRadius: '50%',
                  background: T.mintTile,
                  color: T.accentInk,
                  fontSize: 11.5,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {i + 1}
              </span>
              <span style={{ fontSize: 15, lineHeight: 1.55 }}>{step}</span>
            </li>
          ))}
        </ol>
        {/* Sessions only ever start in the extension, so the empty state sends
            them to install it. The retired /welcome wizard used to sit in
            between; it taught nothing the extension's own onboarding does not. */}
        <span className="cx-glowwrap">
          <span aria-hidden className="cx-glow cx-breathe" />
          <a href={STORE_URL} style={{ ...accentButton, borderRadius: RADIUS.pill, padding: '12px 22px', fontSize: 14.5 }}>
            Add Calyxa to Chrome →
          </a>
        </span>
      </section>
    </div>
  )
}

export function DashboardScreen({
  now,
  quota,
  due,
  schedule,
  isEmpty,
  homework,
}: {
  now: Date
  quota: SessionQuota
  due: ReviewConcept[]
  /** The spacing schedule as past / today / upcoming (studio/schedule.ts). */
  schedule: ReviewSchedule
  /** True when the account has no practiced concepts at all (loadDashboard). */
  isEmpty: boolean
  /** The v4 homework blocks (ADR-057). Both halves are independently optional:
   *  a student with no paused set and no finished set simply sees neither. */
  homework: {
    paused: HomeworkSessionRow | null
    latest: HomeworkSessionRow | null
    latestComparison: string
    latestKitHref: string | null
  }
}) {
  if (isEmpty) return <ActivationView now={now} />

  const minutes = reviewMinutes(due.length)
  const startHref = due[0] ? `/notes/${encodeURIComponent(due[0].conceptKey)}` : null
  const capped = !quota.isPro && quota.remaining <= 0

  const subline =
    due.length > 0
      ? `${plural(due.length, 'concept')} ready to review — about ${minutes} minutes.`
      : 'Nothing due right now — open Notes to pick any concept and review it.'

  return (
    <div style={{ padding: '26px 40px 56px', maxWidth: 1020, margin: '0 auto' }}>
      {/* 1a — status header */}
      <div style={{ ...pageEyebrow, color: T.muted }}>{longDate(now)}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
        <h2
          style={{
            fontSize: 32,
            lineHeight: 1.18,
            fontWeight: 600,
            letterSpacing: '-0.015em',
            margin: 0,
          }}
        >
          Dashboard
        </h2>
        <SessionsLeftPill quota={quota} />
      </div>
      <p style={{ marginTop: 8, marginBottom: 0, fontSize: 14.5, color: T.muted }}>{subline}</p>

      {/* 1a-bis — the cap, when it is in force. Above Today's Review because it
          explains why the product is degraded, and it hands off directly to the
          card underneath ("reviews still work"). Renders nothing otherwise. */}
      {capped && <CappedNotice quota={quota} />}

      {/* v4 block 1 — the paused set. First because lossless resume is the
          mechanic: if something was left unfinished, that is the answer to
          "what do I do right now", ahead of any review. */}
      {homework.paused && <ResumeBlock row={homework.paused} />}

      {/* v4 block 2 — the last homework session's summary, kept here after it
          auto-fired in the extension. */}
      {homework.latest && (
        <LatestSetBlock
          row={homework.latest}
          comparison={homework.latestComparison}
          kitHref={homework.latestKitHref}
        />
      )}

      {/* 1b — Today's Review, the one dominant action */}
      <section className="cx-card cx-rise" style={{ marginTop: 22, padding: '22px 24px 20px', ['--cx-i' as string]: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span style={mintTile}>
            <ClockIcon size={16} />
          </span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ ...eyebrow, color: T.accentInk }}>Today&rsquo;s review</div>
            <h3 style={{ fontSize: 23, lineHeight: '28px', fontWeight: 600, letterSpacing: '-0.015em', margin: '2px 0 0' }}>
              {due.length > 0 ? `${plural(due.length, 'concept')}, ${minutes} minutes` : 'You’re all caught up'}
            </h3>
          </div>
          {startHref && (
            /* The page's one primary action, so it is the one thing that
               breathes — a blurred mint radial behind the pill. */
            <span className="cx-glowwrap">
              <span aria-hidden className="cx-glow cx-breathe" />
              <Link
                href={startHref}
                style={{ ...accentButton, borderRadius: RADIUS.pill, padding: '12px 22px', fontSize: 14.5 }}
              >
                Start review →
              </Link>
            </span>
          )}
        </div>

        {/* At most CHIP_LIMIT named, then a count. A queue can run to twenty-odd
            concepts, and listing every one turned the page's most important card
            into a wall of pills that buried its own button. The three shown are
            the front of the queue, which is the order "Start review" works in. */}
        {due.length > 0 && (
          <>
            <div style={{ borderTop: RULE, margin: '18px 0 0' }} />
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 16 }}>
              {due.slice(0, CHIP_LIMIT).map((c) => (
                <span
                  key={c.conceptKey}
                  style={{
                    ...pill,
                    // v4: overdue is AMBER, never red. Nothing in this pass is
                    // punitive — an overdue review is attention, not failure,
                    // and the danger tone said the opposite.
                    ...(c.overdue ? ORDINAL.amber : ORDINAL.neutral),
                    padding: '7px 14px',
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {/* Overdue is already carried by the chip's tone, so the dot
                      goes back to naming the SUBJECT — the one thing the chip's
                      text doesn't say. */}
                  <span
                    aria-hidden
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: c.overdue ? T.amber : strandColorVar(c.strand),
                    }}
                  />
                  {c.title} · {c.overdue ? 'overdue' : 'due today'}
                </span>
              ))}
              {due.length > CHIP_LIMIT && (
                <span style={{ fontSize: 13, fontWeight: 600, color: T.muted }}>
                  +{due.length - CHIP_LIMIT} more
                </span>
              )}
            </div>
          </>
        )}

      </section>

      {/* 1b-ter — the schedule the queue above comes from. A one-line
          explanation was tried here first and was worth nothing: a sentence
          cannot answer "what is coming on Thursday". */}
      {schedule.ready && <ScheduleSection schedule={schedule} />}

      {/* 1b-bis — the cue back to the extension.
          Everything else on this page is about material the student ALREADY has;
          the action that creates more happens on their homework page, and until
          now only the cold-start screen ever said so. Deliberately a muted line
          and not a button: the web app cannot start a session, so a CTA here
          would be a control that controls nothing, and it would compete with
          "Start review" for the card above.

          Hidden while the allowance is spent — the band above has just said new
          sessions are paused, and inviting one underneath would contradict it. */}
      {!capped && (
        <p
          style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 2px 0', fontSize: 12.5, color: T.muted }}
        >
          <LightbulbIcon size={14} style={{ flexShrink: 0 }} />
          Working on new homework? Open Calyxa on the page and every concept it covers shows up here.
        </p>
      )}

    </div>
  )
}
