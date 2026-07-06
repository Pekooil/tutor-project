import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type SectionProps = {
  id?: string
  kicker?: string
  heading: ReactNode
  sub?: ReactNode
  children?: ReactNode
  className?: string
}

// The scaffold every below-the-fold marketing section composes: max-width
// container + kicker/heading/sub. The hero (Task 5) is full-bleed and does
// not use this — everything after it does.
export function Section({ id, kicker, heading, sub, children, className }: SectionProps) {
  return (
    <section id={id} className={cn('mx-auto max-w-6xl px-6 py-24 sm:py-32', className)}>
      {kicker ? (
        <p className="text-sm font-semibold tracking-wide text-accent-emphasis uppercase">{kicker}</p>
      ) : null}
      <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
        {heading}
      </h2>
      {sub ? <p className="mt-4 max-w-2xl text-lg text-muted-foreground">{sub}</p> : null}
      {children ? <div className="mt-12">{children}</div> : null}
    </section>
  )
}
