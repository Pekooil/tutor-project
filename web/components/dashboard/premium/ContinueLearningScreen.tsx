import Link from 'next/link'
import type { ReactNode } from 'react'
import { CONCEPTS } from '@calyxa/curriculum'
import { STRAND_LABELS, strandOf } from '@/lib/onboarding/item-bank'
import type { DashboardData } from '@/lib/learning/dashboard-read'
import type { RecentSession } from '@/lib/learning/activity-read'
import { GlassCard, CardHead, Badge } from './primitives'
import { C, glassCardSoft, eyebrow, pillAction, entrance, pct, strandStyle } from './theme'
import { kitHrefForConcept, type StudyKit } from './kits-read'
import {
  greeting,
  longDate,
  overviewStats,
  todaysReview,
  weakestConcepts,
  upcomingReviews,
  relativeDueLabel,
  reviewMinutes,
  type ReviewConcept,
} from './derive'

const cellPad = { position: 'relative' as const, padding: '15px 20px', display: 'flex', flexDirection: 'column' as const, gap: 4 }

// The post-login home. Reframed from an analytics overview into a "Continue
// learning" surface: the first thing a student sees is what to review right now,
// then their weakest concepts, recent sessions, the forward review schedule, and
// — demoted to the bottom — the progress numbers. Every action routes to the
// concept's study kit when one exists, else the concept workspace. Server
// component; all data comes from the RLS-scoped, per-request-fresh loadDashboard.
export function ContinueLearningScreen({
  data,
  now,
  firstName,
  totalCurriculum,
  kits,
  recentSessions,
}: {
  data: DashboardData
  now: Date
  firstName: string
  totalCurriculum: number
  kits: StudyKit[]
  recentSessions: RecentSession[]
}) {
  const stats = overviewStats(data)
  const due = todaysReview(data, now)
  const weakest = weakestConcepts(data, 5)
  const upcoming = upcomingReviews(data, now)

  // A concept's best review target: the guided review flow when a study kit
  // exists to review with, else its workspace page (where its notes / practice /
  // flashcards and schedule live).
  const reviewHref = (conceptKey: string): string => {
    return kitHrefForConcept(kits, conceptKey) ? `/review/${conceptKey}` : `/concepts/${conceptKey}`
  }

  const minutes = reviewMinutes(due.length)

  return (
    <section data-screen-label="Dashboard">
      {/* Header */}
      <header style={{ marginBottom: 22, ...entrance(0.06) }}>
        <p style={{ margin: '0 0 7px', fontSize: 10, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: C.muted }}>
          {longDate(now)}
        </p>
        <h1 style={{ margin: 0, fontSize: 32, lineHeight: '38px', fontWeight: 600, letterSpacing: '-.015em' }}>
          {greeting(now)}, {firstName}
        </h1>
        <p style={{ margin: '8px 0 0', fontSize: 14.5, color: C.muted }}>
          {due.length > 0
            ? `${due.length} concept${due.length === 1 ? '' : 's'} ready to review — about ${minutes} minutes.`
            : weakest.length > 0
              ? 'Nothing due today. Keep momentum by strengthening a weak concept below.'
              : 'Start a session with the Calyxa extension and your learning will build here.'}
        </p>
      </header>

      {/* ── TODAY'S REVIEW — the dominant action ──────────────────────────── */}
      <TodaysReview due={due} minutes={minutes} reviewHref={reviewHref} weakest={weakest} />

      {/* ── YOUR NOTEBOOK + CONTINUE LAST SESSION ─────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)', gap: 16, marginBottom: 16, alignItems: 'stretch' }}>
        <NotebookHero data={data} />
        <ContinueLastSession session={recentSessions[0] ?? null} />
      </div>

      {/* ── TUTOR INSIGHTS teaser ─────────────────────────────────────────── */}
      <InsightsTeaser data={data} />

      {/* ── WEAKEST CONCEPTS ──────────────────────────────────────────────── */}
      {weakest.length > 0 && (
        <div style={{ marginBottom: 16, ...entrance(0.2) }}>
          <SectionLabel
            kicker="Focus"
            title="Weakest concepts"
            right={<Link href="/concepts" className="cx-hover-pill" style={pillAction}>All concepts &rarr;</Link>}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(232px,1fr))', gap: 12 }}>
            {weakest.map((c) => (
              <WeakConceptCard key={c.conceptKey} c={c} now={now} reviewHref={reviewHref(c.conceptKey)} />
            ))}
          </div>
        </div>
      )}

      {/* ── RECENT SESSIONS + UPCOMING REVIEWS ────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.15fr) minmax(0,1fr)', gap: 16, marginBottom: 16, alignItems: 'start' }}>
        <RecentSessions sessions={recentSessions} />
        <UpcomingReviews buckets={upcoming} />
      </div>

      {/* ── PROGRESS OVERVIEW — secondary ─────────────────────────────────── */}
      <div style={{ ...entrance(0.36) }}>
        <SectionLabel kicker="Progress" title="Your numbers" right={<Link href="/activity" className="cx-hover-pill" style={pillAction}>Activity &rarr;</Link>} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', ...glassCardSoft }}>
          <div style={cellPad}>
            <span style={eyebrow}>Accuracy</span>
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 24, fontWeight: 600, lineHeight: '28px' }}>{stats.accuracy != null ? stats.accuracy + '%' : '—'}</span>
              <span style={{ fontSize: 12, color: C.muted }}>{stats.accuracySub}</span>
            </span>
          </div>
          <div style={{ ...cellPad, borderLeft: `1px solid ${C.hair}` }}>
            <span style={eyebrow}>Day streak</span>
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 24, fontWeight: 600, lineHeight: '28px' }}>{stats.streak}</span>
              <span style={{ fontSize: 12, color: C.muted }}>{stats.streak === 1 ? 'day' : 'days'}</span>
            </span>
          </div>
          <div style={{ ...cellPad, borderLeft: `1px solid ${C.hair}` }}>
            <span style={eyebrow}>Concepts</span>
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 24, fontWeight: 600, lineHeight: '28px' }}>{data.totalConcepts}</span>
              <span style={{ fontSize: 12, color: C.muted }}>of {totalCurriculum} · {stats.mastered} mastered</span>
            </span>
          </div>
        </div>
      </div>
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
      <GlassCard style={{ padding: '26px 26px 24px', marginBottom: 16, ...entrance(0.12) }}>
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
    <GlassCard style={{ padding: '24px 26px 22px', marginBottom: 16, ...entrance(0.12) }}>
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

function sessionDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return 'In progress'
  const mins = Math.max(1, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000))
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  return `${h}h ${mins % 60}m`
}

function RecentSessions({ sessions }: { sessions: RecentSession[] }) {
  const shortDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return (
    <GlassCard style={{ padding: '16px 17px 14px', ...entrance(0.28) }}>
      <CardHead
        icon={<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#166534" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 4 V8 L10.6 9.6" /><circle cx="8" cy="8" r="6" /></svg>}
        kicker="Recent sessions"
        title="Your history"
        right={<Link href="/sessions" className="cx-hover-pill" style={pillAction}>All sessions &rarr;</Link>}
      />
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {sessions.length > 0 ? (
          sessions.slice(0, 5).map((s) => (
            <Link key={s.id} href={s.kitHref ?? '/sessions'} className="cx-hover-soft" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 8px', borderRadius: 12, textDecoration: 'none', color: C.ink }}>
              <span style={{ flex: 'none', width: 52, textAlign: 'center', fontSize: 11, fontWeight: 600, color: C.muted }}>{shortDate(s.startedAt)}</span>
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: 13.5, fontWeight: 500, textTransform: 'capitalize' }}>{s.mode} session</span>
                <span style={{ fontSize: 12, color: C.muted }}>{sessionDuration(s.startedAt, s.endedAt)}</span>
              </span>
              {s.hasKit && <Badge bg={C.mintPill} color={C.greenDeep} style={{ flex: 'none' }}>Study kit</Badge>}
            </Link>
          ))
        ) : (
          <p style={{ fontSize: 13, color: C.muted, padding: '9px 8px' }}>No sessions yet — your tutoring history will appear here.</p>
        )}
      </div>
    </GlassCard>
  )
}

