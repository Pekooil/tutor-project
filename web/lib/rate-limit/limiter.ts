import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// Follow-up to the Sprint 18 security review (§7.1): a thin wrapper around the
// `check_rate_limit` RPC (migration 0018), shaped like cost-guard.ts — a small
// function taking the (service-role) client + params, returning a plain result.
//
// Conservative per-IP fixed-window limits for the two public endpoints. These
// are low-frequency by nature; the caps are generous enough for legitimate
// bursts (a crashing extension firing several errors; a human signing up) while
// bounding casual abuse. Platform-level DDoS is Vercel's job — this is
// defense-in-depth, not the primary defense.
export const RATE_LIMITS = {
  errors: { limit: 30, windowSeconds: 60 },
  waitlist: { limit: 5, windowSeconds: 60 },
  // Sprint 19 (ADR-045): the public invite-claim endpoint. Rate-limited like
  // the other public unauthenticated routes (Sprint 18 security review §7.1),
  // defense-in-depth over the 128-bit codes that already make guessing
  // infeasible.
  invite: { limit: 10, windowSeconds: 60 },
} as const

export type RateLimitResult = {
  allowed: boolean
  count: number
  limit: number
  retryAfterSeconds: number
}

// A per-request identifier from Vercel's forwarded headers. `x-forwarded-for`
// is a comma-separated chain; the first entry is the client. Requests with no
// discernible IP share one "unknown" bucket (fail-safe: they are limited
// together rather than exempt).
export function clientBucket(request: Request, route: keyof typeof RATE_LIMITS): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown'
  return `${route}:${ip}`
}

// Fails OPEN, like costGuard: a rate-limiter that errors must never be the
// reason a request fails. An RPC error (e.g. the migration not yet applied)
// logs and allows. Logged so a persistently-failing limiter stays visible.
export async function checkRateLimit(
  admin: SupabaseClient,
  route: keyof typeof RATE_LIMITS,
  bucket: string
): Promise<RateLimitResult> {
  const { limit, windowSeconds } = RATE_LIMITS[route]

  const { data, error } = await admin.rpc('check_rate_limit', {
    p_bucket: bucket,
    p_window_seconds: windowSeconds,
  })

  if (error || typeof data !== 'number') {
    console.error('rate-limit: check_rate_limit RPC failed, allowing request', error)
    return { allowed: true, count: 0, limit, retryAfterSeconds: 0 }
  }

  return { allowed: data <= limit, count: data, limit, retryAfterSeconds: windowSeconds }
}

// A ready-to-return 429 with a Retry-After header, for the over-limit path.
export function tooManyRequests(retryAfterSeconds: number): Response {
  return Response.json(
    { error: 'Too many requests. Please slow down and try again shortly.' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
  )
}
