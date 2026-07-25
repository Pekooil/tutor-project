import { redirect } from 'next/navigation'
import { studioEntryRedirect } from '@/components/studio/entry'

// The bare index now resolves to the student's current concept's NOTES — the quiz
// and flashcards run inside that view's panel rather than on their own route.
export const dynamic = 'force-dynamic'

export default async function Index() {
  redirect(await studioEntryRedirect('notes'))
}