// The notebook is the center of the product — the dashboard's second action,
// right under Today's Review. Shows the student's most-developed subject
// notebooks with a link straight into each, and a prominent "open notebook" CTA.
function NotebookHero({ data }: { data: DashboardData }) {
  const totalsBySubject = new Map<string, number>()
  for (const c of CONCEPTS) totalsBySubject.set(strandOf(c.key), (totalsBySubject.get(strandOf(c.key)) ?? 0) + 1)

  const rows = data.strands
    .map((s) => ({
      key: s.strand,
      label: STRAND_LABELS[s.strand] ?? s.strandLabel,
      color: strandStyle(s.strand).color,
      practiced: s.nodes.length,
      total: totalsBySubject.get(s.strand) ?? 0,
      avg: s.averageMastery,
    }))
    .filter((s) => s.practiced > 0)
    .sort((a, b) => b.practiced - a.practiced)
    .slice(0, 3)

  return (
    <GlassCard style={{ padding: '18px 20px 16px', ...entrance(0.16), display: 'flex', flexDirection: 'column' }}>
      <CardHead
        icon={<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#166534" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 2.5 H12 A1 1 0 0 1 13 3.5 V13.5 L8 11 L3 13.5 V3.5 A1 1 0 0 1 4 2.5" /></svg>}
        kicker="Your notebook"
        title="Everything you've learned"
        right={<Link href="/notebook" className="cx-hover-pill" style={pillAction}>Open notebook &rarr;</Link>}
      />
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
        {rows.length > 0 ? (
          rows.map((s) => {
            const p = pct(s.avg)
            return (
              <Link key={s.key} href={`/notebook/${s.key}`} className="cx-hover-soft" style={{ display: 'block', textDecoration: 'none', color: C.ink, padding: '9px 10px', borderRadius: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span style={{ flex: 'none', width: 9, height: 9, borderRadius: 3, background: s.color }} />
                  <span style={{ fontSize: 13.5, fontWeight: 500, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</span>
                  <span style={{ flex: 'none', fontSize: 12, color: C.muted }}>{s.practiced}/{s.total} · {p}%</span>
                </div>
                <span style={{ display: 'block', height: 5, borderRadius: 99, background: 'rgba(28,28,26,.06)', overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: 5, borderRadius: 99, width: `${p}%`, background: s.color }} />
                </span>
              </Link>
            )
          })
        ) : (
          <p style={{ fontSize: 13, color: C.muted, padding: '9px 10px' }}>
            Your notebook writes itself as you study. Start a session and each concept gets its own living page here.
          </p>
        )}
      </div>
    </GlassCard>
  )
}

// Priority 3: pick up the most recent session where the student left off.
function ContinueLastSession({ session }: { session: RecentSession | null }) {
  const href = session ? (session.kitHref ?? '/sessions') : '/sessions'
  const when = session
    ? new Date(session.startedAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    : null
  return (
    <GlassCard style={{ padding: '18px 20px', ...entrance(0.2), display: 'flex', flexDirection: 'column' }}>
      <CardHead
        icon={<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#166534" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3.5 L12 8 L5 12.5 Z" /></svg>}
        kicker="Pick up where you left off"
        title="Continue"
      />
      <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column' }}>
        {session ? (
          <>
            <p style={{ margin: '0 0 3px', fontSize: 14, fontWeight: 500, textTransform: 'capitalize' }}>{session.mode} session</p>
            <p style={{ margin: 0, fontSize: 12.5, color: C.muted }}>{when}{session.hasKit ? ' · study kit ready' : ''}</p>
            <Link href={href} style={{ marginTop: 'auto', border: 'none', borderRadius: 99, background: C.mint, color: C.greenDeep, fontSize: 13.5, fontWeight: 600, padding: '10px 0', textAlign: 'center', textDecoration: 'none' }}>
              {session.hasKit ? 'Open study kit →' : 'View session →'}
            </Link>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: C.muted }}>No sessions yet — your most recent one will land here to resume.</p>
        )}
      </div>
    </GlassCard>
  )
}

// Priority 4: a compact "how you learn" teaser that opens the notebook's full
// Tutor Insights. Uses only the numbers already on the dashboard read.
function InsightsTeaser({ data }: { data: DashboardData }) {
  const stats = overviewStats(data)
  const items = [
    { label: 'Concepts mastered', value: String(stats.mastered) },
    { label: 'Recent accuracy', value: stats.accuracy != null ? `${stats.accuracy}%` : '—' },
    { label: 'Active misconceptions', value: String(stats.activeMisconceptions) },
    { label: 'Day streak', value: String(stats.streak) },
  ]
  return (
    <div style={{ marginBottom: 16, ...entrance(0.24) }}>
      <GlassCard soft style={{ padding: '15px 18px' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginRight: 'auto' }}>
            <span style={eyebrow}>Tutor insights</span>
            <span style={{ fontSize: 15, fontWeight: 600 }}>How you learn</span>
          </div>
          {items.map((it, i) => (
            <div key={it.label} style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: i === 0 ? 0 : 16, borderLeft: i === 0 ? 'none' : `1px solid ${C.hair}` }}>
              <span style={{ fontSize: 19, fontWeight: 600, lineHeight: '22px' }}>{it.value}</span>
              <span style={{ fontSize: 11, color: C.muted }}>{it.label}</span>
            </div>
          ))}
          <Link href="/notebook#insights" className="cx-hover-pill" style={{ ...pillAction, marginLeft: 8 }}>See profile &rarr;</Link>
        </div>
      </GlassCard>
    </div>
  )
}

function UpcomingReviews({ buckets }: { buckets: ReturnType<typeof upcomingReviews> }) {
  return (
    <GlassCard style={{ padding: '16px 17px 14px', ...entrance(0.32) }}>
      <CardHead
        icon={<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#166534" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2.4" y="3.2" width="11.2" height="10" rx="1.8" /><path d="M2.4 6.4 H13.6" /><path d="M5.4 1.8 V4" /><path d="M10.6 1.8 V4" /></svg>}
        kicker="Upcoming reviews"
        title="What's coming back"
      />
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {buckets.length > 0 ? (
          buckets.map((b) => (
            <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 8px', borderRadius: 12 }}>
              <span style={{ flex: 'none', width: 76, fontSize: 12.5, fontWeight: 600 }}>{b.label}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {b.concepts.join(' · ')}
              </span>
              <Badge bg="rgba(28,28,26,.05)" color={C.muted} style={{ flex: 'none' }}>{b.count}</Badge>
            </div>
          ))
        ) : (
          <p style={{ fontSize: 13, color: C.muted, padding: '9px 8px' }}>
            Nothing scheduled yet — Calyxa schedules concepts for review as you practice them.
          </p>
        )}
      </div>
    </GlassCard>
  )
}
