import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const { email, password } = await request.json()

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    return NextResponse.json({ error: error?.message ?? 'Login failed.' }, { status: 401 })
  }

  return NextResponse.json({ user: data.user })
}
