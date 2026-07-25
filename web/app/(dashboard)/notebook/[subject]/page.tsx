import { permanentRedirect } from 'next/navigation'

// RETIRED alongside /notebook — a subject no longer has its own page; the
// dashboard's accordion is the subject view. Redirects there rather than 404ing
// a URL a student may have bookmarked.
export const dynamic = 'force-dynamic'

export default async function NotebookSubjectRedirect() {
  permanentRedirect('/dashboard')
}
