import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FREE_SESSION_LIMIT } from '../lib/tier/session-gate'

// Sprint 16 / Task 8 (ADR-041): binds the two hand-mirrored constants so a
// future retune of one without the other fails the build instead of
// silently drifting -- exactly the failure mode Pricing.tsx's own comment
// flags (found already drifted, still "10", while retuning this for Task 4).
//
// Pricing.tsx isn't imported directly: it's a .tsx client component, and
// this project's vitest config (deliberately minimal -- an alias only, no
// React/JSX plugin, since every other suite here tests plain .ts modules)
// fails to parse its JSX at import time. Reading the source and extracting
// the exported constant by its exact declaration keeps this a real,
// drift-proof binding without adding a JSX toolchain to vitest just for one
// number.
const pricingSource = readFileSync(
  resolve(process.cwd(), 'components/marketing/Pricing.tsx'),
  'utf-8'
)

function extractFreeSessionsPerMonth(): number {
  const match = pricingSource.match(/export const FREE_SESSIONS_PER_MONTH = (\d+)/)
  if (!match) {
    throw new Error('FREE_SESSIONS_PER_MONTH not found in Pricing.tsx -- has it been renamed?')
  }
  return Number(match[1])
}

describe('Pricing marketing number vs the enforced free-tier limit', () => {
  it('renders the exact same number session-gate.ts enforces server-side', () => {
    expect(extractFreeSessionsPerMonth()).toBe(FREE_SESSION_LIMIT)
  })
})
