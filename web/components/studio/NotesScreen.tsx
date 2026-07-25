'use client'

import { useState } from 'react'
import type { StudioNotes } from './notes-read'
import { NotesDocument } from './NotesDocument'
import { AskCalyxaPanel, type PanelState } from './AskCalyxaPanel'
import { T, MOTION } from './tokens'
import { ChevronRight } from './icons'

// Screen 2 — the Notes view: the concept's notebook on the left (60%) and the
// Ask Calyxa panel on the right (40%), each a full-height card with its own
// scroll. The panel collapses to a rail so the notebook can take the full width.

export function NotesScreen({ data }: { data: StudioNotes }) {
  const [panel, setPanel] = useState<PanelState>('home')
  const [collapsed, setCollapsed] = useState(false)
  const [pending, setPending] = useState<string | null>(null)

  const cardStyle = {
    background: T.card,
    border: `1px solid ${T.border}`,
    borderRadius: 14,
    minHeight: 0,
    overflowY: 'auto' as const,
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: collapsed ? '1fr 0px' : '3fr 2fr',
        gap: collapsed ? 0 : 14,
        padding: '0 16px 16px',
        flex: 1,
        minHeight: 0,
        transition: `grid-template-columns ${MOTION.base} ${MOTION.ease}`,
      }}
    >
      <div style={cardStyle}>
        <NotesDocument
          data={data}
          onAsk={(question) => {
            setCollapsed(false)
            setPending(question)
          }}
        />
      </div>

      <div style={{ ...cardStyle, position: 'relative', display: collapsed ? 'none' : 'block' }}>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Collapse the Ask Calyxa panel"
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            zIndex: 2,
            width: 34,
            height: 34,
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
          <ChevronRight size={16} />
        </button>

        <AskCalyxaPanel
          conceptKey={data.conceptKey}
          title={data.title}
          problems={data.problems}
          flashcards={data.flashcards}
          misconceptions={data.misconceptions}
          state={panel}
          onState={setPanel}
          pendingQuestion={pending}
          onPendingConsumed={() => setPending(null)}
        />
      </div>

      {collapsed && (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label="Open the Ask Calyxa panel"
          style={{
            position: 'fixed',
            right: 22,
            bottom: 22,
            height: 40,
            padding: '0 16px',
            borderRadius: 999,
            border: 'none',
            background: T.accent,
            color: T.onAccent,
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Ask Calyxa
        </button>
      )}
    </div>
  )
}
