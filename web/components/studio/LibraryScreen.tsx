'use client'

import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import Link from 'next/link'
import type { StudioConcept, StudioSubject } from './catalog-read'
import { T, ORDINAL, RADIUS, pageEyebrow, pill } from './tokens'
import { MOTION } from './tokens'
import { strandColorVar } from './chart-tokens'
import { ChevronDown, ChevronRight } from './icons'

// The library — every subject and concept Calyxa has tutored, browsable.
//
// This lived at the bottom of the dashboard, which meant the only way to reach a
// concept was to scroll past Today's Review and the schedule and open the right
// accordion. Worse, `/notes` — the rail item you would instinctively click to
// find a concept — was a bare REDIRECT to whichever concept you last touched, so
// there was no index anywhere in the product.
//
// It is that index now. The dashboard keeps "what do I do right now"; this
// answers "where is the thing I am looking for", which is a different question
// and deserves its own screen and its own full height.
//
// Client-side for the search box, the sort mode and the single-open accordion;
// every number it renders is server-loaded and passed in.

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

/** The concept-row dot: a confirmed gap, a due review, or solid. Reads the
 *  status tones, not the annotation ordinals — an ordinal has no dark variant,
 *  and this dot sits on a dark card. */
const STATUS_DOT: Record<StudioConcept['status'], string> = {
  gap: T.amber,
  due: T.blue,
  solid: T.greenDot,
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
        fontWeight: 600,
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
  const fill = percent >= 80 ? T.greenDot : percent >= 50 ? T.blue : T.amber

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
          height: 7,
          borderRadius: RADIUS.pill,
          background: T.track,
          overflow: 'hidden',
          display: 'block',
        }}
      >
        <span
          className="cx-bar"
          style={{
            display: 'block',
            width: `${percent}%`,
            height: '100%',
            background: fill,
            borderRadius: RADIUS.pill,
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
        padding: '13px 15px',
        // Row inside the subject card → its own raised fill and the soft frame,
        // so the box reads without leaning on a heavy outline.
        border: `1px solid ${T.frame}`,
        borderRadius: RADIUS.box,
        background: T.raised4,
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
        <span style={{ display: 'block', fontSize: 14, fontWeight: 500 }}>{concept.title}</span>
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
  // The tile carries the SUBJECT's colour, tinted — the same hue its row gets in
  // Progress's "By subject", so a subject looks like itself everywhere.
  const subjectColor = strandColorVar(subject.key)

  return (
    <div className="cx-card">
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
          padding: '17px 20px',
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
            borderRadius: RADIUS.box,
            background: `color-mix(in srgb, ${subjectColor} var(--studio-tile-tint), transparent)`,
            color: subjectColor,
            fontSize: 12,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {subject.short}
        </span>

        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'block', fontSize: 16.5, fontWeight: 600 }}>{subject.label}</span>
          <span style={{ display: 'block', fontSize: 12.5, color: T.muted, marginTop: 2 }}>
            {plural(subject.concepts.length, 'concept')} · {recencyLabel(subject.lastPracticedAt, now)}
          </span>
        </span>

        {/* "To fix" is confirmed gaps only. When there are none, a watched slip
            still surfaces — in blue, so the two are never mistaken for each other. */}
        {subject.misconceptionCount > 0 ? (
          <span
            title="Confirmed misconceptions still going wrong"
            style={{ ...pill, ...ORDINAL.amber, padding: '3px 9px', fontSize: 11.5, fontWeight: 600 }}
          >
            {subject.misconceptionCount} to fix
          </span>
        ) : subject.watchingCount > 0 ? (
          <span
            title="Slips seen once — Calyxa is watching whether they repeat"
            style={{ ...pill, ...ORDINAL.blue, padding: '3px 9px', fontSize: 11.5, fontWeight: 600 }}
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
            borderTop: `1px solid ${T.hairline}`,
            padding: '11px 12px 14px',
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

export function LibraryScreen({ subjects, now }: { subjects: StudioSubject[]; now: Date }) {
  const [sort, setSort] = useState<SortMode>('recent')
  const [query, setQuery] = useState('')
  const [openSubject, setOpenSubject] = useState<string | null>(subjects[0]?.key ?? null)

  const q = query.trim().toLowerCase()

  // Search matches a SUBJECT or any concept inside it, and narrows the subject to
  // its matching concepts — so typing "quad" leaves one subject holding one row
  // rather than making you hunt through an otherwise-unchanged tree.
  const filtered = useMemo(() => {
    if (!q) return subjects
    return subjects
      .map((s) => {
        if (s.label.toLowerCase().includes(q)) return s
        const concepts = s.concepts.filter((c) => c.title.toLowerCase().includes(q))
        return concepts.length > 0 ? { ...s, concepts } : null
      })
      .filter((s): s is StudioSubject => s !== null)
  }, [subjects, q])

  const sorted = useMemo(() => {
    const list = [...filtered]
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
  }, [filtered, sort, now])

  // A search collapses the tree to what matched, so every result should be
  // visible without another click.
  const expandAll = q.length > 0
  const conceptCount = subjects.reduce((a, s) => a + s.concepts.length, 0)

  return (
    <div style={{ padding: '26px 40px 56px' }}>
      <div style={{ maxWidth: 1020, margin: '0 auto' }}>
        <div style={{ ...pageEyebrow, color: T.muted }}>Everything tutored</div>
        <h1 style={{ margin: '6px 0 0', fontSize: 32, lineHeight: '38px', fontWeight: 600, letterSpacing: '-0.015em' }}>
          Subjects &amp; concepts
        </h1>
        <p style={{ margin: '8px 0 0', fontSize: 14.5, color: T.muted }}>
          {conceptCount === 0
            ? 'Nothing tutored yet — every concept a session covers shows up here.'
            : `${plural(conceptCount, 'concept')} across ${plural(subjects.length, 'subject')}. Open one for its notes, quiz and flashcards.`}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 20 }}>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search subjects and concepts…"
            aria-label="Search subjects and concepts"
            style={{
              flex: '1 1 260px',
              minWidth: 200,
              height: 40,
              padding: '0 16px',
              borderRadius: RADIUS.pill,
              border: `1px solid ${T.frame}`,
              background: T.field,
              color: T.ink,
              fontSize: 13.5,
              fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12.5, color: T.muted, fontWeight: 600 }}>Sort</span>
            {/* A segmented control, not three loose buttons: one pill container
                holding three seats, so "these are the three modes, one is on"
                is legible before any label is read. */}
            <div
              role="group"
              aria-label="Sort subjects"
              style={{
                display: 'flex',
                gap: 2,
                padding: 4,
                borderRadius: RADIUS.pill,
                background: T.cardSoft,
                border: `1px solid ${T.frame}`,
              }}
            >
              {SORTS.map((s) => {
                const on = s.key === sort
                const style: CSSProperties = {
                  borderRadius: RADIUS.pill,
                  padding: '6px 13px',
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: on ? T.accent : 'transparent',
                  color: on ? T.onAccent : T.muted,
                  border: 'none',
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 18 }}>
          {sorted.length === 0 ? (
            <div className="cx-card" style={{ padding: '28px 26px', color: T.muted, fontSize: 14.5 }}>
              {q
                ? `Nothing matches “${query.trim()}”.`
                : 'Nothing tutored yet. Once you finish a session in the extension, every concept it covered shows up here.'}
            </div>
          ) : (
            sorted.map((subject) => (
              <SubjectCard
                key={subject.key}
                subject={subject}
                open={expandAll || openSubject === subject.key}
                onToggle={() => setOpenSubject(openSubject === subject.key ? null : subject.key)}
                now={now}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
