// Test-env stub for the `server-only` guard package (Sprint 24, ADR-038).
// `server-only` throws when resolved outside a React Server Component build;
// under vitest we import server modules (claude.ts, provider.ts, cost-model.ts)
// directly to unit-test pure logic, so it is aliased to this no-op. The real
// Next.js build is unaffected — vitest.config's alias applies only to tests.
export {}
