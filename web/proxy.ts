import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Public routes everyone can reach without a session. Everything else
// (e.g. the (dashboard) route group) requires an authenticated user.
const PUBLIC_PATHS = ['/', '/login', '/signup']

function isPublicPath(pathname: string) {
  // /api/session/* is bearer-only (ADR-006): the extension never sends our
  // cookie, so this cookie-based gate must not run for it — clientFromBearer
  // does that route's own auth instead.
  return (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/session')
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

export const proxyConfig = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
