import { Logomark } from './primitives'
import { C } from './theme'

// A small "Ask Calyxa — coming soon" chip echoing the extension's ambient pill.
// Deliberately demoted to a subtle bottom-right corner marker (it used to be a
// large bottom-centre bar with non-functional mic/keyboard buttons that read as
// broken controls). Presentational only — it signals the feature is on the way
// without competing with the page's primary action.
export function AskPill() {
  return (
    <div style={{ position: 'fixed', bottom: 18, right: 18, zIndex: 40 }}>
      <span
        title="Ask Calyxa — coming soon"
        aria-disabled="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          padding: '7px 12px 7px 10px',
          background: 'rgba(255,255,255,.7)',
          border: '1px solid rgba(28,28,26,.1)',
          borderRadius: 99,
          backdropFilter: 'blur(20px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
          boxShadow: '0 8px 22px rgba(28,40,30,.1)',
          cursor: 'default',
        }}
      >
        <Logomark size={17} id="cxgPill" />
        <span style={{ fontSize: 12.5, fontWeight: 500, color: C.muted }}>Ask Calyxa</span>
        <span style={{ fontSize: 8.5, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: C.muted, border: '1px dashed #c9c7c0', borderRadius: 99, padding: '1px 6px' }}>
          Soon
        </span>
      </span>
    </div>
  )
}
