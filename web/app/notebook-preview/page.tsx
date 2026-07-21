import type { CSSProperties } from 'react'
import { AmbientGlow } from '@/components/dashboard/premium/AmbientGlow'
import { PremiumNav } from '@/components/dashboard/premium/PremiumNav'
import { NotebookShell } from '@/components/dashboard/premium/notebook/NotebookShell'
import { SnapshotBoardList } from '@/components/dashboard/premium/study-snapshots-board'
import { MOCK_NOTEBOOK, MOCK_SNAPSHOTS } from '@/components/dashboard/premium/notebook/mock'
import { C, glassCard, sheen, eyebrow } from '@/components/dashboard/premium/theme'

// Design harness for the Personal Notebook redesign — the two-pane shell on
// seeded Algebra 1 data, viewable WITHOUT a login so the redesign can be
// reviewed and screenshotted. Not linked from the app; the real notebook lives
// at /notebook/[subject] on the authenticated, RLS-scoped read.
export const dynamic = 'force-static'

const ribbon: CSSProperties = {
  position: 'fixed',
  bottom: 16,
  right: 16,
  zIndex: 60,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  color: '#14532d',
  background: 'rgba(134,239,172,.5)',
  border: '1px solid rgba(20,83,45,.2)',
  borderRadius: 99,
  padding: '5px 12px',
}

export default function NotebookPreviewPage() {
  return (
    <div className="cx-app" style={{ position: 'relative', minHeight: '100vh' }}>
      <AmbientGlow />
      <PremiumNav name="Alex Rivera" initials="AR" planLabel="Free plan" />
      <main style={{ position: 'relative', padding: '104px 0 160px' }}>
        {/* Board showcase — pinned at the top so the visual Homework-Snapshots
            board is visible without scrolling past the notebook chrome. The same
            component renders inside each concept page below. */}
        <div style={{ maxWidth: 800, margin: '0 auto 30px', padding: '0 24px' }}>
          <div style={{ ...glassCard, padding: '18px 20px 16px' }}>
            <span style={sheen} />
            <div style={{ position: 'relative' }}>
              <span style={eyebrow}>Homework snapshots · the tutor&rsquo;s marks, drawn</span>
              <p style={{ margin: '4px 0 14px', fontSize: 13, color: C.muted }}>
                Reconstructed from the tutor&rsquo;s persisted annotations — a hand-drawn circle, a highlighter swash, and a
                squiggle underline on the math they pointed at. This same board appears in every concept page below.
              </p>
              <SnapshotBoardList snapshots={MOCK_SNAPSHOTS} />
            </div>
          </div>
        </div>

        <NotebookShell data={MOCK_NOTEBOOK} />
      </main>
      <span style={ribbon}>Notebook preview · seeded data</span>
    </div>
  )
}
