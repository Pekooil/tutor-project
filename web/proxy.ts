import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Public routes everyone can reach without a session. Everything else
// (e.g. the (dashboard) route group) requires an authenticated user.
const PUBLIC_PATHS = ['/', '/login', '/signup']

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
  return (
    PUBLIC_PATHS.includes(pathname) ||
    pathname === '/robots.txt' ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/session') ||
    pathname.startsWith('/api/ai') ||
    pathname.startsWith('/api/voice') ||
    pathname.startsWith('/api/profile') ||
    pathname.startsWith('/api/waitlist')
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
