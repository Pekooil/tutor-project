import Link from 'next/link'
import type { Metadata } from 'next'
import { bricolage } from '@/components/marketing/fonts'
import '@/components/marketing/marketing.css'

// Sprint 19 Task 3 (ADR-046): the hosted privacy policy — a HARD Chrome Web
// Store requirement, and the human-readable half of the data-safety
// disclosure (docs/data-safety-disclosure.md). Generated from the ACTUAL
// verified collection surface (Sprints 03/16/17), truthful by construction:
// every row below maps to a real table/column, and nothing collected is
// omitted. If a future sprint adds collection (Sprint 21 artifacts, Sprint 23
// billing), THIS page + the data-safety doc + the CWS form must all be
// updated before it ships to beta users (ADR-046).
//
// Server component, public (no auth — see web/proxy.ts PUBLIC_PATHS). Rendered
// inside the `.mkt` marketing token layer so it matches the landing page's
// voice without pulling in the Nav/Footer's landing-only scroll anchors.

export const metadata: Metadata = {
  title: 'Privacy Policy — Calyxa',
  description:
    'What Calyxa collects, why, how long we keep it, and how you export or delete it. Audio is never stored; page identifiers are hashed; telemetry carries no content.',
}

// Effective date is the date the policy was written, not render time — a
// legal document should not silently change its own date on every request.
const LAST_UPDATED = 'July 12, 2026'

// Support/privacy contact (Darcy, 2026-07-12).
const PRIVACY_CONTACT = 'calyxasupport@gmail.com'

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

// One collected-data row: what, why, and where it lives (kept honest against
// the schema — see the comment map in docs/data-safety-disclosure.md).
function DataRow({ what, why }: { what: string; why: string }) {
  return (
    <li className="border-b border-(--mkt-border-faint) py-4 last:border-b-0">
      <p className="m-0 font-medium text-foreground">{what}</p>
      <p className="m-0 mt-1 text-sm text-muted-foreground">{why}</p>
    </li>
  )
}

