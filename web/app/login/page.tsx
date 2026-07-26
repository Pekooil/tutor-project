import { AuthPanel } from '@/components/auth/AuthPanel'
import '@/components/marketing/marketing.css'

// /login — the same panel as /signup, opened in SIGN-IN mode. Both routes are
// kept so every existing link kicks to the right default: the extension, the
// proxy's signed-out redirect and the nav all point here for returning users,
// while /start → /signup carries new ones.
export default function LoginPage() {
  return <AuthPanel initialMode="signin" />
}
