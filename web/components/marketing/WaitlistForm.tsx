'use client'

import { useState, type FormEvent } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type WaitlistFormProps = {
  source: 'hero' | 'footer'
  className?: string
}

type Status = 'idle' | 'pending' | 'success' | 'error'

// Posts to POST /api/waitlist (Task 2). The `company` field is a honeypot —
// invisible and unlabeled to a real visitor, present in the DOM for a bot
// that fills every field — mirrored by the route's own honeypot check.
export function WaitlistForm({ source, className }: WaitlistFormProps) {
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus('pending')
    setErrorMessage('')

    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source, company }),
      })
      const data = await response.json()

      if (!response.ok) {
        setErrorMessage(typeof data?.error === 'string' ? data.error : 'Something went wrong. Try again.')
        setStatus('error')
        return
      }

      setStatus('success')
    } catch {
      setErrorMessage('Something went wrong. Try again.')
      setStatus('error')
    }
  }

  if (status === 'success') {
    return <p className={cn('text-base font-medium text-accent-emphasis', className)}>You&apos;re on the list.</p>
  }

  const inputId = `waitlist-email-${source}`

  return (
    <form onSubmit={handleSubmit} noValidate className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <label htmlFor={inputId} className="sr-only">
          Email address
        </label>
        <Input
          id={inputId}
          type="email"
          required
          autoComplete="email"
          placeholder="you@school.edu"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={status === 'pending'}
          aria-invalid={status === 'error'}
          className="sm:flex-1"
        />
        {/* Honeypot: off-screen, unlabeled to assistive tech, never focusable by tab. */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 0, height: 0, overflow: 'hidden' }}>
          <input
            type="text"
            name="company"
            tabIndex={-1}
            autoComplete="off"
            value={company}
            onChange={(event) => setCompany(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={status === 'pending'}>
          {status === 'pending' ? 'Joining…' : 'Join the waitlist'}
        </Button>
      </div>
      {status === 'error' ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage}
        </p>
      ) : null}
    </form>
  )
}
