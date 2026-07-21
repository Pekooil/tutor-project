import Link from 'next/link'
import type { ReactNode } from 'react'
import type { DashboardData } from '@/lib/learning/dashboard-read'
import type { RecentSession, SessionQuota } from '@/lib/learning/activity-read'
import { GlassCard, Badge } from './primitives'
import { C, eyebrow, pillAction, entrance, pct } from './theme'
import { kitHrefForConcept, type StudyKit } from './kits-read'
import {
  greeting,
  longDate,
  todaysReview,
  weakestConcepts,
  relativeDueLabel,
  reviewMinutes,
  type ReviewConcept,
} from './derive'

// The post-login home — one clear daily loop, nothing else. The redesign
// collapsed the old seven-section analytics overview into a single corridor:
// (1) a status header, (2) Today's Review as the one dominant action, then a
// light "Get ahead" row of weak concepts and a slim "pick up where you left off"
// strip. Everything the old home also showed (notebook, full session history,
// upcoming schedule, aggregate numbers) now lives one tap away in the nav —
// the home's job is to answer "what do I do right now?" and get out of the way.
// Server component; all data comes from the RLS-scoped, per-request-fresh
// loadDashboard (ADR-047).
export function ContinueLearningScreen({
  data,
  now,
  firstName,
  kits,
  recentSessions,
  quota,
}: {
  data: DashboardData
  now: Date
  firstName: string
  kits: StudyKit[]
  recentSessions: RecentSession[]
  quota: SessionQuota
}) {
  // Cold start — a brand-new user with no practiced concepts. The daily loop has
  // nothing to show yet, so replace it with one unambiguous activation call:
  // open the extension and run a first session. Everything else on the dashboard
  // is downstream of that single action.
  if (data.isEmpty) {
    return <ActivationView firstName={firstName} now={now} />
  }

  const due = todaysReview(data, now)
  const weakest = weakestConcepts(data, 4)
  const lastSession = recentSessions[0] ?? null

  // A concept's best review target: the guided review flow when a study kit
  // exists to review with, else its concept workspace.
  const reviewHref = (conceptKey: string): string => {
    return kitHrefForConcept(kits, conceptKey) ? `/review/${conceptKey}` : `/concepts/${conceptKey}`
  }

  const minutes = reviewMinutes(due.length)

  return (
    <section data-screen-label="Dashboard">
      {/* ── Status header ─────────────────────────────────────────────────── */}
      <header style={{ marginBottom: 22, ...entrance(0.06) }}>
        <p style={{ margin: '0 0 7px', fontSize: 10, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: C.muted }}>
          {longDate(now)}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: 32, lineHeight: '38px', fontWeight: 600, letterSpacing: '-.015em' }}>
            {greeting(now)}, {firstName}
          </h1>
          <SessionsLeftPill quota={quota} />
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 14.5, color: C.muted }}>
          {due.length > 0
            ? `${due.length} concept${due.length === 1 ? '' : 's'} ready to review — about ${minutes} minutes.`
            : weakest.length > 0
              ? 'Nothing due today. Keep momentum by strengthening a weak concept below.'
              : 'Start a session with the Calyxa extension and your learning will build here.'}
        </p>
      </header>

      {/* ── TODAY'S REVIEW — the one dominant action ──────────────────────── */}
      <TodaysReview due={due} minutes={minutes} reviewHref={reviewHref} weakest={weakest} />

      {/* ── Pick up where you left off — slim resume strip ────────────────── */}
      {lastSession && <ContinueStrip session={lastSession} />}

      {/* ── GET AHEAD — weakest concepts (secondary) ──────────────────────── */}
      {weakest.length > 0 && (
        <div style={{ marginTop: 22, ...entrance(0.22) }}>
          <SectionLabel
            kicker="Get ahead"
            title="Weakest concepts"
            right={<Link href="/notebook" className="cx-hover-pill" style={pillAction}>Open notebook &rarr;</Link>}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(232px,1fr))', gap: 12 }}>
            {weakest.map((c) => (
              <WeakConceptCard key={c.conceptKey} c={c} now={now} reviewHref={reviewHref(c.conceptKey)} />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

// Sessions-left pill (replaces the old study-streak pill in the status header).
// Shows how many free tutoring sessions remain this billing period; Pro users
// are quota-exempt and see an "Unlimited" pill instead. When the free allowance
// is spent it turns amber as a gentle nudge to upgrade.
function SessionsLeftPill({ quota }: { quota: SessionQuota }) {
  if (quota.isPro) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: C.greenDeep, background: C.mintPill, borderRadius: 99, padding: '5px 12px' }}>
        <SessionsIcon stroke="#166534" />
        Unlimited sessions
      </span>
    )
  }
  const spent = quota.remaining <= 0
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12.5,
        fontWeight: 600,
        color: spent ? C.amber : C.greenDeep,
        background: spent ? 'rgba(146,64,14,.09)' : C.mintPill,
        borderRadius: 99,
        padding: '5px 12px',
      }}
    >
      <SessionsIcon stroke={spent ? '#92400e' : '#166534'} />
      {spent
        ? 'No sessions left this month'
        : `${quota.remaining} of ${quota.limit} session${quota.remaining === 1 ? '' : 's'} left this month`}
    </span>
  )
}

