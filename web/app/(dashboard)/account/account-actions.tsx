'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { C } from '@/components/dashboard/premium/theme'

// The premium Account "danger zone": inline delete-account confirm (no Dialog
// primitive exists — same two-step inline confirm as the pre-premium button,
// restyled to the design) plus a subtle log-out affordance.
export function AccountActions() {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    const res = await fetch('/api/account/delete', { method: 'POST' })
    if (!res.ok) {
      setDeleting(false)
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not delete your account right now.')
      return
    }
    router.push('/goodbye')
  }

  async function handleLogout() {
    setLoggingOut(true)
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  const dangerPill = {
    border: 'none',
    background: C.redBg,
    borderRadius: 99,
    padding: '8px 16px',
    fontSize: 12.5,
    fontWeight: 600,
    color: C.red,
    cursor: 'pointer',
  } as const

  return (
    <>
      <div
        style={{
          position: 'relative',
          background: 'rgba(255,255,255,.72)',
          border: '1px solid rgba(185,28,28,.18)',
          borderRadius: 17,
          padding: '15px 19px',
          backdropFilter: 'blur(22px) saturate(1.5)',
          WebkitBackdropFilter: 'blur(22px) saturate(1.5)',
          boxShadow: '0 12px 32px rgba(28,40,30,.08),0 2px 8px rgba(28,40,30,.05)',
          display: 'flex',
          flexDirection: 'column',
          gap: confirming ? 14 : 0,
          animation: 'cxPop .5s cubic-bezier(.3,1.4,.4,1) .26s both',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
            <span style={{ fontSize: 14.5, fontWeight: 600, color: C.red }}>Delete account</span>
            <span style={{ fontSize: 13, color: C.muted }}>Removes your profile and every session, permanently. This can&rsquo;t be undone.</span>
          </span>
          {!confirming && (
            <button className="cx-hover-danger" style={dangerPill} onClick={() => setConfirming(true)}>
              Delete account
            </button>
          )}
        </div>
        {confirming && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid rgba(185,28,28,.15)', paddingTop: 14 }}>
            {error && <span style={{ fontSize: 13, color: C.red }}>{error}</span>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                style={{ border: 'none', background: '#b91c1c', color: '#fff', borderRadius: 99, padding: '8px 16px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', opacity: deleting ? 0.7 : 1 }}
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Yes, delete everything'}
              </button>
              <button
                className="cx-hover-faint"
                style={{ border: 'none', background: 'rgba(28,28,26,.06)', color: C.ink, borderRadius: 99, padding: '8px 16px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
                onClick={() => setConfirming(false)}
                disabled={deleting}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Sign out. Previously a borderless wash at 6% ink, which read as a caption
          rather than a control — it is now an explicit bordered pill with a glyph,
          on its own labelled row, so it is findable without hunting. */}
      <div
        style={{
          position: 'relative',
          marginTop: 16,
          background: 'rgba(255,255,255,.72)',
          border: `1px solid ${C.hair}`,
          borderRadius: 17,
          padding: '15px 19px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          animation: 'cxPop .5s cubic-bezier(.3,1.4,.4,1) .3s both',
        }}
      >
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, color: C.ink }}>Sign out</span>
          <span style={{ fontSize: 13, color: C.muted }}>
            Ends this session on this device. Your notes and history stay put.
          </span>
        </span>
        <button
          className="cx-hover-faint"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            background: '#fff',
            border: `1px solid ${C.muted}`,
            color: C.ink,
            borderRadius: 99,
            padding: '9px 18px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            opacity: loggingOut ? 0.7 : 1,
            flexShrink: 0,
          }}
          onClick={handleLogout}
          disabled={loggingOut}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 17l5-5-5-5" />
            <path d="M20 12H9" />
            <path d="M12 19H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6" />
          </svg>
          {loggingOut ? 'Signing out…' : 'Log out'}
        </button>
      </div>
    </>
  )
}
