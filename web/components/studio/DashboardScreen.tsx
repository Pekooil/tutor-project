'use client'

import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import Link from 'next/link'
import type { SessionQuota } from '@/lib/learning/activity-read'
import type { ReviewConcept } from '@/components/dashboard/premium/derive'
import { greeting, longDate, reviewMinutes } from '@/components/dashboard/premium/derive'
import type { StudioConcept, StudioSubject } from './catalog-read'
import { T, ORDINAL, eyebrow, accentButton, pill } from './tokens'
import { MOTION } from './tokens'
import { CalendarIcon, ChevronDown, ChevronRight } from './icons'

// Screen 1 — the studio dashboard. Two jobs, in order: answer "what do I do
// right now?" (the status header + the single dominant Today's Review card),
// then let the student find any tutored concept fast (the sortable subject →
// concept browser). Clicking a concept row opens its Notes.
//
// Client-side because the browser is interactive (sort mode + a single-open
// accordion); every number it renders is server-loaded and passed in.
//
// The handoff's Student filter (All · Darcy · Maya · Jonah) is deliberately not
// here: Calyxa has no multi-student model — one account is one learner — and a
// filter with one option is a lie about the product. It is on the not-yet-built
// list instead.

type SortMode = 'recent' | 'subject' | 'gaps'

const SORTS: { key: SortMode; label: string }[] = [
  { key: 'recent', label: 'Recent' },
  { key: 'subject', label: 'Subject A–Z' },
  { key: 'gaps', label: 'Most to fix' },
]

const MS_PER_DAY = 86_400_000

function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  return Math.floor((now.getTime() - then) / MS_PER_DAY)
}

function recencyLabel(iso: string | null, now: Date): string {
  const days = daysSince(iso, now)
  if (days === null) return 'not tutored yet'
  if (days <= 0) return 'tutored today'
  if (days === 1) return 'tutored yesterday'
  return `${days} days ago`
}

function shortDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// ── Bits ─────────────────────────────────────────────────────────────────────

function SessionsLeftPill({ quota }: { quota: SessionQuota }) {
  const set = quota.isPro ? ORDINAL.green : quota.remaining <= 0 ? ORDINAL.amber : ORDINAL.green
  const copy = quota.isPro
    ? 'Unlimited sessions'
    : quota.remaining <= 0
      ? 'No sessions left this month'
      : `${quota.remaining} of ${quota.limit} ${quota.remaining === 1 ? 'session' : 'sessions'} left this month`

  return (
    <span style={{ ...pill, ...set, padding: '5px 12px', fontSize: 12.5, fontWeight: 600 }}>
      <CalendarIcon size={13} />
      {copy}
    </span>
  )
}

const STATUS_DOT: Record<StudioConcept['status'], string> = {
  gap: T.a2,
  due: T.a3,
  solid: T.a1,
}

function ArtifactPill({
  children,
  tone = 'neutral',
  title,
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'green' | 'amber' | 'blue'
  title?: string
}) {
  const set =
    tone === 'green'
      ? ORDINAL.green
      : tone === 'amber'
        ? ORDINAL.amber
        : tone === 'blue'
          ? ORDINAL.blue
          : ORDINAL.neutral
  return (
    <span
      title={title}
      style={{
        ...pill,
        ...set,
        padding: '3px 9px',
        fontSize: 11,
        fontWeight: tone === 'neutral' ? 600 : 700,
      }}
    >
      {children}
    </span>
  )
}

/** A subject's mean mastery as a bar plus its number. The bar is the quick read
 *  ("how far along is this subject"), the number is the precise one; the track
 *  colour comes from the same three ordinals the concept dots use, so a subject
 *  that is mostly gaps looks amber at a glance rather than needing arithmetic. */
