'use client'

import { Fragment, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import { CalyxaMark } from '@calyxa/ui'
import type { DashboardMisconception } from '@/lib/learning/dashboard-read'
import type { NotebookSection, NotebookStep, NotebookSubsection } from '@/lib/notebook/tool'
import type { StudioNotes } from './notes-read'
import { misconceptionState, MISCONCEPTION_MEANING, type MisconceptionState } from './misconception'
import { T, ORDINAL, MATH_FONT, SHADOW, MOTION, pill, eyebrow as eyebrowStyle } from './tokens'
import { SECTION_ICON, ChecklistIcon, PencilIcon } from './icons'

// Screen 2a — the notes column: the concept's Personal Notebook rendered as a
// readable document, annotated with exactly what the student got wrong in the
// last session.
//
// Everything here is driven by real records — the notebook the generator wrote
// (ADR-054), joined to the live misconception rows for the counts and dates.
// The three flag treatments the design specifies are all present and all mean
// different things: the heading pill (this block is a known gap or a known
// strength), the "Your attempt" callout (the student's actual wrong work), and
// the margin dot (a hoverable pointer at the exact step that slipped).

function shortDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Renders `x^2` as x², the one bit of markup the plain-text expressions carry.
 *  A real math renderer (KaTeX/MathJax) is on the not-yet-built list. */
function MathText({ expr, size = 16 }: { expr: string; size?: number }) {
  const parts = expr.split(/\^(-?\w+)/g)
  return (
    <span style={{ fontFamily: MATH_FONT, fontStyle: 'italic', fontSize: size }}>
      {parts.map((part, i) =>
        i % 2 === 1 ? <sup key={i}>{part}</sup> : <Fragment key={i}>{part}</Fragment>
      )}
    </span>
  )
}

function MathBubble({ expr }: { expr: string }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        padding: '12px 20px',
        margin: '16px 0',
      }}
    >
      <MathText expr={expr} size={19} />
    </div>
  )
}

// ── The revision changelog ───────────────────────────────────────────────────

/** One group in the "Since your <date> session" card. Each group is a different
 *  KIND of change, so each gets its own ordinal: green for what the student now
 *  gets right, amber for a newly-spotted misconception, neutral for edits to the
 *  notebook itself. A group with nothing in it is not rendered — an empty
 *  "no new misconceptions" row would read as reassurance the data can't support. */
function ChangeGroup({
  label,
  items,
  tone,
}: {
  label: string
  items: string[]
  tone: 'green' | 'amber' | 'neutral'
}) {
  if (items.length === 0) return null
  const dot = tone === 'green' ? T.a1 : tone === 'amber' ? T.a2 : T.borderStrong
  // The card is a neutral surface, not a tint — so these use the theme-aware
  // inks, not the ordinals' `-deep` values (see tokens.ts).
  const ink = tone === 'green' ? T.ink1 : tone === 'amber' ? T.ink2 : T.muted

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '0.09em',
          textTransform: 'uppercase',
          color: ink,
        }}
      >
        <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: dot }} />
        {label}
      </div>
      <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((item, i) => (
          <li key={i} style={{ fontSize: 14.5, lineHeight: 1.6, paddingLeft: 14 }}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

function RevisionCard({
  revision,
  sessionDate,
}: {
  revision: NonNullable<StudioNotes['notebook']>['revision']
  sessionDate: string
}) {
  if (!revision) return null

  return (
    <section
      style={{
        marginTop: 22,
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
        {sessionDate ? `Since your ${sessionDate} session` : 'Since your last session'}
      </h3>
      <ChangeGroup label="You improved" items={revision.improved} tone="green" />
      <ChangeGroup label="New misconception" items={revision.newMisconceptions} tone="amber" />
      <ChangeGroup label="What changed in these notes" items={revision.noteChanges} tone="neutral" />
    </section>
  )
}

// ── Flag treatment 1: the heading pill ───────────────────────────────────────

// Three flags, because the three states mean different things to a student:
// resolved = you've fixed this; watching = it happened once, don't let it settle;
// active/improving = a confirmed gap. A watched slip must NOT read as
// "missed in last session" — it may well be older than that, and calling one
// mistake a misconception is the kind of overstatement that makes a student
// distrust the whole page.
const FLAG: Record<MisconceptionState, { copy: string; dot: string; set: CSSProperties }> = {
  resolved: { copy: 'Solid last session', dot: T.a1, set: ORDINAL.green },
  watching: { copy: 'Slipped here once', dot: T.a3, set: ORDINAL.blue },
  improving: { copy: 'Getting this right lately', dot: T.a2, set: ORDINAL.amber },
  active: { copy: 'Missed more than once', dot: T.a2, set: ORDINAL.amber },
}

function StatusPill({ misconception }: { misconception: DashboardMisconception }) {
  const flag = FLAG[misconceptionState(misconception)]
  return (
    <span
      title={MISCONCEPTION_MEANING[misconceptionState(misconception)]}
      style={{ ...pill, ...flag.set, padding: '3px 10px', fontSize: 11.5, fontWeight: 600, verticalAlign: 'middle' }}
    >
      <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: flag.dot }} />
      {flag.copy}
    </span>
  )
}

// ── Flag treatment 3: the margin dot + popover ───────────────────────────────

function MarginFlag({ label, detail }: { label: string; detail: string }) {
  const [open, setOpen] = useState(false)
  return (
    <span style={{ position: 'absolute', left: -36, top: 6 }}>
      <button
        type="button"
        aria-label={`Flagged: ${detail}`}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: 11,
          height: 11,
          borderRadius: '50%',
          background: T.a2,
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          boxShadow: `0 0 0 4px ${T.a2Tint}, 0 0 0 5px ${T.a2Edge}`,
        }}
      />
      {open && (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            top: 20,
            left: -8,
            width: 270,
            zIndex: 5,
            display: 'block',
            background: T.card,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            padding: '11px 13px',
            boxShadow: SHADOW.popover,
          }}
        >
          <span
            style={{
              display: 'block',
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: '0.09em',
              textTransform: 'uppercase',
              // The popover is a card, not a tint → theme-aware ink.
              color: T.ink2,
              marginBottom: 5,
            }}
          >
            {label}
          </span>
          <span style={{ display: 'block', fontSize: 12.5, lineHeight: 1.55, color: T.ink }}>{detail}</span>
        </span>
      )}
    </span>
  )
}

