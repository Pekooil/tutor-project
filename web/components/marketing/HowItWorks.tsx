import { BookOpen, Mic, Puzzle, type LucideIcon } from 'lucide-react'
import { Section } from '@/components/marketing/Section'

// Sprint 20 Task 8: three numbered steps, one icon + one line each — installs
// the mental model right before Pricing. Static and server-rendered; no
// motion here is intentional (the gate is "reads in under ten seconds," not
// "plays a scene").
const STEPS: { icon: LucideIcon; label: string }[] = [
  { icon: Puzzle, label: 'Add Calyxa to Chrome' },
  { icon: BookOpen, label: 'Open any math page' },
  { icon: Mic, label: 'Start talking' },
]

export function HowItWorks() {
  return (
    <Section id="how-it-works" kicker="How it works" heading="Three steps to your first session.">
      <ol className="grid gap-6 sm:grid-cols-3">
        {STEPS.map(({ icon: Icon, label }, index) => (
          <li key={label} className="rounded-md border border-border bg-surface p-6">
            <div className="flex items-center gap-3">
              <Icon aria-hidden="true" className="h-5 w-5 flex-none text-accent-emphasis" />
              <span className="text-sm font-semibold text-accent-emphasis">{index + 1}</span>
            </div>
            <p className="mt-3 font-medium text-foreground">{label}</p>
          </li>
        ))}
      </ol>
    </Section>
  )
}
