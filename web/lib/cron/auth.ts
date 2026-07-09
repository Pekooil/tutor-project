import 'server-only'
import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'

// Sprint 16 / Task 6 (ADR-036): the shared gate every /api/cron/* route
// calls first. Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`
// automatically when the CRON_SECRET env var is set on the project, so
// comparing against that header is sufficient to ensure nothing but Vercel
// Cron (or a caller holding the secret) can invoke a cron route. Unlike
// costGuard (which fails OPEN on its own error), this fails CLOSED: a
// missing/misconfigured secret is a reason to refuse, not proceed — these
// routes hold the service-role admin client. process.env.CRON_SECRET must
// never be prefixed NEXT_PUBLIC_ and never referenced client-side.
export function assertCronSecret(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET
  const header = request.headers.get('authorization')

  if (!secret || !header?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const expected = Buffer.from(secret)
  const actual = Buffer.from(header.slice('Bearer '.length))

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}
