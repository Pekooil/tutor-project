import { Logomark } from './primitives'
import { C } from './theme'

// The floating "Ask Calyxa" pill (Design handoff, "Pill echo") — a fixed,
// bottom-centered echo of the extension's ambient pill. Presentational only.
export function AskPill() {
  return (
    <div style={{ position: 'fixed', bottom: 22, left: '50%', transform: 'translateX(-50%)', zIndex: 40 }}>
      <span
        style={{
          position: 'absolute',
          inset: -4,
          borderRadius: 99,
          background: 'radial-gradient(closest-side,rgba(187,247,208,.9),rgba(74,222,128,.45),rgba(74,222,128,0))',
          filter: 'blur(12px)',
          animation: 'cxBreathe 3s ease-in-out infinite',
        }}
      />
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '8px 10px 8px 14px',
          background: 'rgba(255,255,255,.8)',
          border: '1px solid rgba(28,28,26,.1)',
          borderRadius: 99,
          backdropFilter: 'blur(24px) saturate(1.5)',
          WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
          boxShadow: '0 18px 44px rgba(28,40,30,.18),0 2px 8px rgba(28,40,30,.08)',
          animation: 'cxPop .5s cubic-bezier(.3,1.4,.4,1) .4s both',
        }}
      >
        <span
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 99,
            background: 'linear-gradient(180deg,rgba(255,255,255,.22),rgba(255,255,255,0) 70%)',
            pointerEvents: 'none',
          }}
        />
        <Logomark size={21} id="cxgPill" />
        <span style={{ fontSize: 13.5, fontWeight: 500, color: C.ink, paddingRight: 2 }}>Ask Calyxa</span>
        <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: C.muted, border: '1px dashed #c9c7c0', borderRadius: 99, padding: '1px 6px', marginRight: 4 }}>Soon</span>
        <span style={{ width: 1, height: 20, background: 'rgba(28,28,26,.1)', margin: '0 2px' }} />
        <span
          title="Coming soon"
          aria-disabled="true"
          style={{ width: 36, height: 36, borderRadius: 99, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'default', opacity: 0.4 }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6b6b65" strokeWidth="1.8" strokeLinecap="round">
            <path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z" />
            <path d="M5 11a7 7 0 0 0 14 0" />
            <path d="M12 18v3" />
          </svg>
        </span>
        <span
          title="Coming soon"
          aria-disabled="true"
          style={{ width: 36, height: 36, borderRadius: 99, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'default', opacity: 0.4 }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b6b65" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="6" width="18" height="12" rx="2.5" />
            <path d="M7 15 H17" />
          </svg>
        </span>
      </div>
    </div>
  )
}