function MasteryMeter({ value }: { value: number }) {
  const percent = Math.round(Math.min(Math.max(value, 0), 1) * 100)
  const fill = percent >= 80 ? T.a1 : percent >= 50 ? T.a3 : T.a2

  return (
    <span
      style={{ display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0 }}
      role="img"
      aria-label={`${percent}% average mastery`}
    >
      <span
        aria-hidden="true"
        style={{
          width: 84,
          height: 6,
          borderRadius: 3,
          background: T.surface,
          overflow: 'hidden',
          display: 'block',
        }}
      >
        <span
          style={{
            display: 'block',
            width: `${percent}%`,
            height: '100%',
            background: fill,
            borderRadius: 3,
            transition: `width ${MOTION.base} ${MOTION.ease}`,
          }}
        />
      </span>
      <span style={{ fontSize: 12.5, color: T.muted, fontWeight: 600, minWidth: 30, textAlign: 'right' }}>
        {percent}%
      </span>
    </span>
  )
}

/** The concept's misconception pill. Three outcomes, in priority order: a
 *  confirmed gap (amber), nothing confirmed but something being watched (blue),
 *  or genuinely clear (green). A watched slip never reads as a gap — it has only
 *  happened once — but it is no longer silently hidden either. */
function MisconceptionPill({ concept }: { concept: StudioConcept }) {
  if (concept.misconceptionCount > 0) {
    return (
      <ArtifactPill tone="amber" title="Seen more than once and still going wrong">
        {plural(concept.misconceptionCount, 'misconception')}
      </ArtifactPill>
    )
  }
  if (concept.watchingCount > 0) {
    return (
      <ArtifactPill tone="blue" title="Seen once — Calyxa is watching whether it repeats">
        {concept.watchingCount} watching
      </ArtifactPill>
    )
  }
  return (
    <ArtifactPill tone="green" title="No misconceptions tracked on this concept">
      No gaps
    </ArtifactPill>
  )
}

function ConceptRow({ concept }: { concept: StudioConcept }) {
  return (
    <Link
      href={`/notes/${encodeURIComponent(concept.conceptKey)}`}
      className="cx-row-edge"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        width: '100%',
        padding: '13px 16px',
        border: `1px solid ${T.border}`,
        borderRadius: 11,
        background: 'transparent',
        color: T.ink,
        textDecoration: 'none',
        transition: `background ${MOTION.fast} ${MOTION.ease}, border-color ${MOTION.fast} ${MOTION.ease}`,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: STATUS_DOT[concept.status],
          flexShrink: 0,
        }}
      />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600 }}>{concept.title}</span>
        <span style={{ display: 'block', fontSize: 11.5, color: T.muted, marginTop: 2 }}>
          {concept.sessions > 0 ? plural(concept.sessions, 'session') : 'no sessions yet'}
          {concept.lastPracticedAt ? ` · last ${shortDate(concept.lastPracticedAt)}` : ''}
        </span>
      </span>

      <span style={{ display: 'flex', gap: 7, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {concept.hasNotes && <ArtifactPill>Notes</ArtifactPill>}
        {concept.quizCount > 0 && <ArtifactPill>{concept.quizCount} quiz</ArtifactPill>}
        {concept.cardCount > 0 && <ArtifactPill>{concept.cardCount} cards</ArtifactPill>}
        <MisconceptionPill concept={concept} />
      </span>

      <ChevronRight size={14} style={{ color: T.muted, flexShrink: 0 }} />
    </Link>
  )
}