// ── Flag treatment 2: the "Your attempt" callout ─────────────────────────────

function YourAttempt({
  step,
  sessionLabel,
  onAsk,
}: {
  step: NotebookStep
  sessionLabel: string
  onAsk: (question: string) => void
}) {
  const mistake = step.mistake
  if (!mistake) return null

  return (
    <div
      style={{
        background: T.a2Tint,
        border: `1px solid ${T.a2}`,
        borderRadius: 10,
        padding: '14px 16px',
        marginTop: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '0.09em',
          textTransform: 'uppercase',
          color: T.a2Deep,
        }}
      >
        <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: T.a2 }} />
        Your attempt{sessionLabel ? ` · ${sessionLabel}` : ''}
      </div>

      {/* The whole callout sits on the amber tint, which is light-only — every
          child sets the deep amber ink rather than inheriting the page colour,
          or the card turns into light-on-light in dark mode. */}
      {mistake.studentAttempt && (
        <div style={{ marginTop: 10, color: T.a2Deep }}>
          <MathText expr={mistake.studentAttempt} size={16} />
        </div>
      )}

      <p style={{ margin: '10px 0 0', fontSize: 13.5, lineHeight: 1.6, color: T.a2Deep }}>
        {mistake.whatWentWrong} {mistake.watchFor}
      </p>

      <button
        type="button"
        onClick={() => onAsk(`I got this wrong: ${mistake.whatWentWrong} Can you walk me through it?`)}
        className="cx-ask-link"
        style={{
          marginTop: 10,
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          color: T.a2Deep,
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        Ask Calyxa about this →
      </button>
    </div>
  )
}

// ── Steps ────────────────────────────────────────────────────────────────────

