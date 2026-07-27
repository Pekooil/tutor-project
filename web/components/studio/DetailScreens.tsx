import type { CSSProperties } from 'react'
import Link from 'next/link'
import type { MisconceptionDetail } from '@/components/dashboard/premium/detail-read'
import type { SessionDetail, SnapshotAnnotation, WorkedSnapshot } from '@/components/dashboard/premium/snapshots-read'
import { strandColorVar } from './chart-tokens'
import { T, ORDINAL, RULE, RADIUS, eyebrow, ghostButton, pageEyebrow, pill } from './tokens'
import { ChevronLeft, ChevronRight } from './icons'

// The two remaining drill-downs, rebuilt on studio tokens: a misconception
// (linked from the Progress tab's open-gap rows) and one tutoring session
// (linked from the provenance line in a concept's notes).
//
// Both were pre-studio screens on `premium/theme.ts`'s light hexes, so following
// either link from the dark studio landed on a white page. The server READS are
// reused unchanged — `loadMisconceptionDetail` and `loadSessionDetail` are data,
// not styling — and only the rendering is new.

const MAX_W = 1020

const sectionLabel: CSSProperties = { ...eyebrow, color: T.muted }

/** A detail card's box metrics; the glass comes from the `cx-card` class. */
const card: CSSProperties = { padding: '20px 22px' }

function BackLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="cx-weakest"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 12.5,
        fontWeight: 600,
        color: T.muted,
        textDecoration: 'none',
        marginBottom: 14,
      }}
    >
      <ChevronLeft size={13} />
      {children}
    </Link>
  )
}

function DetailPage({
  back,
  eyebrowText,
  eyebrowColor,
  title,
  sub,
  children,
}: {
  back: { href: string; label: string }
  eyebrowText: string
  eyebrowColor?: string
  title: string
  sub?: string
  children: React.ReactNode
}) {
  return (
    <div style={{ padding: '26px 40px 56px' }}>
      <div style={{ maxWidth: MAX_W, margin: '0 auto' }}>
        <BackLink href={back.href}>{back.label}</BackLink>
        <div style={{ ...pageEyebrow, color: eyebrowColor ?? T.muted }}>{eyebrowText}</div>
        <h1 style={{ margin: '6px 0 0', fontSize: 32, lineHeight: '38px', fontWeight: 600, letterSpacing: '-0.015em' }}>
          {title}
        </h1>
        {sub && <p style={{ margin: '8px 0 0', fontSize: 14, color: T.muted }}>{sub}</p>}
        {children}
      </div>
    </div>
  )
}

function Row({ label, value, first, tone }: { label: string; value: string; first?: boolean; tone?: 'green' }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 16,
        padding: '10px 0',
        borderTop: first ? 'none' : RULE,
      }}
    >
      <span style={{ fontSize: 13, color: T.muted }}>{label}</span>
      <span style={{ fontSize: 13.5, fontWeight: 500, color: tone === 'green' ? T.accentInk : T.ink }}>{value}</span>
    </div>
  )
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

// ── Misconception ────────────────────────────────────────────────────────────

export function MisconceptionDetailScreen({ detail }: { detail: MisconceptionDetail }) {
  const m = detail.misconception
  const resolved = m.status === 'resolved'
  const watching = m.status === 'pending'
  const filled = resolved ? detail.resolutionStreak : Math.min(detail.resolutionStreak, Math.max(0, m.consecutiveCorrect))
  const category = m.category ? m.category.replace(/[-_]/g, ' ') : 'pattern'
  const node = detail.conceptNode

  const statusSet = resolved ? ORDINAL.green : watching ? ORDINAL.blue : ORDINAL.amber
  const statusText = resolved ? 'Resolved' : watching ? 'Watching' : 'Active'

  return (
    <DetailPage
      back={{ href: '/data', label: 'Progress' }}
      eyebrowText={m.strandLabel}
      eyebrowColor={strandColorVar(m.strand)}
      title={m.description || m.title}
    >
      <section className="cx-card cx-rise" style={{ ...card, marginTop: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <span
            style={{
              ...pill,
              ...ORDINAL.neutral,
              padding: '3px 9px',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.09em',
              textTransform: 'uppercase',
            }}
          >
            {category}
          </span>
          <span
            style={{
              ...pill,
              ...statusSet,
              marginLeft: 'auto',
              padding: '3px 9px',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.09em',
              textTransform: 'uppercase',
            }}
          >
            {statusText}
          </span>
        </div>

        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: T.ink }}>
          {watching
            ? 'Calyxa has seen this once. It only becomes a tracked gap — something the tutor teaches against — if it happens again.'
            : resolved
              ? 'Closed. You answered this correctly three times in a row, so the tutor no longer teaches against it.'
              : 'A confirmed pattern: this has gone wrong more than once, so the tutor now works against it directly.'}
        </p>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            marginTop: 16,
            paddingTop: 14,
            borderTop: RULE,
          }}
        >
          <span style={{ fontSize: 12.5, color: T.muted, flex: '1 1 220px' }}>
            {resolved
              ? 'Three correct in a row closed it.'
              : watching
                ? 'Not a confirmed pattern yet.'
                : `${detail.resolutionStreak - filled} more correct in a row closes it.`}
          </span>
          <span style={{ display: 'flex', gap: 4 }} aria-hidden="true">
            {Array.from({ length: detail.resolutionStreak }).map((_, i) => (
              <span
                key={i}
                style={{
                  width: 20,
                  height: 6,
                  borderRadius: 99,
                  background: i < filled ? T.accentInk : T.dotInactive,
                }}
              />
            ))}
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: filled > 0 ? T.accentInk : T.muted }}>
            {filled} of {detail.resolutionStreak}
          </span>
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }} className="cx-progress-pair">
        <section className="cx-card" style={card}>
          <div style={{ ...sectionLabel, marginBottom: 10 }}>History</div>
          <Row first label="Times seen" value={String(m.occurrenceCount)} />
          <Row label="First seen" value={day(m.firstSeenAt)} />
          <Row label="Last seen" value={day(m.lastSeenAt)} />
          {resolved && m.resolvedAt && <Row label="Resolved" value={day(m.resolvedAt)} tone="green" />}
        </section>

        <section className="cx-card" style={card}>
          <div style={{ ...sectionLabel, marginBottom: 10 }}>Concept</div>
          <p style={{ margin: '0 0 14px', fontSize: 13.5, lineHeight: 1.6, color: T.muted }}>
            {node
              ? `${node.title} — ${Math.round(node.mastery * 100)}% mastery.`
              : `${m.title} — not practised yet.`}
          </p>
          {/* Practice used to point at /kits/[key], the retired kit viewer. The
              notes panel hosts the quiz and flashcards now, so the concept's
              notes are both the current home and a studio screen. */}
          <Link
            href={`/notes/${encodeURIComponent(m.conceptKey)}`}
            style={{ ...ghostButton, borderRadius: RADIUS.pill, padding: '9px 17px', fontSize: 13 }}
          >
            Open notes and practise
            <ChevronRight size={13} />
          </Link>
        </section>
      </div>
    </DetailPage>
  )
}