function SubjectCard({
  subject,
  open,
  onToggle,
  now,
}: {
  subject: StudioSubject
  open: boolean
  onToggle: () => void
  now: Date
}) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="cx-row"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          width: '100%',
          padding: '18px 22px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          color: T.ink,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 40,
            height: 40,
            borderRadius: 11,
            background: T.accentSubtle,
            color: T.accentInk,
            fontSize: 15,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {subject.short}
        </span>

        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'block', fontSize: 17, fontWeight: 600 }}>{subject.label}</span>
          <span style={{ display: 'block', fontSize: 12.5, color: T.muted, marginTop: 2 }}>
            {plural(subject.concepts.length, 'concept')} · {recencyLabel(subject.lastPracticedAt, now)}
          </span>
        </span>

        {/* "To fix" is confirmed gaps only. When there are none, a watched slip
            still surfaces — in blue, so the two are never mistaken for each other. */}
        {subject.misconceptionCount > 0 ? (
          <span
            title="Confirmed misconceptions still going wrong"
            style={{ ...pill, ...ORDINAL.amber, padding: '3px 9px', fontSize: 11.5, fontWeight: 700 }}
          >
            {subject.misconceptionCount} to fix
          </span>
        ) : subject.watchingCount > 0 ? (
          <span
            title="Slips seen once — Calyxa is watching whether they repeat"
            style={{ ...pill, ...ORDINAL.blue, padding: '3px 9px', fontSize: 11.5, fontWeight: 700 }}
          >
            {subject.watchingCount} watching
          </span>
        ) : null}

        <MasteryMeter value={subject.averageMastery} />

        <ChevronDown
          size={14}
          style={{
            color: T.muted,
            flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: `transform ${MOTION.base} ${MOTION.ease}`,
          }}
        />
      </button>

      {open && (
        <div
          style={{
            borderTop: `1px solid ${T.border}`,
            padding: '8px 12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {subject.concepts.map((c) => (
            <ConceptRow key={c.conceptKey} concept={c} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Screen ───────────────────────────────────────────────────────────────────

/** Cold start — a brand-new account has nothing to browse, so the dashboard's job
 *  is activation, not navigation: one instruction set and one CTA into the
 *  install/setup flow. (Carried over from the pre-studio dashboard, which had
 *  this state; a muted "nothing here yet" card would waste the most important
 *  screen a new signup sees.) */
function ActivationView({ firstName, now }: { firstName: string; now: Date }) {
  return (
    <div style={{ padding: '8px 40px 48px', maxWidth: 1020, margin: '0 auto' }}>
      <div style={{ ...eyebrow, fontWeight: 600, letterSpacing: '0.14em', color: T.muted }}>{longDate(now)}</div>
      <h2 style={{ fontSize: 32, lineHeight: 1.18, fontWeight: 600, letterSpacing: '-0.015em', margin: '6px 0 0' }}>
        Welcome to Calyxa, {firstName}
      </h2>
      <p style={{ marginTop: 8, marginBottom: 0, fontSize: 14.5, color: T.muted }}>
        Your notes, quizzes and flashcards are built from your tutoring sessions — so the first one is the
        only setup there is.
      </p>

      <section
        style={{
          marginTop: 22,
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 16,
          padding: '24px 26px',
        }}
      >
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
                  background: T.accentSubtle,
                  color: T.accentInk,
                  fontSize: 11.5,
                  fontWeight: 700,
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
        <Link href="/welcome" style={{ ...accentButton, padding: '12px 22px', fontSize: 14.5 }}>
          Set up Calyxa →
        </Link>
      </section>
    </div>
  )
}

export function DashboardScreen({
  firstName,
  now,
  quota,
  due,
  subjects,
  isEmpty,
}: {
  firstName: string
  now: Date
  quota: SessionQuota
  due: ReviewConcept[]
  subjects: StudioSubject[]
  /** True when the account has no practiced concepts at all (loadDashboard). */
  isEmpty: boolean
}) {
  const [sort, setSort] = useState<SortMode>('recent')
  const [openSubject, setOpenSubject] = useState<string | null>(subjects[0]?.key ?? null)

  // Hooks must run before this branch, so the cold-start check sits here rather
  // than at the top of the component.
  const coldStart = isEmpty && subjects.length === 0

  const sorted = useMemo(() => {
    const list = [...subjects]
    if (sort === 'subject') return list.sort((a, b) => a.label.localeCompare(b.label))
    if (sort === 'gaps') return list.sort((a, b) => b.misconceptionCount - a.misconceptionCount)
    // Recent: ascending by days since the last session; never-tutored last.
    return list.sort((a, b) => {
      const da = daysSince(a.lastPracticedAt, now)
      const db = daysSince(b.lastPracticedAt, now)
      if (da === null) return db === null ? 0 : 1
      if (db === null) return -1
      return da - db
    })
  }, [subjects, sort, now])

  if (coldStart) return <ActivationView firstName={firstName} now={now} />

  const minutes = reviewMinutes(due.length)
  const startHref = due[0] ? `/notes/${encodeURIComponent(due[0].conceptKey)}` : null

  const subline =
    due.length > 0
      ? `${plural(due.length, 'concept')} ready to review — about ${minutes} minutes.`
      : subjects.length > 0
        ? 'Nothing due right now. Pick any concept below to review it.'
        : 'Start a session in the extension and your concepts will appear here.'

  return (
    <div style={{ padding: '8px 40px 48px', maxWidth: 1020, margin: '0 auto' }}>
      {/* 1a — status header */}
      <div style={{ ...eyebrow, fontWeight: 600, letterSpacing: '0.14em', color: T.muted }}>{longDate(now)}</div>
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
          {greeting(now)}, {firstName}
        </h2>
        <SessionsLeftPill quota={quota} />
      </div>
      <p style={{ marginTop: 8, marginBottom: 0, fontSize: 14.5, color: T.muted }}>{subline}</p>

      {/* 1b — Today's Review, the one dominant action */}
      <section
        style={{
          marginTop: 22,
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 16,
          padding: '24px 26px',
        }}
      >
        <div style={{ ...eyebrow, color: T.accentInk }}>Today&rsquo;s review</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
          <h3 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.015em', margin: 0, flex: 1 }}>
            {due.length > 0 ? `${plural(due.length, 'concept')}, ${minutes} minutes` : 'You’re all caught up'}
          </h3>
          {startHref && (
            <Link href={startHref} style={{ ...accentButton, padding: '12px 22px', fontSize: 14.5 }}>
              Start review →
            </Link>
          )}
        </div>

        {due.length > 0 && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
            {due.map((c, i) => (
              <span
                key={c.conceptKey}
                style={{
                  ...pill,
                  ...(i === 0 ? ORDINAL.amber : ORDINAL.neutral),
                  padding: '7px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {c.title} · {c.overdue ? 'overdue' : 'due today'}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* 1c — browser header + sort */}
      <div
        style={{
          marginTop: 34,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ ...eyebrow, color: T.muted }}>Everything tutored</div>
          <h3 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.015em', margin: '6px 0 0' }}>
            Subjects &amp; concepts
          </h3>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12.5, color: T.muted, fontWeight: 600 }}>Sort</span>
          <div role="group" aria-label="Sort subjects" style={{ display: 'flex', gap: 6 }}>
            {SORTS.map((s) => {
              const on = s.key === sort
              const style: CSSProperties = {
                borderRadius: 9,
                padding: '7px 13px',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
                background: on ? T.accent : T.card,
                color: on ? T.onAccent : T.muted,
                border: on ? '1px solid transparent' : `1px solid ${T.border}`,
              }
              return (
                <button key={s.key} type="button" aria-pressed={on} onClick={() => setSort(s.key)} style={style}>
                  {s.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* 1d — subject cards → concept rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
        {sorted.length === 0 ? (
          <div
            style={{
              background: T.card,
              border: `1px solid ${T.border}`,
              borderRadius: 14,
              padding: '28px 26px',
              color: T.muted,
              fontSize: 14.5,
            }}
          >
            Nothing tutored yet. Once you finish a session in the extension, every concept it covered shows up
            here with its notes, quiz and flashcards.
          </div>
        ) : (
          sorted.map((subject) => (
            <SubjectCard
              key={subject.key}
              subject={subject}
              now={now}
              open={openSubject === subject.key}
              onToggle={() => setOpenSubject((k) => (k === subject.key ? null : subject.key))}
            />
          ))
        )}
      </div>
    </div>
  )
}
