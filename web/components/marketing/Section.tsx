import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type SectionProps = {
  id?: string
  kicker?: string
  heading: ReactNode
  sub?: ReactNode
  children?: ReactNode
  className?: string
  /** 'wash' gives the section a full-bleed gradient ground (marketing.css). */
  tone?: 'plain' | 'wash'
}

// The scaffold every below-the-fold marketing section composes: a full-bleed
// section element (so tone grounds can run edge to edge) wrapping the
// max-width container + kicker/heading/sub in the display type system. The
// hero (full-bleed, centered) and FinalCta (full-bleed band) don't use this.
export function Section({ id, kicker, heading, sub, children, className, tone = 'plain' }: SectionProps) {
  return (
    <section id={id} className={cn(tone === 'wash' && 'mkt-ground-wash', className)}>
      <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
        {kicker ? <p className="mkt-kicker">{kicker}</p> : null}
        <h2 className="mkt-display mkt-h2 mt-4 max-w-3xl text-balance text-foreground">{heading}</h2>
        {sub ? (
          <p className="mt-5 max-w-2xl text-pretty text-lg text-muted-foreground sm:text-xl">{sub}</p>
        ) : null}
        {children ? <div className="mt-14">{children}</div> : null}
      </div>
    </section>
  )
}
