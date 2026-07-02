import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Pure text parsing, no DOM needed — extracts every custom-property name
// declared in theme.css (comments stripped first so prose that happens to
// mention a token name, e.g. "--color-accent is dark now", never
// false-positives as a declaration).
const __dirname = dirname(fileURLToPath(import.meta.url));
const themeCss = readFileSync(resolve(__dirname, './theme.css'), 'utf-8');
const withoutComments = themeCss.replace(/\/\*[\s\S]*?\*\//g, '');
const tokenNames = Array.from(
  new Set(Array.from(withoutComments.matchAll(/(--[a-z0-9-]+)\s*:/gi)).map((m) => m[1])),
).sort();

describe('@calyxa/ui theme tokens', () => {
  it('exposes a stable named token set (snapshot guards renames/removals)', () => {
    expect(tokenNames).toMatchSnapshot();
  });

  it('exposes the overlay system-font token', () => {
    // The overlay can never load a web font (host-DOM-mutation risk) — this
    // is also its permanent font, per ADR-018.
    expect(tokenNames).toContain('--font-sans');
  });

  it('exposes the AA-documented color roles every surface relies on', () => {
    for (const name of [
      '--color-accent',
      '--color-accent-foreground',
      '--color-background',
      '--color-surface',
      '--color-foreground',
      '--color-muted-foreground',
      '--color-danger',
      '--color-danger-foreground',
      '--color-focus-ring',
      '--color-border',
      '--color-border-strong',
    ]) {
      expect(tokenNames).toContain(name);
    }
  });

  it('exposes the reduced-motion-safe motion tokens', () => {
    for (const name of ['--motion-duration-fast', '--motion-duration-base', '--motion-ease-out']) {
      expect(tokenNames).toContain(name);
    }
  });
});
