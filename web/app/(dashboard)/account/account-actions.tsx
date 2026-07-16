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

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button
          className="cx-hover-faint"
          style={{ border: 'none', background: 'rgba(28,28,26,.06)', color: C.ink, borderRadius: 99, padding: '8px 16px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
          onClick={handleLogout}
          disabled={loggingOut}
        >
          {loggingOut ? 'Logging out…' : 'Log out'}
        </button>
      </div>
    </>
  )
}
