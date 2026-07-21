import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadDashboard } from '@/lib/learning/dashboard-read'
import { defaultNotebookSubject } from '@/components/dashboard/premium/notebook-read'

// The Notebook — the center of the product (redesign). The index redirects to the
// student's most-practiced subject notebook; each subject owns exactly one
// notebook at /notebook/[subject]. Server-rendered, RLS-scoped.
export const dynamic = 'force-dynamic'

export default async function NotebookIndexPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const data = await loadDashboard(supabase)
  redirect(`/notebook/${defaultNotebookSubject(data)}`)
}
