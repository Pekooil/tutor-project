import { redirect } from 'next/navigation'
import { studioEntryRedirect } from '@/components/studio/entry'

// Bare `/notes` — the rail links here before a concept has been opened. Resolve
// to the student's most recent concept, or send them back to the dashboard when
// nothing has been tutored yet.
export const dynamic = 'force-dynamic'

export default async function NotesIndexPage() {
  redirect(await studioEntryRedirect('notes'))
}
