import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LogoutButton } from './logout-button'
import { DeleteAccountButton } from './delete-account-button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

export default async function AccountPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('users')
    .select('email, subscription_tier, age_verified, gdpr_consent_version')
    .eq('id', user.id)
    .single()

  return (
    <div className="flex flex-col gap-6">
      {profile ? (
        <>
          <Card>
            <CardHeader>
              <h1 className="text-xl leading-none font-semibold">Your account</h1>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Email</dt>
                <dd className="text-foreground">{profile.email}</dd>
                <dt className="text-muted-foreground">Tier</dt>
                <dd className="text-foreground">{profile.subscription_tier}</dd>
              </dl>
            </CardContent>
          </Card>

          <Card className="bg-surface">
            <CardHeader>
              <h2 className="text-sm leading-none font-medium text-muted-foreground">Account details</h2>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Age verified</dt>
                <dd className="text-foreground">{profile.age_verified ? 'Yes' : 'No'}</dd>
                <dt className="text-muted-foreground">Consent version</dt>
                <dd className="text-foreground">{profile.gdpr_consent_version}</dd>
              </dl>
            </CardContent>
          </Card>

          <Card className="bg-surface">
            <CardHeader>
              <h2 className="text-sm leading-none font-medium text-muted-foreground">Data &amp; privacy</h2>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <div className="flex flex-col items-start gap-2">
                <p className="text-sm text-muted-foreground">
                  Download everything Calyxa holds about you — sessions, mastery history,
                  misconceptions, and your reinforcement schedule — as a JSON file.
                </p>
                <Button asChild variant="outline">
                  <a href="/api/account/export" download>
                    Export my data
                  </a>
                </Button>
              </div>
              <div className="flex flex-col items-start gap-2">
                <p className="text-sm text-muted-foreground">
                  Permanently deletes your account and everything tied to it. This cannot be
                  undone.
                </p>
                <DeleteAccountButton />
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <Alert variant="destructive">
          <AlertDescription>We couldn&apos;t load your account details.</AlertDescription>
        </Alert>
      )}

      <div>
        <LogoutButton />
      </div>
    </div>
  )
}
