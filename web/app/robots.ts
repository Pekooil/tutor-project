import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // /welcome is a compat-only redirect (see next.config.ts) with no page
      // of its own. The (dashboard) group is auth-gated by proxy.ts — every
      // route in it 307s a signed-out crawler to /login, which Google reports
      // as "page with redirect." Keep bots out of both rather than let them
      // discover the redirect chain via the marketing nav's /dashboard and
      // /billing links.
      disallow: ['/welcome', '/dashboard', '/account', '/billing', '/library', '/notes', '/sessions', '/data', '/referral', '/kits', '/misconceptions', '/quiz', '/flashcards', '/concepts', '/notebook', '/review'],
    },
    sitemap: 'https://calyxa.app/sitemap.xml',
  }
}
