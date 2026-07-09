'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'

// Sprint 16 / Task 5 (ADR-035): a two-step inline confirm (Card/Alert/Button
// only — no new component system, per the sprint plan) rather than a modal
// dialog, since no Dialog primitive exists in web/components/ui yet and
// adding one is exactly the "new component system" this task avoids.
export function DeleteAccountButton() {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
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

  if (!confirming) {
    return (
      <Button variant="outline" onClick={() => setConfirming(true)}>
        Delete my account
      </Button>
    )
  }

  return (
    <Alert variant="destructive" className="flex flex-col gap-3">
      <AlertDescription>
        This permanently deletes your account and everything tied to it — sessions, mastery
        history, and reinforcement schedule. This cannot be undone.
      </AlertDescription>
      {error && <AlertDescription>{error}</AlertDescription>}
      <div className="col-start-2 flex gap-2">
        <Button variant="destructive" onClick={handleConfirm} disabled={deleting}>
          {deleting ? 'Deleting…' : 'Yes, delete everything'}
        </Button>
        <Button variant="outline" onClick={() => setConfirming(false)} disabled={deleting}>
          Cancel
        </Button>
      </div>
    </Alert>
  )
}
