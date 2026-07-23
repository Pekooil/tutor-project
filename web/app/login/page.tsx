import { AuthPanel } from '@/components/auth/AuthPanel'

// Unified auth entry (Part 1): /login and /signup both render the same panel —
// one Google button + one email/password form that signs in an existing account
// or creates a new one. Keeping both routes preserves every existing link and
// the /start wizard → /signup handoff.
export default function LoginPage() {
  return <AuthPanel />
}
