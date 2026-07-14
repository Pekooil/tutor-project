import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Public routes everyone can reach without a session. Everything else
// (e.g. the (dashboard) route group) requires an authenticated user.
// /privacy and /terms (Sprint 19, ADR-046) are public like '/': a Chrome Web
// Store reviewer and any signed-out visitor must reach the privacy policy
// without an account (the policy URL is a hard store requirement), so they are
// simply public, the same way the landing page is.
const PUBLIC_PATHS = ['/', '/login', '/signup', '/privacy', '/terms']

function isPublicPath(pathname: string) {
  // /api/session/*, /api/ai/*, /api/voice/*, and /api/profile/* are
  // bearer-only (ADR-006, ADR-008, ADR-010, ADR-025): the extension never
  // sends our cookie, so this cookie-based gate must not run for them —
  // clientFromBearer does each route's own auth instead. /api/profile
  // (Sprint 13) is the newest of these — without this exemption, a
  // bearer-token request to it would be redirected to /login before ever
  // reaching the route handler, exactly like the others would be. /api/waitlist
  // (Sprint 20, ADR-031) is a different case, not a bearer-only one: it's hit by
  // a signed-out visitor on the public landing page, so it's simply public,
  // like '/' itself, rather than exempted from a cookie check it'd otherwise need.
  // /robots.txt is public for the same reason: crawlers are signed-out visitors,
  // and redirecting them to /login reads as an invalid robots.txt (the config
  // matcher below only exempts image extensions, so .txt lands here).
  //
  // Sprint 16 / Task 9 (found during manual acceptance, not the route-level
  // test suite — those import route handlers directly and never go through
  // this middleware at all): /api/cron/* and /api/account/* were missing
  // from this list entirely. /api/cron/* is CRON_SECRET-gated
  // (web/lib/cron/auth.ts), never cookie-authed — Vercel Cron never sends
  // our cookie, so every real invocation was silently redirected to /login
  // before assertCronSecret ever ran, making all three cron jobs
  // unreachable in production. /api/account/* supports EITHER a bearer
  // token or the cookie session (clientFromBearerOrCookie) — today's only
  // caller is the cookie-authed account page, so this was latent rather
  // than actively broken, but the bearer path (reserved for a future
  // extension account UI, per bearer.ts's own comment) was equally
  // unreachable without this exemption.
  return (
    PUBLIC_PATHS.includes(pathname) ||
    pathname === '/robots.txt' ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/session') ||
    pathname.startsWith('/api/ai') ||
    pathname.startsWith('/api/voice') ||
    pathname.startsWith('/api/profile') ||
    pathname.startsWith('/api/waitlist') ||
    pathname.startsWith('/api/cron') ||
    pathname.startsWith('/api/account') ||
    // Sprint 19 (ADR-045), same class as /api/cron above: /api/admin/invite is
    // CRON_SECRET-guarded (a Bearer secret, never our cookie) and would
    // otherwise be silently redirected to /login before assertCronSecret runs.
    // /api/invite/claim is a public signed-out endpoint (a tester validating a
    // code before signup), like /api/waitlist. Both do their own auth; the
    // cookie gate must not run for them.
    pathname.startsWith('/api/admin') ||
    pathname.startsWith('/api/invite') ||
    // Sprint 17 bearer-authed extension routes (ADR-042/043), the SAME class as
    // /api/session, /api/ai, /api/voice above — the extension sends its Bearer
    // token, never our cookie, and each route does its own auth
    // (clientFromBearer). They were omitted from this list when added, so in
    // production every extension call to them was silently redirected to /login
    // (307) before the handler ran — telemetry/feedback never recorded and the
    // onboarding status check degraded to {needed:false}, so onboarding never
    // showed. Found during Sprint 19 Task 9 acceptance (the route-level tests
    // import handlers directly and never traverse this middleware — the exact
    // blind spot that hid the Sprint 16 /api/cron gap). /api/errors is bearer-
    // best-effort (it also serves signed-out crash reports and never 401s), so
    // it belongs here too.
    pathname.startsWith('/api/telemetry') ||
    pathname.startsWith('/api/feedback') ||
    pathname.startsWith('/api/onboarding') ||
    pathname.startsWith('/api/errors')
  )
}

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        // Two-arg setAll(cookiesToSet, headers) matches the installed
        // @supabase/ssr@0.12.0 SetAllCookies type. `headers` carries the
        // no-store/no-cache directives that must ride along with any
        // response that sets auth cookies, so a CDN/edge cache never
        // serves one user's session to another.
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value))
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
