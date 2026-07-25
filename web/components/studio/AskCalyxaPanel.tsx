'use client'

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import Link from 'next/link'
import type { DashboardMisconception } from '@/lib/learning/dashboard-read'
import type { KitFlashcard, KitProblem } from '@/components/dashboard/premium/kit-read'
import { PanelQuiz } from './PanelQuiz'
import { PanelFlashcards } from './PanelFlashcards'
import {
  byUrgency,
  countMisconceptions,
  misconceptionState,
  MISCONCEPTION_LABEL,
  MISCONCEPTION_MEANING,
  type MisconceptionState,
} from './misconception'
import { T, ORDINAL, SHADOW, MOTION, pill } from './tokens'
import { ArrowUpIcon, CardsIcon, ChecklistIcon, ChevronLeft, ChevronRight, ExpandIcon, MicIcon, PaperclipIcon, TargetIcon } from './icons'

// Screen 2b — the Ask Calyxa panel beside the notes. Three states, as the design
// specifies: `home` (the three study cards + the greeting + the composer),
// `misc` (the tracked misconception list) and `chat`.
//
// SHELL SCOPE: the study cards and the misconception list are wired to real
// records, but the conversation itself is not — there is no notes-grounded chat
// endpoint yet (the tutor lives in the extension). Rather than fake a reply, a
// send appends the student's real message and Calyxa answers honestly that this
// surface isn't connected. "Ask Calyxa chat backend" is on the not-yet-built
// list; when it lands, only `reply()` below changes.

// Quiz and flashcards are panel STATES, not routes. They used to be separate nav
// tabs on their own full-screen pages, which meant leaving the notes to practise
// the notes. Now they open in place, beside the document they came from.
export type PanelState = 'home' | 'misc' | 'chat' | 'quiz' | 'flash'

type Message = { id: number; role: 'student' | 'calyxa'; text: string }

const NOT_CONNECTED =
  "I can't answer here yet — this panel is the shell, and my tutoring still runs inside the Calyxa " +
  'extension while you work. Open the extension on the problem you\'re stuck on and I\'ll walk you ' +
  'through this exact step.'