function SessionsIcon({ stroke }: { stroke: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.2" y="3.2" width="11.6" height="10.6" rx="2" />
      <path d="M2.2 6.2 H13.8 M5.4 1.8 V4 M10.6 1.8 V4" />
    </svg>
  )
}

// The cold-start home: a brand-new user (no practiced concepts) sees exactly one
// thing to do — set up the extension and run a first session — instead of a grid
// of empty placeholders. The whole product is downstream of the extension, so
// the dashboard's job here is activation, not analytics.
function ActivationView({ firstName, now }: { firstName: string; now: Date }) {
  const steps = [
    {
      title: 'Open Calyxa on a math problem',
      body: 'Pin the extension, then open it on any problem — homework, a worksheet, Khan Academy, anything on your screen.',
    },
    {
      title: 'Start a session',
      body: 'Calyxa tutors you through it step by step, asking questions — it never just hands you the answer.',
    },
    {
      title: 'Come back here',
      body: 'Your review schedule, notebook, and progress all build automatically after each session.',
    },
  ]
  return (
    <section data-screen-label="Dashboard">
      <header style={{ marginBottom: 22, ...entrance(0.06) }}>
        <p style={{ margin: '0 0 7px', fontSize: 10, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: C.muted }}>
          {longDate(now)}
        </p>
        <h1 style={{ margin: 0, fontSize: 32, lineHeight: '38px', fontWeight: 600, letterSpacing: '-.015em' }}>
          Welcome to Calyxa, {firstName}
        </h1>
        <p style={{ margin: '8px 0 0', fontSize: 14.5, color: C.muted }}>
          Your dashboard is empty for now — it fills in as you learn with the extension. Here&rsquo;s how to start.
        </p>
      </header>

      <GlassCard style={{ padding: '26px 28px 24px', ...entrance(0.12) }}>
        {/* soft breathing glow to draw the eye to the one action */}
        <span style={{ position: 'absolute', top: -40, right: -30, width: 220, height: 220, borderRadius: 99, background: 'radial-gradient(closest-side,rgba(134,239,172,.5),rgba(134,239,172,0))', filter: 'blur(20px)', animation: 'cxBreathe 4s ease-in-out infinite', pointerEvents: 'none' }} />
        <div style={{ position: 'relative' }}>
          <span style={eyebrow}>Get started</span>
          <h2 style={{ margin: '4px 0 20px', fontSize: 24, fontWeight: 600, letterSpacing: '-.015em' }}>Start your first session</h2>

          <ol style={{ margin: '0 0 22px', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {steps.map((s, i) => (
              <li key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <span style={{ flex: 'none', width: 28, height: 28, borderRadius: 99, background: C.mintTile, color: C.greenDeep, fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {i + 1}
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 600 }}>{s.title}</span>
                  <span style={{ fontSize: 13.5, lineHeight: '20px', color: C.muted }}>{s.body}</span>
                </span>
              </li>
            ))}
          </ol>

          <Link
            href="/welcome"
            style={{ display: 'inline-block', border: 'none', borderRadius: 99, background: C.mint, color: C.greenDeep, fontSize: 15, fontWeight: 600, padding: '13px 26px', cursor: 'pointer', boxShadow: '0 2px 8px rgba(28,40,30,.14)', textDecoration: 'none' }}
          >
            Set up Calyxa &rarr;
          </Link>
        </div>
      </GlassCard>
    </section>
  )
}

// A lightweight section header (eyebrow + title + optional right slot) that sits
// above a group of cards, matching the screens' header rhythm.
function SectionLabel({ kicker, title, right }: { kicker: string; title: string; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '0 2px 11px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={eyebrow}>{kicker}</span>
        <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-.01em' }}>{title}</span>
      </div>
      {right}
    </div>
  )
}

function TodaysReview({
  due,
  minutes,
  reviewHref,
  weakest,
}: {
  due: ReviewConcept[]
  minutes: number
  reviewHref: (k: string) => string
  weakest: ReviewConcept[]
}) {
  // All caught up → a calm state that still offers the next best action.
  if (due.length === 0) {
    const target = weakest[0]
    return (
      <GlassCard style={{ padding: '26px 26px 24px', ...entrance(0.12) }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ flex: 'none', width: 46, height: 46, borderRadius: 14, background: C.mintTile, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="#166534" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.4 L6.4 11.6 L13 4.6" /></svg>
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={eyebrow}>Today&rsquo;s review</span>
            <h2 style={{ margin: '3px 0 0', fontSize: 21, fontWeight: 600, letterSpacing: '-.01em' }}>You&rsquo;re all caught up</h2>
            <p style={{ margin: '5px 0 0', fontSize: 13.5, color: C.muted }}>
              {target ? `Nothing is due. Get ahead by reviewing ${target.title}.` : 'Nothing is due right now.'}
            </p>
          </div>
          {target && (
            <Link href={reviewHref(target.conceptKey)} className="cx-hover-pill" style={{ ...pillAction, flex: 'none', padding: '10px 18px', fontSize: 13 }}>
              Review {target.strandShort} &rarr;
            </Link>
          )}
        </div>
      </GlassCard>
    )
  }

  const startTarget = reviewHref(due[0].conceptKey)
  return (
    <GlassCard style={{ padding: '24px 26px 22px', ...entrance(0.12) }}>
      {/* soft breathing glow behind the hero to draw the eye */}
      <span style={{ position: 'absolute', top: -40, right: -30, width: 220, height: 220, borderRadius: 99, background: 'radial-gradient(closest-side,rgba(134,239,172,.5),rgba(134,239,172,0))', filter: 'blur(20px)', animation: 'cxBreathe 4s ease-in-out infinite', pointerEvents: 'none' }} />
      <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, marginBottom: 16 }}>
        <div>
          <span style={eyebrow}>Today&rsquo;s review</span>
          <h2 style={{ margin: '4px 0 0', fontSize: 27, fontWeight: 600, letterSpacing: '-.015em' }}>
            {due.length} concept{due.length === 1 ? '' : 's'} to review
          </h2>
          <p style={{ margin: '6px 0 0', fontSize: 13.5, color: C.muted, display: 'flex', alignItems: 'center', gap: 7 }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke={C.greenInk} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="6" /><path d="M8 4.6 V8 L10.4 9.4" /></svg>
            Estimated time · about {minutes} minutes
          </p>
        </div>
        <div style={{ position: 'relative', flex: 'none' }}>
          <span style={{ position: 'absolute', inset: -6, borderRadius: 99, background: 'radial-gradient(closest-side,rgba(187,247,208,.95),rgba(74,222,128,.5),rgba(74,222,128,0))', filter: 'blur(11px)', animation: 'cxBreathe 3s ease-in-out infinite' }} />
          <Link href={startTarget} style={{ position: 'relative', border: 'none', borderRadius: 99, background: C.mint, color: C.greenDeep, fontSize: 15, fontWeight: 600, padding: '13px 26px', cursor: 'pointer', boxShadow: '0 2px 8px rgba(28,40,30,.14)', textDecoration: 'none', display: 'inline-block' }}>
            Start review &rarr;
          </Link>
        </div>
      </div>
      <div style={{ position: 'relative', height: 1, background: C.hair, marginBottom: 4 }} />
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {due.slice(0, 6).map((c) => (
          <Link key={c.conceptKey} href={reviewHref(c.conceptKey)} className="cx-hover-soft" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 10px', borderRadius: 12, textDecoration: 'none', color: C.ink }}>
            <span style={{ width: 8, height: 8, flex: 'none', borderRadius: 99, background: c.strandColor }} />
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{c.title}</span>
              <span style={{ fontSize: 12, color: C.muted }}>{c.strandShort}{c.mastery != null ? ` · ${pct(c.mastery)}% mastery` : ''}</span>
            </span>
            {c.overdue ? (
              <Badge bg="rgba(146,64,14,.09)" color={C.amber} style={{ flex: 'none' }}>Overdue</Badge>
            ) : (
              <Badge bg={C.greenBg} color={C.greenInk} style={{ flex: 'none' }}>Due today</Badge>
            )}
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#9a988f" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><path d="M6 3 L11 8 L6 13" /></svg>
          </Link>
        ))}
        {due.length > 6 && (
          <p style={{ margin: '6px 10px 2px', fontSize: 12, color: C.muted }}>+ {due.length - 6} more due</p>
        )}
      </div>
    </GlassCard>
  )
}

// A single slim strip to resume the most recent session — the one "pick up
// where you left off" affordance the home keeps. Full history lives in Sessions.
function ContinueStrip({ session }: { session: RecentSession }) {
  // A session's study kit is the actionable continuation when it has one; else
  // the session's own detail page (its worked-problem timeline) — never the bare
  // list, which loses which session you were resuming.
  const href = session.kitHref ?? `/sessions/${session.id}`
  const when = new Date(session.startedAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  return (
    <Link
      href={href}
      className="cx-hover-soft"
      style={{ display: 'flex', alignItems: 'center', gap: 13, marginTop: 12, padding: '13px 16px', borderRadius: 15, textDecoration: 'none', color: C.ink, background: 'rgba(255,255,255,.5)', border: `1px solid ${C.hair}`, ...entrance(0.18) }}
    >
      <span style={{ flex: 'none', width: 34, height: 34, borderRadius: 10, background: C.mintTile, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#166534" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3.5 L12 8 L5 12.5 Z" /></svg>
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted }}>Pick up where you left off</span>
        <span style={{ fontSize: 14, fontWeight: 500, textTransform: 'capitalize' }}>
          {session.mode} session · {when}{session.hasKit ? ' · study kit ready' : ''}
        </span>
      </span>
      <span style={{ flex: 'none', fontSize: 12.5, fontWeight: 600, color: C.greenDeep }}>
        {session.hasKit ? 'Open kit' : 'View'} &rarr;
      </span>
    </Link>
  )
}

function WeakConceptCard({ c, now, reviewHref }: { c: ReviewConcept; now: Date; reviewHref: string }) {
  const p = c.mastery != null ? pct(c.mastery) : 0
  return (
    <GlassCard style={{ padding: '15px 16px 13px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ position: 'relative' }}>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', color: c.strandColor }}>{c.strandShort}</span>
        <p style={{ margin: '4px 0 0', fontSize: 14.5, fontWeight: 600, letterSpacing: '-.005em', lineHeight: 1.3 }}>{c.title}</p>
      </div>
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
          <span style={{ fontSize: 11.5, color: C.muted }}>{relativeDueLabel(c.dueAt, now)}</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{p}%</span>
        </div>
        <span style={{ display: 'block', height: 6, borderRadius: 99, background: 'rgba(28,28,26,.06)', overflow: 'hidden' }}>
          <span style={{ display: 'block', height: 6, borderRadius: 99, width: p + '%', background: c.overdue ? C.amber : C.greenInk, transformOrigin: 'left', animation: 'cxGrow .9s cubic-bezier(.3,1.2,.4,1) .2s both' }} />
        </span>
      </div>
      <Link href={reviewHref} className="cx-hover-pill" style={{ ...pillAction, position: 'relative', textAlign: 'center' }}>
        Quick review &rarr;
      </Link>
    </GlassCard>
  )
}
