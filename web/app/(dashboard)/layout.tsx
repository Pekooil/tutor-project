import type { ReactNode } from 'react'

// Minimal authed app shell (Sprint 10 Task 7, ux-redesign-sprint10.md §5): a
// header bar (logomark+wordmark lockup + an intentionally empty nav slot —
// nothing else exists to link to until the dashboard sprint) and a centered
// content container. The dashboard sprint extends the nav slot; this sprint
// only builds the shell.
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <img src="/logo.svg" alt="Calyxa" className="h-6 w-auto" />
        <nav aria-label="Account navigation" />
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">{children}</main>
    </div>
  )
}
