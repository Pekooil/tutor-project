import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadStudyKit } from '@/components/dashboard/premium/kit-read'
import { KitViewer } from '@/components/dashboard/premium/KitViewer'
import { resolveKitConcept } from '@/components/studio/kit-target'

// The one URL the SHIPPED extension deep-links to (recap card → "Open it in your
// dashboard"). It now forwards into the studio: `/notes/[conceptKey]` for the
// concept this kit belongs to, which carries the notebook, the annotations and the
// kit's own material — rather than the bare pre-studio kit viewer.
//
// Doing this server-side rather than by changing the extension is what makes it
// reach already-installed builds; see kit-target.ts for the reasoning.
//
// A plain `redirect` (307), NOT permanent: the session → concept mapping is
// derived from data, and a 308 would be cached by the browser forever, so a later
// correction could never take effect.
//
// When no concept resolves — a kit whose turns never recorded one — the viewer is
// still rendered. This route must never dead-end a link that is out in the wild.
export const dynamic = 'force-dynamic'

export default async function KitPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const conceptKey = await resolveKitConcept(supabase, user.id, key)
  if (conceptKey) {
    redirect(`/notes/${encodeURIComponent(conceptKey)}`)
  }

  const kit = await loadStudyKit(supabase, key)
  if (!kit) {
    notFound()
  }

  return <KitViewer kit={kit} />
}