const STATUS_SET: Record<MisconceptionState, CSSProperties> = {
  active: ORDINAL.danger,
  improving: ORDINAL.amber,
  // Watching gets the blue ordinal — visibly not a red/amber problem, because a
  // slip seen once isn't one yet.
  watching: ORDINAL.blue,
  resolved: ORDINAL.green,
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── Cards ────────────────────────────────────────────────────────────────────

const cardBase: CSSProperties = {
  position: 'relative',
  background: T.card,
  border: `1px solid ${T.border}`,
  borderRadius: 13,
  color: T.ink,
  textDecoration: 'none',
  display: 'block',
  // Grid children default to min-content width; without this the Misconceptions
  // card's title + count badge push the two-up row past the panel.
  minWidth: 0,
  transition: `background ${MOTION.fast} ${MOTION.ease}`,
}

function StudyCard({
  href,
  onClick,
  icon,
  title,
  subtitle,
  right,
  wide,
  disabledNote,
}: {
  href?: string
  onClick?: () => void
  icon: React.ReactNode
  title: string
  subtitle: string
  right?: React.ReactNode
  wide?: boolean
  disabledNote?: string
}) {
  const inner = (
    <>
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {icon}
          <span
            style={{
              fontSize: wide ? 20 : 18,
              fontWeight: 700,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {title}
          </span>
        </span>
        {right}
      </span>
      <span style={{ display: 'block', fontSize: 14, color: T.muted, marginTop: 6 }}>{subtitle}</span>
    </>
  )

  const style: CSSProperties = {
    ...cardBase,
    padding: wide ? '24px 26px' : 22,
    boxShadow: wide ? SHADOW.card : undefined,
    // Full width, NOT the handoff's centred 80%: the wide card sits directly
    // above a two-column row, so anything narrower than the column pair reads as
    // a pyramid. At 100% the three cards square off into a rectangle.
    width: '100%',
    opacity: disabledNote ? 0.55 : 1,
    cursor: disabledNote ? 'not-allowed' : 'pointer',
  }

  if (disabledNote) {
    return (
      <span style={style} title={disabledNote} aria-disabled="true">
        {inner}
      </span>
    )
  }
  if (href) {
    return (
      <Link href={href} className="cx-row" style={style}>
        {inner}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} className="cx-row" style={{ ...style, textAlign: 'left', width: '100%' }}>
      {inner}
    </button>
  )
}

// ── Composer ─────────────────────────────────────────────────────────────────

function Composer({
  placeholder,
  value,
  onChange,
  onSend,
}: {
  placeholder: string
  value: string
  onChange: (v: string) => void
  onSend: () => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        borderRadius: 999,
        background: T.card,
        border: `1px solid color-mix(in srgb, var(--color-accent-glow) 60%, transparent)`,
        padding: '8px 10px 8px 20px',
        boxShadow: SHADOW.composer,
        marginTop: 14,
      }}
    >
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            onSend()
          }
        }}
        placeholder={placeholder}
        aria-label="Ask Calyxa"
        style={{
          flex: 1,
          minWidth: 0,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: T.ink,
          fontSize: 15.5,
          fontFamily: 'inherit',
        }}
      />
      <button
        type="button"
        disabled
        aria-label="Attach a file (not available yet)"
        title="Attachments aren't built yet"
        style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', background: 'transparent', color: T.muted, opacity: 0.5, cursor: 'not-allowed' }}
      >
        <PaperclipIcon size={17} />
      </button>
      <button
        type="button"
        disabled
        aria-label="Speak your question (not available yet)"
        title="Voice on the web isn't built yet — it runs in the extension"
        style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', background: 'transparent', color: T.muted, opacity: 0.5, cursor: 'not-allowed' }}
      >
        <MicIcon size={17} />
      </button>
      <button
        type="button"
        onClick={onSend}
        aria-label="Send"
        style={{
          width: 42,
          height: 42,
          flexShrink: 0,
          borderRadius: '50%',
          border: 'none',
          background: T.accent,
          color: T.onAccent,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ArrowUpIcon size={18} />
      </button>
    </div>
  )
}

// ── Panel ────────────────────────────────────────────────────────────────────

