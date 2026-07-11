#!/usr/bin/env node
// scripts/check-no-secrets.mjs — Sprint 18 Task 3 (ADR-044).
//
// Proves the locked invariant "never put any key in the extension bundle"
// against the BUILT artifact, not the source. Source greps are necessary but
// not sufficient — a key can arrive via an env inline at build time — so this
// scans the emitted bundle at extension/dist/chrome-mv3.
//
// Two independent checks:
//   (1) VALUE scan — for each secret env var below that is SET, grep every
//       bundle file for its exact value. This is the real proof: a value
//       inlined at build is caught even though the source never names it.
//       (In CI the job's env supplies the real values; see ci.yml.)
//   (2) LITERAL backstop — provider key shapes, monitoring/Sentry DSN shapes,
//       and the secret env-var NAMES. These catch a leak even in a local run
//       where the real values aren't in the environment, and catch a value
//       whose length dipped below the VALUE-scan floor.
//
// Any hit exits 1 and fails the job. Secret values are NEVER printed — only
// the secret's name/pattern and the offending file (with a masked preview).
//
// Run locally too:  node scripts/check-no-secrets.mjs
// (Build the extension first: `npm --prefix extension run build`.)

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const bundleDir = join(repoRoot, 'extension', 'dist', 'chrome-mv3')

// Only text files can carry an inlined secret; skip images/fonts/binaries.
const TEXT_EXTS = new Set(['.js', '.mjs', '.cjs', '.html', '.json', '.css', '.map', '.txt'])

// Secret env vars whose VALUES must never appear in the bundle. The three
// provider keys + the Sprint 17 monitoring DSN are the plan's named set;
// SUPABASE_SERVICE_ROLE_KEY is added defensively (it is the highest-severity
// key and the extension holds no Supabase credential at all). Public,
// browser-safe values (NEXT_PUBLIC_*, the anon key) are deliberately NOT
// listed — they are allowed to be shipped.
const SECRET_VALUE_VARS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'ELEVENLABS_API_KEY',
  'MONITORING_DSN',
  'SUPABASE_SERVICE_ROLE_KEY',
]

// A value must be at least this long to be VALUE-scanned — guards against a
// short/blank env var matching innocuous bundle substrings.
const MIN_VALUE_LEN = 12

// Literal backstop patterns. Kept specific enough not to fire on a legit
// minified bundle (content hashes, etc.): provider keys require long tails,
// the DSN requires the Sentry ingest shape, and the env NAMES never appear in
// the extension's own code by design.
const LITERAL_PATTERNS = [
  { name: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'openai-key', re: /sk-(?:proj-)?[A-Za-z0-9]{32,}/ },
  { name: 'elevenlabs-key', re: /sk_[a-f0-9]{40,}/ },
  { name: 'elevenlabs-header', re: /xi-api-key/i },
  { name: 'sentry-dsn', re: /https:\/\/[A-Za-z0-9]+@[A-Za-z0-9.-]*ingest\.[A-Za-z0-9.-]*sentry\.io\/[0-9]+/ },
  { name: 'sentry-ingest-host', re: /[A-Za-z0-9-]+\.ingest\.[A-Za-z0-9.-]*sentry\.io/ },
  { name: 'secret-var-name', re: /\b(?:ANTHROPIC_API_KEY|OPENAI_API_KEY|ELEVENLABS_API_KEY|SUPABASE_SERVICE_ROLE_KEY|MONITORING_DSN)\b/ },
]

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (TEXT_EXTS.has(extname(full).toLowerCase())) out.push(full)
  }
  return out
}

// Reveal only enough to locate the leak, never the secret itself.
function mask(s) {
  if (s.length <= 4) return '*'.repeat(s.length)
  return `${s.slice(0, 4)}…(${s.length} chars)`
}

function main() {
  if (!existsSync(bundleDir)) {
    console.error(`✖ Bundle not found at ${relative(repoRoot, bundleDir)}.`)
    console.error('  Build it first: npm --prefix extension run build')
    process.exit(1)
  }

  const files = walk(bundleDir)
  if (files.length === 0) {
    console.error(`✖ No scannable text files under ${relative(repoRoot, bundleDir)} — did the build emit anything?`)
    process.exit(1)
  }

  // Resolve which secret VALUES are actually available to scan for.
  const activeValues = []
  const skippedVars = []
  for (const name of SECRET_VALUE_VARS) {
    const v = process.env[name]
    if (v && v.length >= MIN_VALUE_LEN) activeValues.push({ name, value: v })
    else skippedVars.push(name)
  }

  const findings = []

  for (const file of files) {
    const rel = relative(repoRoot, file)
    const content = readFileSync(file, 'utf8')

    for (const { name, value } of activeValues) {
      if (content.includes(value)) {
        findings.push({ kind: 'value', label: name, file: rel, preview: mask(value) })
      }
    }
    for (const { name, re } of LITERAL_PATTERNS) {
      const m = content.match(re)
      if (m) findings.push({ kind: 'literal', label: name, file: rel, preview: mask(m[0]) })
    }
  }

  console.log(`Scanned ${files.length} text file(s) in ${relative(repoRoot, bundleDir)}.`)
  console.log(`VALUE scan active for: ${activeValues.map((v) => v.name).join(', ') || '(none — no secret values in env)'}`)
  if (skippedVars.length) {
    console.log(`VALUE scan skipped (unset/blank/too-short in env): ${skippedVars.join(', ')}`)
  }

  if (findings.length > 0) {
    console.error(`\n✖ SECRET LEAK: ${findings.length} match(es) in the built extension bundle:`)
    for (const f of findings) {
      console.error(`  - [${f.kind}] ${f.label} in ${f.file}  (match: ${f.preview})`)
    }
    console.error('\nThe extension bundle must never contain any provider key or the monitoring DSN')
    console.error('(locked architecture / ADR-044). Investigate before merging.')
    process.exit(1)
  }

  console.log('\n✓ No provider key value, monitoring DSN, or secret literal found in the bundle.')
  if (activeValues.length === 0) {
    console.log('  NOTE: no secret values were in the environment, so only the literal backstop ran.')
    console.log('  CI runs this with the real values in env — that is where the VALUE proof happens.')
  }
}

main()
