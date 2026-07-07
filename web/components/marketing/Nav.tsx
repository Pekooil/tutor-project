'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function Nav() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={cn(
        'sticky top-0 z-50 w-full border-b transition-colors duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-out)]',
        scrolled
          ? 'border-(--mkt-border-faint) bg-background/70 shadow-[var(--mkt-shadow-1)] backdrop-blur-xl'
          : 'border-transparent bg-transparent'
      )}
    >
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center">
          <img src="/logo.svg" alt="Calyxa" className="h-6 w-auto" />
        </Link>
        <div className="hidden items-center gap-8 text-sm font-medium text-muted-foreground sm:flex">
          <a href="#session-showcase" className="hover:text-foreground">
            See it work
          </a>
          <a href="#pricing" className="hover:text-foreground">
            Pricing
          </a>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-sm font-medium text-muted-foreground hover:text-foreground">
            Log in
          </Link>
          <Button asChild size="sm">
            <a href="#hero">Join the waitlist</a>
          </Button>
        </div>
      </nav>
    </header>
  )
}
