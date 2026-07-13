import Link from 'next/link'
import type { Metadata } from 'next'
import { bricolage } from '@/components/marketing/fonts'
import '@/components/marketing/marketing.css'

// Sprint 19 Task 3 (ADR-046): minimal beta terms — a beta disclaimer,
// acceptable use, and a no-warranty clause. Same marketing token layer and
// public treatment as /privacy (web/proxy.ts PUBLIC_PATHS). This is a beta
// disclaimer, NOT counsel-drafted terms of service (a pre-GA item if ever —
// ADR-046).
//
// Server component, public (no auth). Header/footer are inlined to match
// /privacy without pulling in the landing page's scroll-anchored Nav/Footer.

export const metadata: Metadata = {
  title: 'Terms of Use — Calyxa',
  description: 'The terms for using the Calyxa private beta.',
}

const LAST_UPDATED = 'July 12, 2026'

function Header() {
  return (
    <header className="w-full border-b border-border">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center">
          <img src="/logo.svg" alt="Calyxa" className="h-6 w-auto" />
        </Link>
        <Link
          href="/login"
          className="text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          Log in
        </Link>
      </div>
    </header>
  )
}

function LegalFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-3xl flex-col gap-2 px-6 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>&copy; {new Date().getFullYear()} Calyxa. All rights reserved.</span>
        <span className="flex gap-6">
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-foreground">
            Terms
          </Link>
          <Link href="/" className="hover:text-foreground">
            Home
          </Link>
        </span>
      </div>
    </footer>
  )
}

export default function TermsPage() {
  return (
    <div className={`${bricolage.variable} mkt min-h-svh bg-background`}>
      <Header />

      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="mkt-kicker m-0">Terms</p>
        <h1 className="mkt-display mkt-h2 mt-3 mb-0 text-foreground">Terms of Use</h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated {LAST_UPDATED}</p>

        <div className="mt-10 flex flex-col gap-12 text-[0.9375rem] leading-relaxed text-muted-foreground">
          <section className="flex flex-col gap-4">
            <p className="m-0">
              By using Calyxa, you agree to these terms. Calyxa is an AI math tutor provided
              as a browser extension. Please also read our{' '}
              <Link
                href="/privacy"
                className="font-medium text-accent-emphasis underline-offset-4 hover:underline"
              >
                Privacy Policy
              </Link>
              , which explains what we collect and how you can export or delete it.
            </p>
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="mkt-display m-0 text-xl text-foreground">This is a beta</h2>
            <p className="m-0">
              Calyxa is currently in a private, invite-only beta. That means it is
              pre-release software: features may change, break, or be removed, and it may be
              unavailable at times. We may change or discontinue the beta, and limit or end
              access, at any time.
            </p>
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="mkt-display m-0 text-xl text-foreground">Acceptable use</h2>
            <p className="m-0">When using Calyxa, you agree not to:</p>
            <ul className="m-0 flex list-disc flex-col gap-2 pl-5">
              <li>use it for anything unlawful, or to harm, harass, or infringe on others;</li>
              <li>
                attempt to break, overload, reverse-engineer, or gain unauthorized access to
                the service or other users&rsquo; data;
              </li>
              <li>
                share your invite or account so that people outside the beta gain access; or
              </li>
              <li>
                misrepresent the tutor&rsquo;s output as your own where doing so would
                violate your school&rsquo;s or institution&rsquo;s rules.
              </li>
            </ul>
            <p className="m-0">
              Calyxa is a learning aid meant to help you understand and solve problems
              yourself. You are responsible for how you use its guidance, including under any
              academic-integrity rules that apply to you.
            </p>
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="mkt-display m-0 text-xl text-foreground">Your account</h2>
            <p className="m-0">
              You must meet the minimum age shown at signup and provide accurate information.
              You are responsible for keeping your login secure. You can delete your account
              and data at any time from your{' '}
              <Link
                href="/account"
                className="font-medium text-accent-emphasis underline-offset-4 hover:underline"
              >
                account settings
              </Link>
              .
            </p>
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="mkt-display m-0 text-xl text-foreground">No warranty</h2>
            <p className="m-0">
              Calyxa is provided &ldquo;as is,&rdquo; without warranties of any kind. It is an
              AI tutor and can be wrong — do not rely on it as your sole source for graded
              work or important decisions, and verify anything that matters. To the fullest
              extent permitted by law, we are not liable for any damages arising from your
              use of the beta.
            </p>
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="mkt-display m-0 text-xl text-foreground">Changes to these terms</h2>
            <p className="m-0">
              We may update these terms as the product evolves. If we make material changes,
              we will update this page and the &ldquo;Last updated&rdquo; date above.
            </p>
          </section>
        </div>
      </main>

      <LegalFooter />
    </div>
  )
}
