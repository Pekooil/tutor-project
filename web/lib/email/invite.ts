import 'server-only'

// Sprint 19 / Task 6 (ADR-045): the invite send path — the ONE new external
// capability this sprint adds.
//
// DECISION (resolves ADR-045's "Supabase Auth's invite/magic-link if it fits,
// else a minimal transactional provider"): Supabase's invite does NOT fit. Our
// invite email must carry the UNLISTED STORE LINK + the invite CODE — the
// tester installs the extension from the link, then signs up through our OWN
// age-gate/consent/allowlist flow (Task 5) — not a magic link into the web app,
// and it must NOT pre-create an auth user (Supabase's inviteUserByEmail does
// both). So we send a custom transactional email via a minimal provider
// (Resend) over plain `fetch` — NO SDK dependency, one server-only credential.
// Swapping providers is a one-function change: the endpoint, the auth header,
// and the request body below are the only provider-specific lines.
//
// SERVER-ONLY + credential-from-env: `server-only` makes any client import a
// build error, and the Sprint 18 no-secret bundle gate covers RESEND_API_KEY
// (it never reaches the extension). An ABSENT credential is a NO-OP (logs +
// returns not-sent), NEVER a throw — dev-safe, and the admin route's
// manual-send batch is always the fallback.

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export type SendInviteResult =
  | { sent: true }
  | { sent: false; reason: 'no-credential' | 'error' }

export async function sendInvite(
  email: string,
  code: string,
  storeLink: string | null
): Promise<SendInviteResult> {
  const apiKey = process.env.RESEND_API_KEY
  // A verified sender, e.g. `Calyxa <invites@your-domain>`. Required — Resend
  // rejects an unverified from-address, so treat it as part of the credential.
  const from = process.env.INVITE_FROM_EMAIL

  if (!apiKey || !from) {
    // Dev-safe no-op: no send credential configured. The caller falls back to
    // the manual-send batch. Never throws.
    console.info('[invite] RESEND_API_KEY/INVITE_FROM_EMAIL absent — send skipped (no-op).')
    return { sent: false, reason: 'no-credential' }
  }

  const link = storeLink ?? '(the Calyxa Chrome Web Store link — pending)'
  const subject = "You're invited to the Calyxa beta"
  const text = [
    "You're in — welcome to the Calyxa private beta.",
    '',
    `1. Install the extension: ${link}`,
    `2. Sign up, and enter this invite code when asked: ${code}`,
    '',
    'Your code is tied to your invite — please keep it to yourself.',
    '',
    '— The Calyxa team',
  ].join('\n')

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from, to: email, subject, text }),
    })
    if (!res.ok) {
      // Swallow a provider failure to a result — one bad send must not crash a
      // whole batch. The row was still marked invited (Task 5) and can be
      // re-sent or handled via the manual batch. Log without the recipient's
      // address/code (privacy — same discipline as ADR-043's scrub).
      console.error(`[invite] send failed for a recipient: HTTP ${res.status}`)
      return { sent: false, reason: 'error' }
    }
    return { sent: true }
  } catch (err) {
    console.error('[invite] send threw, swallowed:', err instanceof Error ? err.message : 'unknown')
    return { sent: false, reason: 'error' }
  }
}
