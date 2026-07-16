import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type SectionProps = {
  id?: string
  kicker?: string
  heading: ReactNode
  sub?: ReactNode
  children?: ReactNode
  className?: string
  /** 'wash' gives the section the flat surface ground (Landing v3's #F7F7F5 bands). */
  tone?: 'plain' | 'wash'
  /** v3 headers come in both flavors: left (scrollytelling, four systems) and centered (why-us, profile, study kit, pricing). */
  align?: 'left' | 'center'
}

// The scaffold every below-the-fold marketing section composes: a full-bleed
// section element (so tone grounds can run edge to edge) wrapping the
// max-width container + kicker/heading/sub in the display type system. The
// hero (split, full-bleed) and FinalCta (full-bleed band) don't use this.
// Landing v3: the wash tone is a flat surface color now (the old parallax
// gradient grounds are retired with the panel-era page).
export function Section({ id, kicker, heading, sub, children, className, tone = 'plain', align = 'left' }: SectionProps) {
  const centered = align === 'center'
  return (
    <section id={id} className={cn(tone === 'wash' && 'bg-surface', className)}>
      <div className={cn('mx-auto max-w-6xl px-6 py-20 sm:py-[88px]', centered && 'flex flex-col items-center text-center')}>
        {kicker ? <p className="mkt-kicker m-0">{kicker}</p> : null}
        <h2 className={cn('mkt-display mkt-h2 mt-3.5 max-w-[22ch] text-balance text-foreground', !centered && 'max-w-3xl')}>
          {heading}
        </h2>
        {sub ? (
          <p className={cn('mt-4 max-w-[56ch] text-pretty text-[17px] leading-[1.6] text-muted-foreground')}>{sub}</p>
        ) : null}
        {children ? <div className="mt-12 w-full">{children}</div> : null}
      </div>
    </section>
  )
}
