import { beforeEach, describe, expect, it, vi } from 'vitest'

// ADR-053 unit tests: the pure/lib layer of the referral system — code
// generation, the salted IP hash, the link, and readReferralStatus's derived
// fields (toNextReward / outOfSessions) over a stubbed RLS client. The live
// DB pieces (record_referral's tranche math, start_session's bonus spend,
// export/erasure membership) are covered by the SQL itself + the extended
// account.test.ts integration suite.

vi.mock('server-only', () => ({}))

const { generateReferralCode, referralLink, readReferralStatus, REFERRALS_PER_REWARD, REFERRAL_REWARD_SESSIONS, SIGNUP_IP_ACCOUNT_LIMIT } =
  await import('../lib/referral/referral')
const { hashSignupIp, clientIp } = await import('../lib/referral/ip-hash')

describe('generateReferralCode', () => {
  it('is 8 chars from the unambiguous alphabet (no I/L/O/0/1)', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateReferralCode()
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/)
    }
  })

  it('does not repeat across a small sample (sanity, not proof)', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateReferralCode()))
    expect(seen.size).toBe(200)
  })
})

describe('referralLink', () => {
  it('points the code at /signup?ref= on the site base', () => {
    expect(referralLink('ABCD2345')).toMatch(/\/signup\?ref=ABCD2345$/)
  })
})

describe('constants', () => {
  it('encode the shipped offer: 3 friends -> 10 sessions, 2 accounts per network', () => {
    expect(REFERRALS_PER_REWARD).toBe(3)
    expect(REFERRAL_REWARD_SESSIONS).toBe(10)
    expect(SIGNUP_IP_ACCOUNT_LIMIT).toBe(2)
  })
})

describe('hashSignupIp', () => {
  beforeEach(() => {
    process.env.URL_HASH_SALT = 'test-salt'
  })

  it('is deterministic for the same IP and salt', () => {
    expect(hashSignupIp('203.0.113.9')).toBe(hashSignupIp('203.0.113.9'))
    expect(hashSignupIp('203.0.113.9')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('differs across IPs', () => {
    expect(hashSignupIp('203.0.113.9')).not.toBe(hashSignupIp('203.0.113.10'))
  })

  it('is domain-separated from the page-domain hash sharing the same salt', async () => {
    // hashPageDomain('x') and hashSignupIp('x') must never collide — the
    // signup-ip: prefix keeps the two uses of URL_HASH_SALT in disjoint
    // input spaces.
    const { hashPageDomain } = await import('../lib/privacy/url-hash')
    expect(hashSignupIp('example.com')).not.toBe(hashPageDomain('example.com'))
  })

  it('fails open (null) on a missing IP or salt', () => {
    expect(hashSignupIp(null)).toBeNull()
    expect(hashSignupIp('')).toBeNull()
    delete process.env.URL_HASH_SALT
    expect(hashSignupIp('203.0.113.9')).toBeNull()
  })
})

describe('clientIp', () => {
  it('takes the first x-forwarded-for entry, then x-real-ip, else null', () => {
    expect(
      clientIp(new Request('http://x', { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } }))
    ).toBe('203.0.113.9')
    expect(clientIp(new Request('http://x', { headers: { 'x-real-ip': '198.51.100.4' } }))).toBe(
      '198.51.100.4'
    )
    expect(clientIp(new Request('http://x'))).toBeNull()
  })
})

// A minimal chainable stub of the three RLS reads readReferralStatus makes:
// users (maybeSingle), referral count, sessions count.
function stubClient({
  user,
  referralCount,
  completedSessions,
}: {
  user: Record<string, unknown> | null
  referralCount: number
  completedSessions: number
}) {
  return {
    from(table: string) {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: user, error: null }) }),
          }),
        }
      }
      if (table === 'referral') {
        return {
          select: () => ({
            eq: async () => ({ count: referralCount, error: null }),
          }),
        }
      }
      return {
        select: () => ({
          eq: () => ({
            not: () => ({
              is: async () => ({ count: completedSessions, error: null }),
            }),
          }),
        }),
      }
    },
  } as never
}

describe('readReferralStatus', () => {
  const baseUser = {
    referral_code: 'ABCD2345',
    referral_bonus_sessions: 0,
    referral_rewards_granted: 0,
    subscription_tier: 'free',
    free_session_count: 3,
  }

  it('derives toNextReward from the count modulo the reward size', async () => {
    const status = await readReferralStatus(
      stubClient({ user: baseUser, referralCount: 4, completedSessions: 2 }),
      'u1'
    )
    expect(status).not.toBeNull()
    expect(status!.referralCount).toBe(4)
    expect(status!.toNextReward).toBe(2) // 4 % 3 = 1 toward the next tranche
    expect(status!.link).toMatch(/ref=ABCD2345$/)
  })

  it('flags outOfSessions only when free, at the cap, AND bonus-empty', async () => {
    const capped = { ...baseUser, free_session_count: 10 }
    expect(
      (await readReferralStatus(stubClient({ user: capped, referralCount: 0, completedSessions: 0 }), 'u1'))!
        .outOfSessions
    ).toBe(true)
    expect(
      (
        await readReferralStatus(
          stubClient({ user: { ...capped, referral_bonus_sessions: 5 }, referralCount: 0, completedSessions: 0 }),
          'u1'
        )
      )!.outOfSessions
    ).toBe(false)
    expect(
      (
        await readReferralStatus(
          stubClient({ user: { ...capped, subscription_tier: 'pro' }, referralCount: 0, completedSessions: 0 }),
          'u1'
        )
      )!.outOfSessions
    ).toBe(false)
    expect(
      (await readReferralStatus(stubClient({ user: baseUser, referralCount: 0, completedSessions: 0 }), 'u1'))!
        .outOfSessions
    ).toBe(false)
  })

  it('returns a null link until a code exists', async () => {
    const status = await readReferralStatus(
      stubClient({ user: { ...baseUser, referral_code: null }, referralCount: 0, completedSessions: 0 }),
      'u1'
    )
    expect(status!.code).toBeNull()
    expect(status!.link).toBeNull()
  })

  it('returns null (fail closed to "no status") when the user row is missing', async () => {
    expect(
      await readReferralStatus(stubClient({ user: null, referralCount: 0, completedSessions: 0 }), 'u1')
    ).toBeNull()
  })
})