export default function PrivacyPage() {
  return (
    <div className={`${bricolage.variable} mkt min-h-svh bg-background`}>
      <Header />

      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="mkt-kicker m-0">Privacy</p>
        <h1 className="mkt-display mkt-h2 mt-3 mb-0 text-foreground">Privacy Policy</h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated {LAST_UPDATED}</p>

        <div className="mt-10 flex flex-col gap-12 text-[0.9375rem] leading-relaxed text-muted-foreground">
          <section className="flex flex-col gap-4">
            <p className="m-0">
              Calyxa is an AI math tutor that runs as a browser extension. This policy
              explains exactly what we collect, why, how long we keep it, and how you can
              see or delete it. We built the product so that the most sensitive things are{' '}
              <span className="font-medium text-foreground">
                never collected in the first place
              </span>
              : your voice is never stored, the pages you visit are recorded only as a
              one-way hash, and our usage metrics carry no personal content.
            </p>
            <p className="m-0">
              Calyxa is currently in a private, invite-only beta.
            </p>
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="mkt-display m-0 text-xl text-foreground">What we collect, and why</h2>
            <ul className="m-0 list-none p-0">
              <DataRow
                what="Account email and password"
                why="To create and secure your account. Authentication is handled by our provider (Supabase); we do not store your raw password. If you join the waitlist before signing up, we keep only your email until you either sign up or ask us to remove it."
              />
              <DataRow
                what="Birth year"
                why="To confirm you meet the minimum age to use Calyxa. We store the year only — not a full date of birth — alongside a flag that the age check passed."
              />
              <DataRow
                what="Consent record"
                why="A timestamp and version marking the privacy terms you agreed to at signup, so we have a record of the consent you gave (GDPR)."
              />
              <DataRow
                what="Your learning profile"
                why="The heart of the tutor: an estimate of what you've mastered, the misconceptions you've shown, and when each topic is due for review. This is what lets Calyxa adapt to you instead of repeating a script."
              />
              <DataRow
                what="Session transcripts (text only)"
                why="The text of your tutoring turns — what you typed or said, and the tutor's replies — so a session has memory and your progress is scored. This is TEXT ONLY. Your microphone audio is transcribed in real time and never stored (see below)."
              />
              <DataRow
                what="A hashed page identifier"
                why="So the tutor knows you're working on the same problem across a session, we record a one-way HMAC hash of the page's domain — never the full URL, never the page contents. We cannot recover the site you were on from the hash."
              />
              <DataRow
                what="Product telemetry"
                why="A small set of strictly-typed events (e.g. a session started, a turn's latency, an onboarding completed) so we can tell whether the beta is working. By design these events carry NO free text, NO transcript, NO URL, and NO audio — only counts and timings."
              />
              <DataRow
                what="Feedback you choose to send"
                why="If you use the in-app feedback control, we keep the message and rating you wrote so we can fix issues. This is the one field where you type free text for us on purpose."
              />
            </ul>
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="mkt-display m-0 text-xl text-foreground">
              What we never collect, and never do
            </h2>
            <div className="mkt-card p-6">
              <ul className="m-0 flex list-disc flex-col gap-3 pl-5">
                <li>
                  <span className="font-medium text-foreground">
                    We never store your microphone audio.
                  </span>{' '}
                  Voice is streamed for real-time transcription and discarded — no recording
                  is ever written to disk.
                </li>
                <li>
                  <span className="font-medium text-foreground">
                    We never store the URLs or contents of the pages you visit.
                  </span>{' '}
                  Only a one-way hash of the domain, which cannot be reversed.
                </li>
                <li>
                  <span className="font-medium text-foreground">
                    Our metrics carry no personal content.
                  </span>{' '}
                  Telemetry is a fixed set of typed events with no room for a transcript,
                  question, or URL.
                </li>
                <li>
                  <span className="font-medium text-foreground">
                    We never sell your data or use it for advertising.
                  </span>
                </li>
                <li>
                  <span className="font-medium text-foreground">
                    No AI keys or secrets ever ship in the extension.
                  </span>{' '}
                  All calls to AI, speech-to-text, and text-to-speech go through our own
                  server.
                </li>
              </ul>
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="mkt-display m-0 text-xl text-foreground">Who we share it with</h2>
            <p className="m-0">
              We do not sell your data and we do not share it with third parties for their
              own purposes. To deliver the tutor, your data is processed by service
              providers acting only on our behalf (processors), under our server-side
              control:
            </p>
            <ul className="m-0 flex list-disc flex-col gap-2 pl-5">
              <li>
                <span className="font-medium text-foreground">Anthropic</span> — the AI model
                that generates tutoring replies (receives your session text, never audio).
              </li>
              <li>
                <span className="font-medium text-foreground">OpenAI</span> — real-time
                speech-to-text for voice input (transcribes audio in the moment; no
                recording is retained).
              </li>
              <li>
                <span className="font-medium text-foreground">ElevenLabs</span> — text-to-speech
                so the tutor can speak replies aloud.
              </li>
              <li>
                <span className="font-medium text-foreground">Supabase</span> — our database
                and authentication, where your account and learning profile are stored.
              </li>
              <li>
                <span className="font-medium text-foreground">Vercel</span> — hosting for our
                website and server.
              </li>
            </ul>
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="mkt-display m-0 text-xl text-foreground">How long we keep it</h2>
            <p className="m-0">
              Your account and learning data are kept until you delete them. Microphone
              audio is never persisted at all. When you delete your account, everything tied
              to it — sessions, mastery history, misconceptions, reinforcement schedule,
              telemetry, and feedback — is queued for permanent deletion and removed after a
              short grace window.
            </p>
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="mkt-display m-0 text-xl text-foreground">
              Your data is yours — export and delete
            </h2>
            <p className="m-0">
              You can download everything Calyxa holds about you as a JSON file, or
              permanently delete your account and all associated data, at any time from your
              account settings.
            </p>
            <p className="m-0">
              <Link
                href="/account"
                className="font-medium text-accent-emphasis underline-offset-4 hover:underline"
              >
                Manage your data in account settings →
              </Link>
            </p>
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="mkt-display m-0 text-xl text-foreground">Age</h2>
            <p className="m-0">
              Calyxa checks your age at signup and is not intended for children under the
              minimum age we enforce there. If we learn we have collected data from someone
              under that age, we will delete it.
            </p>
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="mkt-display m-0 text-xl text-foreground">How we protect it</h2>
            <p className="m-0">
              All data is encrypted in transit (HTTPS/TLS) to our server and database.
              Access to your rows is isolated per account at the database level, and all
              provider API keys live only on our server — never in the extension you install.
            </p>
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="mkt-display m-0 text-xl text-foreground">Changes to this policy</h2>
            <p className="m-0">
              If we change what we collect, we will update this page and the &ldquo;Last
              updated&rdquo; date above before the change takes effect.
            </p>
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="mkt-display m-0 text-xl text-foreground">Contact</h2>
            <p className="m-0">
              Questions about your privacy? Email us at{' '}
              <a
                href={`mailto:${PRIVACY_CONTACT}`}
                className="font-medium text-accent-emphasis underline-offset-4 hover:underline"
              >
                {PRIVACY_CONTACT}
              </a>
              .
            </p>
          </section>
        </div>
      </main>

      <LegalFooter />
    </div>
  )
}
