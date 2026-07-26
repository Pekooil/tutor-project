import { AuthPanel } from '@/components/auth/AuthPanel'
import '@/components/marketing/marketing.css'

// /signup — the account-creation entry, and the last step of onboarding
// workflow 1 before /install. Renders AuthPanel in SIGN-UP mode: first/last
// name, email, password, short consent. Sign-in is one click away in the panel
// itself, so an existing user who lands here is never stuck.
//
// marketing.css is imported here (not in the component) because AuthPanel
// renders under `.mkt` and needs the landing design system's tokens and display
// face — the same arrangement /start uses.
export default function SignupPage() {
  return <AuthPanel initialMode="signup" />
}
