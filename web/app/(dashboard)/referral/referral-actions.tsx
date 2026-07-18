'use client'

import { useState } from 'react'
import { C } from '@/components/dashboard/premium/theme'

// ADR-053: the client actions for the referral page (same server-page +
// client-actions split as billing/billing-actions.tsx). "Get my invite link"
// POSTs to /api/referral/link (idempotent allocate-if-absent; cookie session
// rides the same-origin POST) and swaps in the link + copy affordance. The
// code itself is server-generated — nothing here ever chooses it.
export function ReferralActions({ initialLink }: { initialLink: string | null }) {
  const [link, setLink] = useState(initialLink)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function createLink() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/referral/link', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || typeof body.link !== 'string') {
        setError(body.error ?? 'Could not create your referral link right now.')
        return
      }
      setLink(body.link)
    } catch {
      setError('Could not create your referral link — check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can be denied — the link text stays visible and selectable.
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

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {link ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            border: `1px solid ${C.hair}`,
            borderRadius: 13,
            padding: '10px 12px',
            background: 'rgba(255,255,255,.6)',
          }}
        >
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 13,
              userSelect: 'all',
            }}
          >
            {link}
          </span>
          <button className="cx-hover-mint" style={{ ...primaryPill, padding: '7px 14px', flex: 'none' }} onClick={() => void copy()}>
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>
      ) : (
        <span>
          <button className="cx-hover-mint" style={primaryPill} onClick={() => void createLink()} disabled={busy}>
            {busy ? 'Creating…' : 'Get my invite link'}
          </button>
        </span>
      )}
      {error && <span style={{ fontSize: 13, color: C.red }}>{error}</span>}
    </div>
  )
}
