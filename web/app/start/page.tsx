import type { Metadata } from 'next'
import { PreflightWizard } from '@/components/onboarding/PreflightWizard'
import '@/components/marketing/marketing.css'

// /start — the pre-signup onboarding flow. The landing page's primary CTAs
// ("Add to Chrome — free") route here instead of straight to /signup: three
// quick questions → a personalized live demo → a recap → the existing signup
// form. See components/onboarding/PreflightWizard.tsx for the flow, and
// lib/onboarding/preflight.ts for the content + the sessionStorage handoff
// that carries the answers into /signup.

export const metadata: Metadata = {
  title: 'Get started — Calyxa',
  description: 'Three quick questions, then meet your tutor.',
  // Not a page we want indexed as a landing surface.
  robots: { index: false, follow: true },
}

export default function StartPage() {
  return <PreflightWizard />
}