function StepList({
  steps,
  sessionLabel,
  onAsk,
}: {
  steps: NotebookStep[]
  sessionLabel: string
  onAsk: (q: string) => void
}) {
  return (
    <ol style={{ listStyle: 'none', margin: '18px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {steps.map((step, i) => {
        const flagged = step.mistake !== null
        return (
          <li key={i} style={{ display: 'flex', gap: 10, position: 'relative' }}>
            {flagged && (
              <MarginFlag
                label={`Flagged${sessionLabel ? ` · ${sessionLabel}` : ''}`}
                detail={step.mistake?.watchFor ?? ''}
              />
            )}
            <span
              aria-hidden="true"
              style={{
                width: 22,
                height: 22,
                flexShrink: 0,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11.5,
                fontWeight: 600,
                transform: 'translateY(4px)',
                background: flagged ? T.a2Tint : T.surface,
                border: `1.5px solid ${flagged ? T.a2 : T.borderStrong}`,
                color: flagged ? T.a2Deep : T.muted,
              }}
            >
              {i + 1}
            </span>

            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ margin: 0, fontSize: 16.5, lineHeight: 1.7 }}>{step.step}</p>

              {step.expression && (
                <p style={{ margin: '6px 0 0' }}>
                  <span
                    style={
                      flagged
                        ? {
                            background: T.a2Tint,
                            // Tint bg ⇒ deep text (see AnnotationMark): the tints
                            // are light-only, so this must not inherit.
                            color: T.a2Deep,
                            borderBottom: `3px solid ${T.a2}`,
                            borderRadius: '3px 3px 0 0',
                            padding: '1px 5px',
                          }
                        : undefined
                    }
                  >
                    <MathText expr={step.expression} size={16} />
                  </span>
                </p>
              )}

              {flagged && <YourAttempt step={step} sessionLabel={sessionLabel} onAsk={onAsk} />}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// ── Subsections + sections ───────────────────────────────────────────────────

function Subsection({
  block,
  misconceptionByCategory,
  sessionLabel,
  onAsk,
  hideHeading,
}: {
  block: NotebookSubsection
  misconceptionByCategory: Record<string, DashboardMisconception>
  sessionLabel: string
  onAsk: (q: string) => void
  /** True when the section title already says this, so the h3 would just echo it. */
  hideHeading?: boolean
}) {
  const misconception = block.category ? misconceptionByCategory[block.category] : undefined

  return (
    <div style={{ marginTop: hideHeading ? 14 : 26 }}>
      {hideHeading ? (
        // The heading is redundant, but a misconception pill attached to this
        // block still has to surface somewhere.
        misconception && (
          <div style={{ marginBottom: 12 }}>
            <StatusPill misconception={misconception} />
          </div>
        )
      ) : (
        <h3 style={{ fontSize: 19, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {block.heading}
          {misconception && <StatusPill misconception={misconception} />}
        </h3>
      )}

      {block.body.map((paragraph, i) => (
        <p key={i} style={{ margin: '14px 0 0', fontSize: 16.5, lineHeight: 1.75 }}>
          {paragraph}
        </p>
      ))}

      {block.expression && <MathBubble expr={block.expression} />}

      {block.callout && (
        <blockquote style={{ display: 'flex', gap: 14, margin: '18px 0 0' }}>
          <span aria-hidden="true" style={{ width: 3, borderRadius: 3, background: T.accent, flexShrink: 0 }} />
          <span style={{ fontStyle: 'italic', fontSize: 16.5, lineHeight: 1.7, color: T.ink }}>
            {block.callout}
          </span>
        </blockquote>
      )}

      {block.steps.length > 0 && (
        <StepList steps={block.steps} sessionLabel={sessionLabel} onAsk={onAsk} />
      )}
    </div>
  )
}

function Section({
  section,
  misconceptionByCategory,
  sessionLabel,
  onAsk,
}: {
  section: NotebookSection
  misconceptionByCategory: Record<string, DashboardMisconception>
  sessionLabel: string
  onAsk: (q: string) => void
}) {
  const Glyph = SECTION_ICON[section.icon] ?? PencilIcon
  return (
    <section>
      <hr style={{ border: 'none', borderTop: `1px solid ${T.border}`, margin: '36px 0' }} />
      <h2
        style={{
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: '-0.015em',
          margin: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 11,
        }}
      >
        <Glyph size={22} style={{ color: T.accentInk, flexShrink: 0 }} />
        {section.title}
      </h2>

      {section.subsections.map((block, i) => (
        <Subsection
          key={i}
          block={block}
          misconceptionByCategory={misconceptionByCategory}
          sessionLabel={sessionLabel}
          onAsk={onAsk}
          // A lone block whose heading restates the section title reads as a
          // stutter; drop the echo rather than print the same words twice.
          hideHeading={
            section.subsections.length === 1 &&
            block.heading.trim().toLowerCase() === section.title.trim().toLowerCase()
          }
        />
      ))}
    </section>
  )
}

// ── Extension-style annotations, from real records ───────────────────────────

// The design handoff asks for the extension's annotation vocabulary in the notes
// (ADR-022/ADR-029, palette A "Meadow"): a label pill in the ordinal colour, a
// why-note card beneath it, and a leading dot — never a naked shape.
//
// These are driven by ACTUAL tutor annotations off `session_interactions`
// (ADR-055), not by the notebook. That matters: a notebook only carries a
// step-level mistake when the session produced a misconception, so a student who
// worked cleanly gets no flags at all — while the tutor may still have marked up
// every step of their work. Rendering the real marks means the annotation layer
// shows up whenever the tutor actually drew one.
//
// Ordinals cycle 1→2→3 per mark so adjacent labels stay distinguishable; the
// colour is presentational here (the extension assigns meaning by ordinal within
// a single turn, which is the same thing).
const ORDINALS = [
  { stroke: T.a1, tint: T.a1Tint, edge: T.a1Edge, deep: T.a1Deep },
  { stroke: T.a3, tint: T.a3Tint, edge: T.a3Edge, deep: T.a3Deep },
  { stroke: T.a2, tint: T.a2Tint, edge: T.a2Edge, deep: T.a2Deep },
] as const

function AnnotationMark({
  label,
  note,
  target,
  ordinal,
}: {
  label: string | null
  note: string | null
  target: string | null
  ordinal: number
}) {
  const o = ORDINALS[ordinal % ORDINALS.length]

  return (
    <li style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
      <span
        aria-hidden="true"
        style={{ width: 7, height: 7, borderRadius: '50%', background: o.stroke, marginTop: 9, flexShrink: 0 }}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {label && (
            <span
              style={{
                ...pill,
                background: o.tint,
                border: `1px solid ${o.edge}`,
                color: o.deep,
                padding: '4px 11px',
                fontSize: 12,
                fontWeight: 600,
                boxShadow: SHADOW.pill,
              }}
            >
              {label}
            </span>
          )}
          {target && (
            <span
              style={{
                background: o.tint,
                // The annotation tints have no dark-mode variant in theme.css —
                // they are always the light wash. So a tint background MUST set
                // its `-deep` text colour explicitly (the pairing ADR-029 AA-
                // verified); inheriting the page colour renders light-on-light and
                // the span disappears entirely in dark mode.
                color: o.deep,
                borderBottom: `2px solid ${o.stroke}`,
                borderRadius: '3px 3px 0 0',
                padding: '1px 5px',
              }}
            >
              <MathText expr={target} size={15} />
            </span>
          )}
        </div>
        {note && (
          <div
            style={{
              marginTop: 8,
              background: T.card,
              border: `1px solid ${T.border}`,
              borderRadius: 10,
              padding: '10px 12px',
              fontSize: 12.5,
              lineHeight: 1.55,
              boxShadow: SHADOW.note,
            }}
          >
            {note}
          </div>
        )}
      </div>
    </li>
  )
}

function AnnotationsSection({
  snapshots,
  onAsk,
}: {
  snapshots: StudioNotes['snapshots']
  onAsk: (q: string) => void
}) {
  if (snapshots.length === 0) return null

  return (
    <section>
      <hr style={{ border: 'none', borderTop: `1px solid ${T.border}`, margin: '36px 0' }} />
      <h2
        style={{
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: '-0.015em',
          margin: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 11,
        }}
      >
        <PencilIcon size={22} style={{ color: T.accentInk, flexShrink: 0 }} />
        Marked up in your sessions
      </h2>
      <p style={{ margin: '14px 0 0', fontSize: 16.5, lineHeight: 1.75, color: T.muted }}>
        The steps Calyxa pointed at while you worked, kept exactly as they were drawn.
      </p>

      {snapshots.map((snapshot) => (
        <div key={snapshot.id} style={{ marginTop: 26 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 10,
              flexWrap: 'wrap',
              paddingBottom: 12,
              borderBottom: `1px solid ${T.border}`,
            }}
          >
            <span style={{ ...eyebrowStyle, color: T.muted }}>
              {shortDate(snapshot.createdAt)} · your work
            </span>
            {snapshot.studentTranscript && (
              <span style={{ color: T.ink }}>
                <MathText expr={snapshot.studentTranscript} size={16} />
              </span>
            )}
          </div>

          <ul style={{ listStyle: 'none', margin: '14px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {snapshot.annotations.map((a, i) => (
              <AnnotationMark
                key={a.id}
                label={a.label}
                note={a.note}
                target={a.targetText}
                ordinal={i}
              />
            ))}
          </ul>

          {snapshot.misconception && (
            <button
              type="button"
              onClick={() => onAsk(`On my ${shortDate(snapshot.createdAt)} work you flagged: ${snapshot.misconception}. Can you go over it?`)}
              style={{
                marginTop: 12,
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                // On the card, not on a tint → theme-aware ink.
                color: T.ink2,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Ask Calyxa about this →
            </button>
          )}
        </div>
      ))}
    </section>
  )
}

// ── The study kit's own notes ───────────────────────────────────────────────

// The condensed bullets the study-kit generator writes (ADR-049's `notes`
// artifact) — distinct from the notebook, which is the running document.
//
// These used to be visible only in the kit viewer at /kits/[key]. That route now
// forwards into this view, so without a home here they would simply stop being
// reachable. They are the session's own recap, so they sit after the notebook's
// sections and before the raw session marks.
function KitNotesSection({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null

  return (
    <section>
      <hr style={{ border: 'none', borderTop: `1px solid ${T.border}`, margin: '36px 0' }} />
      <h2
        style={{
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: '-0.015em',
          margin: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 11,
        }}
      >
        <ChecklistIcon size={22} style={{ color: T.accentInk, flexShrink: 0 }} />
        Recap from your study kit
      </h2>
      <p style={{ margin: '14px 0 0', fontSize: 16.5, lineHeight: 1.75, color: T.muted }}>
        The short version Calyxa wrote up when it built your practice material.
      </p>

      <ul style={{ listStyle: 'none', margin: '18px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {notes.map((note, i) => (
          <li key={i} style={{ display: 'flex', gap: 12 }}>
            <span
              aria-hidden="true"
              style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: T.borderStrong,
                marginTop: 11,
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 16.5, lineHeight: 1.7 }}>{note}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ── The document ─────────────────────────────────────────────────────────────

function Placeholder({ title }: { title: string }) {
  return (
    <div style={{ textAlign: 'center', color: T.muted, padding: '60px 0' }}>
      <p style={{ fontSize: 16.5, lineHeight: 1.7, margin: 0 }}>
        No notebook for <strong style={{ color: T.ink }}>{title}</strong> yet.
      </p>
      <p style={{ fontSize: 14.5, lineHeight: 1.7, margin: '10px 0 0' }}>
        Calyxa writes one after your first tutoring session on a concept, and revises it after every session
        that follows.
      </p>
    </div>
  )
}

export function NotesDocument({
  data,
  onAsk,
}: {
  data: StudioNotes
  onAsk: (question: string) => void
}) {
  const notebook = data.notebook
  const sessionLabel = data.lastSession ? `${shortDate(data.lastSession.startedAt)} session` : ''

  return (
    <article style={{ padding: '48px 56px 80px' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <CalyxaMark style={{ width: 30, height: 30, flexShrink: 0 }} />
        <h2
          style={{
            fontSize: 40,
            lineHeight: 1.2,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            margin: 0,
            textAlign: 'center',
          }}
        >
          {data.title}
        </h2>
      </header>

      {!notebook ? (
        // No notebook yet, but the tutor may still have marked up real work on
        // this concept — show that rather than only the placeholder.
        <>
          <Placeholder title={data.title} />
          <KitNotesSection notes={data.notes} />
          <AnnotationsSection snapshots={data.snapshots} onAsk={onAsk} />
        </>
      ) : (
        <>
          {/* The overview always renders — it is the notebook's opening frame, and
              a document that starts straight into Key Points reads as a fragment.
              A notebook with no summary yet says so rather than vanishing. */}
          <>
              <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em', margin: '44px 0 16px' }}>
                Brief Overview
              </h2>
              <p style={{ margin: 0, fontSize: 16.5, lineHeight: 1.75 }}>
                {notebook.summary || (
                  <span style={{ color: T.muted }}>
                    Calyxa hasn’t written an overview for this concept yet — it fills in after your next
                    session on it.
                  </span>
                )}
                {data.lastSession && (
                  <>
                    {' '}
                    Last revised after your{' '}
                    <Link href={`/sessions/${data.lastSession.id}`}>
                      {shortDate(data.lastSession.startedAt)} tutoring session
                      {data.lastSession.minutes !== null ? ` (${data.lastSession.minutes} min)` : ''}
                    </Link>
                    .
                  </>
                )}
              </p>
              <RevisionCard revision={notebook.revision} sessionDate={shortDate(data.lastSession?.startedAt ?? null)} />
          </>

          {notebook.keyPoints.length > 0 && (
            <>
              <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em', margin: '36px 0 16px' }}>
                Key Points
              </h2>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {notebook.keyPoints.map((point, i) => (
                  <li key={i} style={{ display: 'flex', gap: 12 }}>
                    <span
                      aria-hidden="true"
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: '50%',
                        background: T.borderStrong,
                        marginTop: 11,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontSize: 16.5, lineHeight: 1.7 }}>{point}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {notebook.sections.map((section, i) => (
            <Section
              key={i}
              section={section}
              misconceptionByCategory={data.misconceptionByCategory}
              sessionLabel={sessionLabel}
              onAsk={onAsk}
            />
          ))}

          <KitNotesSection notes={data.notes} />

          <AnnotationsSection snapshots={data.snapshots} onAsk={onAsk} />
        </>
      )}
    </article>
  )
}

/** Exposed so the Ask panel can reuse the document's transition timing. */
export const NOTES_MOTION = MOTION

export type NotesRenderable = ReactNode
