'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

// The dashboard's account navigation — fills the `<nav>` slot the
// (dashboard)/layout.tsx header reserved since Sprint 10. A small client
// component (only so it can mark the current route active via usePathname);
// the layout itself stays a server component and just renders this.
//
// "Study kits" is intentionally absent: Sprint 21's /study surface has not
// landed (no /api/study/list), so per the plan its nav item + page are omitted,
// not stubbed. Add both when Sprint 21 ships. "Activity" links to the Task 7
// page (built next in this same sprint).
const LINKS = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/mastery', label: 'Mastery' },
  { href: '/misconceptions', label: 'Misconceptions' },
  { href: '/review', label: 'Review' },
  { href: '/activity', label: 'Activity' },
  { href: '/account', label: 'Account' },
] as const

export function DashboardNav() {
  const pathname = usePathname()

  return (
    <nav aria-label="Account navigation" className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
      {LINKS.map((link) => {
        const active = pathname === link.href
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-md px-3 py-1.5 transition-colors',
              active
                ? 'bg-accent font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
