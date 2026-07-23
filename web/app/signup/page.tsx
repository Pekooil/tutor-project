import { AuthPanel } from '@/components/auth/AuthPanel'

// Unified auth entry (Part 1): /signup and /login both render the same panel.
// The /start wizard and the extension's "create a free account" links point
// here; AuthPanel reads the carried referral code + preflight answers itself.
export default function SignupPage() {
  return <AuthPanel />
}
