import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, clientBucket, tooManyRequests } from '@/lib/rate-limit/limiter'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ALLOWED_SOURCES = ['hero', 'footer'] as const

// ADR-031: the waitlist table is deny-all under RLS (Shape 3, see
// /supabase/policies/README.md) -- this route, on the service-role client,
// is the ONLY writer. Never called from a client component.
export async function POST(request: Request) {
  const supabase = createAdminClient()

  // Rate-limit first (Sprint 18 security review §7.1 follow-up). Per-IP,
  // fails OPEN on any RPC error so a limiter fault never blocks a real signup.
  const rate = await checkRateLimit(supabase, 'waitlist', clientBucket(request, 'waitlist'))
  if (!rate.allowed) return tooManyRequests(rate.retryAfterSeconds)

  let body: { email?: unknown; source?: unknown; company?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  // Honeypot: a real visitor never sees or fills this field. A bot that
  // fills every field gets a silent success -- never a signal that tells it
  // the check exists.
  if (typeof body.company === 'string' && body.company.trim() !== '') {
    return NextResponse.json({ ok: true })
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
  }

  const source = ALLOWED_SOURCES.includes(body.source as (typeof ALLOWED_SOURCES)[number])
    ? (body.source as (typeof ALLOWED_SOURCES)[number])
    : null

  // ON CONFLICT (email) DO NOTHING via upsert/ignoreDuplicates: a repeat
  // signup is an idempotent no-op, never an error that would leak whether
  // the email already exists.
  const { error } = await supabase
    .from('waitlist')
    .upsert({ email, source }, { onConflict: 'email', ignoreDuplicates: true })

  if (error) {
    return NextResponse.json({ error: 'Something went wrong. Try again.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
