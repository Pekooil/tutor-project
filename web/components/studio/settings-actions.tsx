'use client'

import { useState } from 'react'
import type { CSSProperties } from 'react'
import { T, MOTION, RADIUS, accentButton, ghostButton } from './tokens'

// The interactive bits of the Account and Billing screens, on studio tokens.
//
// These replace `app/(dashboard)/{account,billing,referral}/*-actions.tsx`,
// which were built on `premium/theme.ts`'s hardcoded LIGHT hexes and therefore
// could not render inside the dark studio. The NETWORK behaviour is carried over
// unchanged — same endpoints, same payloads, same redirect-to-Stripe contract
// (ADR-006: the browser only ever receives a URL; the Stripe SDK never reaches
// the client).

const busyStyle = (busy: boolean): CSSProperties =>
  busy ? { opacity: 0.6, cursor: 'progress', pointerEvents: 'none' } : {}

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" style={{ margin: '10px 0 0', fontSize: 12.5, color: T.danger }}>
      {message}
    </p>
  )
}

// ── Billing ──────────────────────────────────────────────────────────────────

/** Upgrade (free) or Manage (Pro). Both POST to a route that returns a
 *  Stripe-hosted URL and we send the browser there. */
export function BillingActions({ isPro, upgradeLabel }: { isPro: boolean; upgradeLabel: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function go(path: string) {
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
      window.location.href = body.url
    } catch {
      setBusy(false)
      setError('Could not reach the server — please try again.')
    }
  }

  const button = (
    <button
      type="button"
      onClick={() => void go(isPro ? '/api/billing/portal' : '/api/billing/checkout')}
      disabled={busy}
      style={{
        ...(isPro ? ghostButton : accentButton),
        borderRadius: RADIUS.pill,
        padding: '11px 20px',
        fontSize: 14,
        ...busyStyle(busy),
      }}
    >
      {busy ? 'One moment…' : isPro ? 'Manage subscription' : upgradeLabel}
    </button>
  )

  return (
    <div>
      {/* Upgrade is the page's primary action, so it breathes. "Manage
          subscription" is a ghost and stays still — a pulsing portal link would
          be pushing a Pro user toward nothing in particular. */}
      {isPro ? (
        button
      ) : (
        <span className="cx-glowwrap">
          <span aria-hidden className="cx-glow cx-breathe" />
          {button}
        </span>
      )}
      <ErrorNote message={error} />
    </div>
  )
}

// ── Referral ─────────────────────────────────────────────────────────────────

export function ReferralActions({ initialLink }: { initialLink: string | null }) {
  const [link, setLink] = useState(initialLink)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function createLink() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/referral/link', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.link) {
        setError(body.error ?? 'Could not create your link — please try again.')
        return
      }
      setLink(body.link)
    } catch {
      setError('Could not reach the server — please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard permission can be denied; the link is selectable either way,
      // so this is not worth an error banner.
      setError('Copy blocked by the browser — select the link and copy it.')
    }
  }

  if (!link) {
    return (
      <div>
        <button
          type="button"
          onClick={() => void createLink()}
          disabled={busy}
          style={{ ...ghostButton, borderRadius: RADIUS.pill, padding: '9px 17px', fontSize: 13, ...busyStyle(busy) }}
        >
          {busy ? 'Creating…' : 'Create my invite link'}
        </button>
        <ErrorNote message={error} />
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <code
          style={{
            flex: '1 1 260px',
            minWidth: 0,
            padding: '9px 16px',
            borderRadius: RADIUS.pill,
            border: `1px solid ${T.frame}`,
            background: T.raised3,
            fontSize: 12.5,
            color: T.inkSoft,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {link}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          style={{
            ...ghostButton,
            borderRadius: RADIUS.pill,
            padding: '9px 17px',
            fontSize: 13,
            flex: 'none',
            transition: `color ${MOTION.fast} ${MOTION.ease}`,
            color: copied ? T.accentInk : T.ink,
          }}
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
      <ErrorNote message={error} />
    </div>
  )
}

// ── Account ──────────────────────────────────────────────────────────────────

export function LogoutButton() {
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        setBusy(true)
        await fetch('/api/auth/logout', { method: 'POST' })
        window.location.href = '/'
      }}
      disabled={busy}
      style={{ ...ghostButton, borderRadius: RADIUS.pill, padding: '9px 17px', fontSize: 13, ...busyStyle(busy) }}
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  )
}

/** Two-step inline confirm, carried over from the pre-studio screen: deleting an
 *  account is irreversible and cascades every table, so it never fires on one
 *  click. */
export function DeleteAccountButton() {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setBusy(true)
    setError(null)
    const res = await fetch('/api/account/delete', { method: 'POST' })
    if (!res.ok) {
      setBusy(false)
      setError('Could not delete your account — please try again, or contact support.')
      return
    }
    window.location.href = '/'
  }

  if (!confirming) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          style={{
            ...ghostButton,
            borderRadius: RADIUS.pill,
            padding: '9px 17px',
            fontSize: 13,
            color: T.danger,
            borderColor: T.dangerEdge,
          }}
        >
          Delete my account
        </button>
        <ErrorNote message={error} />
      </div>
    )
  }

  return (
    <div>
      <p style={{ margin: '0 0 10px', fontSize: 13, lineHeight: 1.55, color: T.ink }}>
        This erases your account and everything Calyxa has learned about you — sessions, notes, study kits and
        mastery. It cannot be undone.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={busy}
          style={{
            ...ghostButton,
            borderRadius: RADIUS.pill,
            padding: '9px 17px',
            fontSize: 13,
            color: T.danger,
            borderColor: T.dangerEdge,
            background: T.dangerBg,
            ...busyStyle(busy),
          }}
        >
          {busy ? 'Deleting…' : 'Yes, delete everything'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
          style={{ ...ghostButton, borderRadius: RADIUS.pill, padding: '9px 17px', fontSize: 13, ...busyStyle(busy) }}
        >
          Keep my account
        </button>
      </div>
      <ErrorNote message={error} />
    </div>
  )
}
