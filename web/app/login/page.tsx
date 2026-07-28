import type { Metadata } from 'next'
import { AuthPanel } from '@/components/auth/AuthPanel'
import '@/components/marketing/marketing.css'

// /login — the same panel as /signup, opened in SIGN-IN mode. Both routes are
// kept so every existing link kicks to the right default: the extension, the
// proxy's signed-out redirect and the nav all point here for returning users,
// while /start → /signup carries new ones.
export const metadata: Metadata = {
  title: 'Log in — Calyxa',
  description: 'Log in to your Calyxa account.',
  // Renders the identical AuthPanel as /signup (just a different initial
  // mode) — Google flagged it as a duplicate with no canonical winner.
  // noindex rather than a canonical to /signup: this page serves a distinct
  // functional purpose (returning-user sign-in, hit via the proxy's
  // signed-out redirect) rather than being interchangeable content.
  robots: { index: false, follow: true },
}

export default function LoginPage() {
  return <AuthPanel initialMode="signin" />
}