export function AskCalyxaPanel({
  conceptKey,
  title,
  problems,
  flashcards,
  misconceptions,
  state,
  onState,
  pendingQuestion,
  onPendingConsumed,
}: {
  conceptKey: string
  title: string
  /** The generated study material, passed in full — the quiz and flashcards run
   *  inside this panel now, so it needs the content and not just the counts. */
  problems: KitProblem[]
  flashcards: KitFlashcard[]
  misconceptions: DashboardMisconception[]
  state: PanelState
  onState: (s: PanelState) => void
  /** A question raised from the notes column ("Ask Calyxa about this"). */
  pendingQuestion: string | null
  onPendingConsumed: () => void
}) {
  const quizCount = problems.length
  const cardCount = flashcards.length

  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [thinking, setThinking] = useState(false)
  const nextId = useRef(1)
  const listEnd = useRef<HTMLDivElement>(null)

  // Counts split by what the student should DO about each: `confirmed` is a real
  // gap, `watching` is a one-off Calyxa has noticed but not yet called a pattern,
  // `improving` is confirmed-but-recovering, `resolved` is done.
  const counts = countMisconceptions(misconceptions)
  const openCount = counts.confirmed + counts.improving
  const rows = [...misconceptions].sort(byUrgency)

  function ask(text: string) {
    const question = text.trim()
    if (!question) return
    setMessages((prev) => [
      ...prev,
      { id: nextId.current++, role: 'student', text: question },
    ])
    setDraft('')
    onState('chat')
    setThinking(true)
  }

  // The honest stand-in for a real notes-grounded call. The delay exists so the
  // thinking indicator is visible rather than flashing; when the endpoint lands
  // this whole effect becomes the fetch.
  useEffect(() => {
    if (!thinking) return
    const timer = setTimeout(() => {
      setMessages((prev) => [...prev, { id: nextId.current++, role: 'calyxa', text: NOT_CONNECTED }])
      setThinking(false)
    }, 500)
    return () => clearTimeout(timer)
  }, [thinking])

  // A question raised from the notes column ("Ask Calyxa about this") arrives as
  // a prop; consume it once, then clear it upstream so it can't replay.
  useEffect(() => {
    const question = pendingQuestion?.trim()
    if (!question) return
    setMessages((prev) => [...prev, { id: nextId.current++, role: 'student', text: question }])
    setDraft('')
    onState('chat')
    setThinking(true)
    onPendingConsumed()
  }, [pendingQuestion, onState, onPendingConsumed])

  useEffect(() => {
    listEnd.current?.scrollIntoView({ block: 'end' })
  }, [messages, thinking])

  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', padding: '28px 30px 30px', overflowY: 'auto' }}>
      <button
        type="button"
        disabled
        aria-label="Expand the panel (not available yet)"
        title="Expanding the panel isn't built yet"
        style={{
          position: 'absolute',
          top: 14,
          left: 14,
          width: 34,
          height: 34,
          borderRadius: 9,
          background: T.card,
          border: `1px solid ${T.border}`,
          color: T.muted,
          opacity: 0.55,
          cursor: 'not-allowed',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ExpandIcon size={15} />
      </button>

      {state === 'home' ? (
        // The three study cards form a rectangle at the top — Misconceptions
        // spanning the full width, Quizzes and Flashcards splitting the row below
        // it — with the composer under the whole block. Misconceptions leads
        // because "what did I get wrong" is the question this panel exists to
        // answer.
        <>
          {/* Spacer above + below centres the card block in the panel; the
              composer then sits hard against the bottom edge, where a chat input
              belongs and where the chat state already puts it. */}
          <div style={{ flex: 1, minHeight: 24 }} />

          <div>
            <StudyCard
              wide
              onClick={() => onState('misc')}
              icon={<TargetIcon size={19} style={{ color: T.a2Deep }} />}
              title="Misconceptions"
              subtitle={
                // Name the two kinds separately rather than summing them — "3"
                // meaning "1 real gap and 2 maybes" would overstate the problem.
                [
                  openCount > 0 ? `${openCount} tracked` : null,
                  counts.watching > 0 ? `${counts.watching} watching` : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'Ask about what went wrong'
              }
              right={
                <span
                  style={{
                    ...pill,
                    ...(openCount > 0
                      ? ORDINAL.amber
                      : counts.watching > 0
                        ? ORDINAL.blue
                        : ORDINAL.green),
                    padding: '2px 9px',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {openCount > 0 ? openCount : counts.watching}
                </span>
              }
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
            <StudyCard
              onClick={quizCount > 0 ? () => onState('quiz') : undefined}
              disabledNote={quizCount > 0 ? undefined : 'No practice problems generated for this concept yet'}
              icon={<ChecklistIcon size={17} style={{ color: T.accentInk }} />}
              title="Quizzes"
              subtitle={quizCount > 0 ? `${quizCount} questions` : 'Test your knowledge'}
            />
            <StudyCard
              onClick={cardCount > 0 ? () => onState('flash') : undefined}
              disabledNote={cardCount > 0 ? undefined : 'No flashcards generated for this concept yet'}
              icon={<CardsIcon size={17} style={{ color: T.a3Deep }} />}
              title="Flashcards"
              subtitle={cardCount > 0 ? `${cardCount} cards` : 'Study with active recall'}
            />
          </div>

          <div style={{ flex: 1, minHeight: 24 }} />

          <Composer
            placeholder="Type a question here, or ask about a misconception…"
            value={draft}
            onChange={setDraft}
            onSend={() => ask(draft)}
          />
        </>
      ) : state === 'quiz' ? (
        <div style={{ marginTop: 30 }}>
          <PanelQuiz
            conceptKey={conceptKey}
            title={title}
            problems={problems}
            onBack={() => onState('home')}
          />
        </div>
      ) : state === 'flash' ? (
        <div style={{ marginTop: 30 }}>
          <PanelFlashcards title={title} cards={flashcards} onBack={() => onState('home')} />
        </div>
      ) : state === 'misc' ? (
        <>
          <button
            type="button"
            onClick={() => onState('home')}
            style={{
              marginTop: 30,
              alignSelf: 'flex-start',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: T.muted,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <ChevronLeft size={14} /> Back
          </button>

          <h3 style={{ fontSize: 16, fontWeight: 700, margin: '14px 0 4px' }}>Your tracked misconceptions</h3>
          <p style={{ fontSize: 13, color: T.muted, margin: '0 0 14px', lineHeight: 1.55 }}>
            {misconceptions.length === 0 ? (
              // Be specific about WHY it's empty — "nothing tracked" alone reads
              // as a broken feature.
              <>Nothing tracked on this concept yet. Calyxa logs a slip the first time it sees one.</>
            ) : openCount === 0 && counts.watching > 0 ? (
              <>
                Nothing confirmed yet — {counts.watching === 1 ? 'this one has' : 'these have'} only happened
                once. Tap to go over {counts.watching === 1 ? 'it' : 'them'} before {counts.watching === 1 ? 'it' : 'they'} become a habit.
              </>
            ) : openCount === 0 ? (
              <>All resolved. Tap one to go over it again.</>
            ) : (
              <>Tap one to ask about it.</>
            )}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map((m) => {
              const state = misconceptionState(m)
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => ask(`Can you explain my "${m.title}" mistake and how to avoid it?`)}
                  className="cx-row"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '12px 14px',
                    border: `1px solid ${T.border}`,
                    borderRadius: 10,
                    background: 'transparent',
                    color: T.ink,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>{m.title}</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: T.muted, marginTop: 2 }}>
                      seen {m.occurrenceCount}× · last {shortDate(m.lastSeenAt)}
                    </span>
                  </span>
                  <span
                    // The label alone doesn't tell a student what "Watching"
                    // means; the title carries the plain-English definition.
                    title={MISCONCEPTION_MEANING[state]}
                    style={{
                      ...pill,
                      ...STATUS_SET[state],
                      padding: '3px 9px',
                      fontSize: 10.5,
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {MISCONCEPTION_LABEL[state]}
                  </span>
                  <ChevronRight size={14} style={{ color: T.muted, flexShrink: 0 }} />
                </button>
              )
            })}
          </div>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => onState('home')}
            style={{
              marginTop: 30,
              alignSelf: 'flex-start',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: T.muted,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <ChevronLeft size={14} /> Back
          </button>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
            {messages.map((m) => (
              <div
                key={m.id}
                style={{
                  alignSelf: m.role === 'student' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  padding: '10px 13px',
                  fontSize: 13,
                  lineHeight: 1.55,
                  borderRadius: m.role === 'student' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                  background: m.role === 'student' ? T.accent : T.surface,
                  color: m.role === 'student' ? T.onAccent : T.ink,
                }}
              >
                {m.text}
              </div>
            ))}
            {thinking && (
              <div style={{ fontStyle: 'italic', color: T.muted, fontSize: 13 }}>Calyxa is thinking…</div>
            )}
            <div ref={listEnd} />
          </div>

          <Composer
            placeholder="Reply to Calyxa…"
            value={draft}
            onChange={setDraft}
            onSend={() => ask(draft)}
          />
        </>
      )}

    </div>
  )
}
