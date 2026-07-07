import { BookOpen, Mic, Puzzle, type LucideIcon } from 'lucide-react'
import { Section } from '@/components/marketing/Section'

// Three numbered steps — installs the mental model right before Pricing.
// Redesigned from grey boxes to Linear-style open rows: hairline top rule,
// oversized ghost display numeral (decorative — the <ol> carries the real
// order), icon + one line. Static and server-rendered; no motion here is
// intentional (the gate is "reads in under ten seconds," not "plays a
// scene").
const STEPS: { icon: LucideIcon; label: string }[] = [
  { icon: Puzzle, label: 'Add Calyxa to Chrome' },
  { icon: BookOpen, label: 'Open any math page' },
  { icon: Mic, label: 'Start talking' },
]

export function HowItWorks() {
  return (
    <Section id="how-it-works" kicker="How it works" heading="Three steps to your first session.">
      <ol className="grid gap-x-10 gap-y-12 sm:grid-cols-3">
        {STEPS.map(({ icon: Icon, label }, index) => (
          <li key={label} className="border-t border-(--mkt-border-faint) pt-6">
            <p aria-hidden="true" className="mkt-ghost-numeral m-0">
              {String(index + 1).padStart(2, '0')}
            </p>
            <div className="mt-5 flex items-center gap-3">
              <Icon aria-hidden="true" className="h-5 w-5 flex-none text-accent-emphasis" />
              <p className="m-0 text-lg font-medium text-foreground">{label}</p>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  )
}
