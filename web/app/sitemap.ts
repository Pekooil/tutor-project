import type { MetadataRoute } from 'next'

const BASE_URL = 'https://calyxa.app'

// The public, indexable surface only. Deliberately excluded:
//   - the (dashboard) route group — auth-gated, per-user, nothing to index
//   - /login, /complete-profile, /goodbye — auth plumbing, not content
//   - /install — the post-install handoff page; it redirects a signed-out
//     visitor to /signup, so it is a dead end for a crawler
//   - /welcome — a 307 compatibility shim to /install (next.config.ts)
//   - /studio-preview — a mock-data design harness, safe to drop before GA
// Keep this list in sync with PUBLIC_PATHS in web/proxy.ts when a new public
// marketing route is added.
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()

  return [
    {
      url: BASE_URL,
      lastModified,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${BASE_URL}/pricing`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/start`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/signup`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/privacy`,
      lastModified,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/terms`,
      lastModified,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ]
}
