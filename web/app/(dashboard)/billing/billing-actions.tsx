'use client'

import { useState } from 'react'
import { C } from '@/components/dashboard/premium/theme'

// Sprint 23 / Task 7 (ADR-050/051): the client action buttons for the billing
// page (the page itself is a server component; this is its "client action
// buttons" child, the same server-page + client-actions split as
// account/account-actions.tsx). A free user gets "Upgrade to Pro" → POST
// /api/billing/checkout; a Pro user gets "Manage subscription" → POST
// /api/billing/portal. Both routes return { url } (a Stripe-hosted page) and we
// redirect the browser there. Auth is the dashboard's cookie session (the POST
// is same-origin, so cookies ride along) — no token handling here, and Stripe
// itself is never imported into the client (ADR-006: the browser only ever
// receives a URL to redirect to).
export function BillingActions({ isPro }: { isPro: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function redirectTo(path: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(path, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.url) {
        setBusy(false)
        setError(body.error ?? 'Something went wrong — please try again.')
        return
      }
      // Hand off to the Stripe-hosted checkout / portal page.
      window.location.href = body.url as string
    } catch {
      setBusy(false)
      setError('Could not reach billing — check your connection and try again.')
    }
  }

  const primaryPill = {
    border: 'none',
    background: C.mint,
    color: C.greenDeep,
    borderRadius: 99,
    padding: '9px 18px',
    fontSize: 13,
    fontWeight: 600,
    cursor: busy ? 'default' : 'pointer',
    opacity: busy ? 0.7 : 1,
  } as const

  const subtlePill = {
    border: 'none',
    background: 'rgba(28,28,26,.06)',
    color: C.ink,
    borderRadius: 99,
    padding: '9px 18px',
    fontSize: 13,
    fontWeight: 600,
    cursor: busy ? 'default' : 'pointer',
    opacity: busy ? 0.7 : 1,
  } as const

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span>
        {isPro ? (
          <button
            className="cx-hover-faint"
            style={subtlePill}
            onClick={() => redirectTo('/api/billing/portal')}
            disabled={busy}
          >
            {busy ? 'Opening…' : 'Manage subscription'}
          </button>
        ) : (
          <button
            className="cx-hover-mint"
            style={primaryPill}
            onClick={() => redirectTo('/api/billing/checkout')}
            disabled={busy}
          >
            {busy ? 'Redirecting…' : 'Upgrade to Pro'}
          </button>
        )}
      </span>
      {error && <span style={{ fontSize: 13, color: C.red }}>{error}</span>}
    </div>
  )
}
