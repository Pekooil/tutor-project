'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type { CSSProperties } from 'react'
import type { NotebookData, NbConcept, NbChapter } from '../notebook-read'
import { C, glassCard, sheen, eyebrow, pct, STATE_STYLE } from '../theme'
import { Logomark } from '../primitives'
import { ConceptPage } from './ConceptPage'
import { TutorInsights } from './TutorInsights'

// The Personal Notebook shell (redesign) — the center of the product. Two panes:
// a persistent left sidebar (Subject switcher → collapsible Chapters → Concepts)
// and a single continuous scrolling document of every concept page. Selecting a
// concept smooth-scrolls to its section (no navigation); a scroll-spy keeps the
// sidebar in sync. Client component: it owns the scroll-spy + chapter collapse;
// all data is the RLS-scoped, server-loaded NotebookData passed as props.

function conceptDotColor(concept: NbConcept): string {
  if (!concept.node) return 'rgba(28,28,26,.18)'
  return STATE_STYLE[concept.node.state].bar
}

const SCROLL_OFFSET = 150

export function NotebookShell({ data }: { data: NotebookData }) {
  const { active, subjects, insights, lastSession } = data
  const now = useMemo(() => new Date(), [])

  // All concepts of the subject in document order (chapters flattened).
  const orderedKeys = useMemo(
    () => active.chapters.flatMap((ch) => ch.concepts.map((c) => c.conceptKey)),
    [active.chapters]
  )

  const [activeKey, setActiveKey] = useState<string | null>(orderedKeys[0] ?? null)

  // Chapters start collapsed only when nothing in them has been studied — so a
  // returning student sees their worked chapters open, the rest tucked away.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const set = new Set<string>()
    for (const ch of active.chapters) {
      if (!ch.concepts.some((c) => c.hasContent)) set.add(ch.key)
    }
    return set
  })

  const sidebarItemRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  // Scroll-spy: the active concept is the last section whose top has passed the
  // offset line. rAF-throttled so scroll stays smooth.
  useEffect(() => {
    let raf = 0
    const compute = () => {
      raf = 0
      const sections = Array.from(document.querySelectorAll<HTMLElement>('section[data-concept]'))
      let current: string | null = sections[0]?.dataset.concept ?? null
      for (const el of sections) {
        if (el.getBoundingClientRect().top <= SCROLL_OFFSET) current = el.dataset.concept ?? current
        else break
      }
      setActiveKey((prev) => (prev === current ? prev : current))
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    compute()
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [orderedKeys])

  // Keep the active concept visible in the sidebar as the reader scrolls.
  useEffect(() => {
    if (!activeKey) return
    sidebarItemRefs.current.get(activeKey)?.scrollIntoView({ block: 'nearest' })
  }, [activeKey])

  const scrollToConcept = useCallback((key: string) => {
    const el = document.getElementById(`concept-${key}`)
    if (!el) return
    setActiveKey(key)
    // Expand a collapsed chapter isn't needed — the section exists regardless;
    // the sidebar item may be hidden, but scrolling still lands on the page.
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const toggleChapter = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  return (
    <div className="nb-breakout">
      <div className="nb-grid">
        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <aside className="nb-aside" aria-label="Notebook navigation">
          <SubjectSwitcher subjects={subjects} activeColor={active.color} />

          <div style={{ height: 1, background: C.hair, margin: '14px 4px 12px' }} />

          <button
            onClick={() => document.getElementById('insights')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="cx-hover-soft"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              width: '100%',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              padding: '8px 10px',
              borderRadius: 10,
              fontSize: 12.5,
              fontWeight: 600,
              color: C.muted,
              marginBottom: 4,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="5.2" r="2.4" />
              <path d="M3.4 12.8 C4 10.6 5.8 9.4 8 9.4 C10.2 9.4 12 10.6 12.6 12.8" />
            </svg>
            Tutor insights
          </button>

          <nav aria-label="Chapters" style={{ marginTop: 4 }}>
            {active.chapters.map((ch) => (
              <ChapterGroup
                key={ch.key}
                chapter={ch}
                collapsed={collapsed.has(ch.key)}
                onToggle={() => toggleChapter(ch.key)}
                activeKey={activeKey}
                onSelect={scrollToConcept}
                itemRefs={sidebarItemRefs.current}
              />
            ))}
          </nav>
        </aside>

        {/* ── Document ────────────────────────────────────────────────────── */}
        <div className="nb-doc">
          <SubjectHeader data={data} lastSession={lastSession} />
          <TutorInsights insights={insights} />

          {active.chapters.map((ch) => (
            <div key={ch.key} style={{ marginBottom: 4 }}>
              <div id={`chapter-${ch.key}`} className="nb-anchor" style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '12px 2px 14px' }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '.02em', color: active.color }}>{ch.label}</span>
                <span style={{ flex: 1, height: 1, background: C.hair }} />
                <span style={{ fontSize: 11.5, color: C.faint }}>
                  {ch.concepts.filter((c) => c.hasContent).length}/{ch.concepts.length}
                </span>
              </div>
              {ch.concepts.map((concept) => (
                <ConceptPage key={concept.conceptKey} concept={concept} now={now} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Subject switcher (the six notebooks) ─────────────────────────────────────

function SubjectSwitcher({
  subjects,
  activeColor,
}: {
  subjects: NotebookData['subjects']
  activeColor: string
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 6px 12px' }}>
        <Logomark size={17} id="cxgNbSide" />
        <span style={{ ...eyebrow, color: C.muted }}>Your notebooks</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {subjects.map((s) => {
          const p = s.practiced > 0 ? pct(s.averageMastery) : 0
          const itemStyle: CSSProperties = {
            display: 'block',
            textDecoration: 'none',
            padding: '9px 11px',
            borderRadius: 12,
            background: s.active ? 'rgba(134,239,172,.24)' : 'transparent',
            border: s.active ? '1px solid rgba(134,239,172,.5)' : '1px solid transparent',
          }
          return (
            <Link key={s.key} href={`/notebook/${s.key}`} className={s.active ? undefined : 'cx-hover-soft'} style={itemStyle}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: s.practiced > 0 ? 7 : 0 }}>
                <span style={{ flex: 'none', width: 9, height: 9, borderRadius: 3, background: s.color }} />
                <span style={{ fontSize: 13, fontWeight: s.active ? 600 : 500, color: s.active ? C.greenDeep : C.ink, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {s.label}
                </span>
                {s.practiced > 0 && <span style={{ flex: 'none', fontSize: 11, fontWeight: 600, color: C.muted }}>{p}%</span>}
              </span>
              {s.practiced > 0 && (
                <span style={{ display: 'block', height: 4, borderRadius: 99, background: 'rgba(28,28,26,.06)', overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: 4, borderRadius: 99, width: `${p}%`, background: s.active ? activeColor : 'rgba(28,28,26,.22)' }} />
                </span>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}

// ── Chapter group in the sidebar ─────────────────────────────────────────────

function ChapterGroup({
  chapter,
  collapsed,
  onToggle,
  activeKey,
  onSelect,
  itemRefs,
}: {
  chapter: NbChapter
  collapsed: boolean
  onToggle: () => void
  activeKey: string | null
  onSelect: (key: string) => void
  itemRefs: Map<string, HTMLButtonElement>
}) {
  const studied = chapter.concepts.filter((c) => c.hasContent).length
  return (
    <div style={{ marginBottom: 2 }}>
      <button
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="cx-hover-soft"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          padding: '7px 8px',
          borderRadius: 9,
          textAlign: 'left',
        }}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 12 12"
          fill="none"
          stroke={C.faint}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flex: 'none', transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform .18s' }}
        >
          <path d="M3 4.5 L6 7.5 L9 4.5" />
        </svg>
        <span style={{ fontSize: 12, fontWeight: 600, color: C.ink, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {chapter.label}
        </span>
        <span style={{ flex: 'none', fontSize: 10.5, color: C.faint }}>{studied}/{chapter.concepts.length}</span>
      </button>

      {!collapsed && (
        <div style={{ marginLeft: 10, paddingLeft: 9, borderLeft: `1px solid ${C.hair}`, display: 'flex', flexDirection: 'column', gap: 1, marginTop: 2, marginBottom: 4 }}>
          {chapter.concepts.map((c) => {
            const isActive = c.conceptKey === activeKey
            return (
              <button
                key={c.conceptKey}
                ref={(el) => {
                  if (el) itemRefs.set(c.conceptKey, el)
                  else itemRefs.delete(c.conceptKey)
                }}
                onClick={() => onSelect(c.conceptKey)}
                aria-current={isActive ? 'true' : undefined}
                className={isActive ? undefined : 'cx-hover-soft'}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  padding: '6px 9px',
                  borderRadius: 8,
                  background: isActive ? 'rgba(134,239,172,.28)' : 'transparent',
                }}
              >
                <span style={{ flex: 'none', width: 7, height: 7, borderRadius: 99, background: conceptDotColor(c), opacity: c.hasContent ? 1 : 0.6 }} />
                <span
                  style={{
                    fontSize: 12.5,
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? C.greenDeep : c.hasContent ? C.ink : C.faint,
                    flex: 1,
                    minWidth: 0,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {c.title}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Subject header (the notebook cover) ──────────────────────────────────────

function SubjectHeader({ data, lastSession }: { data: NotebookData; lastSession: NotebookData['lastSession'] }) {
  const { active } = data
  const counts = active.stateCounts
  const chips = [
    { label: 'Mastered', n: counts.mastered, color: '#166534' },
    { label: 'Learning', n: counts.learning, color: '#2563eb' },
    { label: 'Weak', n: counts.weak, color: '#92400e' },
    { label: 'Forgotten', n: counts.forgotten, color: '#b91c1c' },
  ].filter((c) => c.n > 0)

  return (
    <header style={{ marginBottom: 22, ...({ animation: 'cxPop .5s cubic-bezier(.3,1.4,.4,1) both' } as CSSProperties) }}>
      <div style={{ ...glassCard, padding: '22px 24px', overflow: 'hidden' }}>
        <span style={sheen} />
        {/* subtle glow in the subject color */}
        <span style={{ position: 'absolute', top: -50, right: -30, width: 220, height: 220, borderRadius: 99, background: `radial-gradient(closest-side, ${active.color}22, transparent)`, pointerEvents: 'none' }} />
        <div style={{ position: 'relative' }}>
          <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase', color: active.color }}>
            Notebook
          </p>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: 30, lineHeight: '36px', fontWeight: 600, letterSpacing: '-.02em' }}>
              {active.label}
            </h1>
            {lastSession && (
              <Link
                href={lastSession.kitHref ?? '/sessions'}
                className="cx-hover-pill"
                style={{ fontSize: 12.5, fontWeight: 600, color: C.greenDeep, background: C.mintPill, borderRadius: 99, padding: '8px 15px' }}
              >
                Continue last session &rarr;
              </Link>
            )}
          </div>
          <p style={{ margin: '9px 0 0', fontSize: 13.5, color: C.muted }}>
            {active.practiced > 0
              ? `${active.practiced} of ${active.total} concepts practiced · ${pct(active.averageMastery)}% average mastery`
              : `${active.total} concepts · start a session on this subject and your notebook fills in`}
            {active.activeMisconceptions > 0 && ` · ${active.activeMisconceptions} active misconception${active.activeMisconceptions === 1 ? '' : 's'}`}
          </p>
          {chips.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
              {chips.map((c) => (
                <span key={c.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, borderRadius: 99, padding: '4px 11px', background: 'rgba(28,28,26,.04)' }}>
                  <span style={{ width: 7, height: 7, borderRadius: 99, background: c.color }} />
                  {c.n} {c.label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
