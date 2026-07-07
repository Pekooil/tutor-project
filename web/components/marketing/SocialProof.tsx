import { Section } from '@/components/marketing/Section'

// Structure ships, claims don't. Every quote and stat here is a placeholder
// — attributions say so explicitly rather than reading as a real (if
// anonymous) testimonial, and every stat is an unfilled dash rather than an
// invented number. TODO(launch): replace both constants below with real
// quotes and real numbers before any paid or public traffic — nothing here
// may go live as-is (see sprint-20-plan.md's handoff).
const PLACEHOLDER_QUOTES = [
  {
    quote: 'It walks me through the step instead of just giving me the answer.',
    attribution: 'Beta student — placeholder quote',
  },
  {
    quote: 'It caught my sign error before I even noticed it myself.',
    attribution: 'Beta student — placeholder quote',
  },
  {
    quote: 'Feels like a tutor who remembers what I struggled with last time.',
    attribution: 'Beta student — placeholder quote',
  },
] as const

const PLACEHOLDER_STATS = [
  { value: '—', label: 'Tutoring sessions run' },
  { value: '—', label: 'Students in the beta' },
  { value: '—', label: 'Average session rating' },
] as const

export function SocialProof() {
  return (
    <Section id="social-proof" kicker="From the beta" heading="What students are saying.">
      <div className="grid gap-6 sm:grid-cols-3">
        {PLACEHOLDER_QUOTES.map((item) => (
          <figure key={item.quote} className="mkt-card m-0 p-7">
            <blockquote className="m-0 text-lg leading-relaxed text-foreground">
              &ldquo;{item.quote}&rdquo;
            </blockquote>
            <figcaption className="mt-5 text-sm text-muted-foreground">{item.attribution}</figcaption>
          </figure>
        ))}
      </div>
      <div className="mt-12 grid gap-8 border-t border-(--mkt-border-faint) pt-12 sm:grid-cols-3">
        {PLACEHOLDER_STATS.map((stat) => (
          <div key={stat.label} className="text-center">
            <p className="mkt-display m-0 text-4xl text-foreground sm:text-5xl">{stat.value}</p>
            <p className="mt-2 text-sm text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </div>
    </Section>
  )
}