// ── Session ──────────────────────────────────────────────────────────────────

function Annotation({ a }: { a: SnapshotAnnotation }) {
  return (
    <div style={{ marginBottom: 12 }}>
      {a.targetText && (
        <div
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 13,
            color: T.ink,
            padding: '6px 10px',
            borderRadius: 8,
            background: T.raised4,
            display: 'inline-block',
          }}
        >
          {a.targetText}
        </div>
      )}
      {(a.label || a.note) && (
        <div style={{ display: 'flex', gap: 8, marginTop: a.targetText ? 6 : 0 }}>
          {/* The ordinal colours have no dark variant, so the rule uses the
              amber that DOES flip rather than the annotation palette. */}
          <span style={{ flex: 'none', width: 3, borderRadius: 99, background: T.amber, opacity: 0.75 }} />
          <div style={{ minWidth: 0 }}>
            {a.label && <span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{a.label}</span>}
            {a.note && (
              <p style={{ margin: a.label ? '2px 0 0' : 0, fontSize: 12.5, lineHeight: 1.5, color: T.muted }}>
                {a.note}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SnapshotCard({ snapshot }: { snapshot: WorkedSnapshot }) {
  const { annotations, tutorResponse, misconception, studentTranscript, conceptTitle, turnIndex } = snapshot
  return (
    <div style={{ background: T.row, border: `1px solid ${T.frame}`, borderRadius: 14, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ ...sectionLabel, fontSize: 9.5 }}>{conceptTitle ?? `Turn ${turnIndex}`}</span>
        {misconception && (
          <span style={{ ...pill, ...ORDINAL.amber, marginLeft: 'auto', padding: '3px 9px', fontSize: 10.5, fontWeight: 600 }}>
            {misconception}
          </span>
        )}
      </div>

      {studentTranscript && (
        <p style={{ margin: '0 0 10px', fontSize: 12.5, lineHeight: 1.5, color: T.muted }}>
          <span style={{ fontWeight: 600, color: T.ink }}>You:</span> {studentTranscript}
        </p>
      )}

      {annotations.length > 0 && (
        <div
          style={{
            borderRadius: 12,
            border: `1px solid ${T.frame}`,
            background: T.raised4,
            padding: '12px 14px 2px',
            marginBottom: tutorResponse ? 10 : 0,
          }}
        >
          {annotations.map((a) => (
            <Annotation key={a.id} a={a} />
          ))}
        </div>
      )}

      {tutorResponse && <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: T.ink }}>{tutorResponse}</p>}
    </div>
  )
}

function duration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return 'in progress'
  const mins = Math.max(1, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000))
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`
}

export function SessionDetailScreen({ detail }: { detail: SessionDetail }) {
  const annotated = detail.snapshots.filter((s) => s.annotations.length > 0).length
  const started = new Date(detail.startedAt)

  return (
    <DetailPage
      back={{ href: '/sessions', label: 'Session history' }}
      eyebrowText={started.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
      title={`${detail.mode === 'voice' ? 'Voice' : 'Text'} session`}
      sub={`${started.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · ${duration(detail.startedAt, detail.endedAt)} · ${detail.snapshots.length} turn${detail.snapshots.length === 1 ? '' : 's'}`}
    >
      {detail.snapshots.length === 0 ? (
        <section style={{ ...card, marginTop: 22, fontSize: 14, color: T.muted }}>
          This session has no recorded turns.
        </section>
      ) : (
        <section className="cx-card cx-rise" style={{ ...card, marginTop: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
            <span style={sectionLabel}>Worked-problem timeline</span>
            {annotated > 0 && <span style={{ fontSize: 12, color: T.muted }}>{annotated} annotated</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {detail.snapshots.map((s) => (
              <SnapshotCard key={s.id} snapshot={s} />
            ))}
          </div>
        </section>
      )}
    </DetailPage>
  )
}
