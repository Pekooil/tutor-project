export const CONSENT_VERSION = '2026-06-01'
export const MIN_AGE = 13

// Coarse, year-only by design (ADR-004): we collect birth year, not full DOB.
export function meetsMinAge(birthYear: number, now = new Date()): boolean {
  return now.getFullYear() - birthYear >= MIN_AGE
}
