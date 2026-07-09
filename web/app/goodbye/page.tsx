import Link from 'next/link'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

// Sprint 16 / Task 5 (ADR-035): the destination DeleteAccountButton
// redirects to after a successful POST /api/account/delete — a standalone
// public page (matching /login and /signup's shell, not the (dashboard)
// layout, since the account is now signed out and deleted-account.tsx's
// pages can no longer render a valid authed shell). Not in Task 5's
// original file list — added because "redirect to a goodbye state" names a
// concrete destination the plan never scaffolded; disclosed in this
// sprint's task report.
export default function GoodbyePage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 bg-background px-4 py-12">
      <img src="/logo.svg" alt="Calyxa" className="h-8 w-auto" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <h1 className="text-xl leading-none font-semibold">Your account has been deleted</h1>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm text-muted-foreground">
          <p>
            We&apos;ve queued your account and everything tied to it — sessions, mastery history,
            reinforcement schedule — for permanent deletion. This usually completes within a day.
          </p>
          <Link href="/" className="font-medium text-accent-emphasis underline-offset-4 hover:underline">
            Back to the homepage
          </Link>
        </CardContent>
      </Card>
    </main>
  )
}
