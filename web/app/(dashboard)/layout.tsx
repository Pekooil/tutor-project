import type { ReactNode } from 'react'
import { DashboardNav } from '@/components/dashboard/DashboardNav'

// Minimal authed app shell (Sprint 10 Task 7, ux-redesign-sprint10.md §5): a
// header bar (logomark+wordmark lockup + the account nav) and a centered
// content container. Sprint 22 fills the nav slot Sprint 10 reserved with the
// real dashboard navigation (DashboardNav); the shell/container are otherwise
// unchanged. The header wraps on narrow viewports now that the nav has content.
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border px-6 py-4">
        <img src="/logo.svg" alt="Calyxa" className="h-6 w-auto" />
        <DashboardNav />
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">{children}</main>
    </div>
  )
}
