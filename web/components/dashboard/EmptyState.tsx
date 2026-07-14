import type { ReactNode } from 'react'

// A shared, calm empty state for a fresh account (or a section with no data
// yet). Never a crash and never a fake chart — it says plainly that data
// arrives as the student uses Calyxa, which is the honest launch reality
// (ADR-047: no backfill, no faked history).
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {children ? <p className="max-w-sm text-sm text-muted-foreground">{children}</p> : null}
    </div>
  )
}
