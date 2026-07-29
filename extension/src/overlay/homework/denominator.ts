// Denominator confirmation (spec §3). The scan finds every problem on the
// page; it cannot know which were assigned. This module turns "which ones?"
// into a subset in two seconds, and never as a form.
//
// Pure -- takes the enumerated labels, returns index selections.

export type QuickChip = {
  id: 'odds' | 'evens' | 'first-half';
  label: string;
  /** 0-based indexes into the enumeration. */
  indexes: number[];
};

/**
 * Whether a printed label is odd. Keyed on the PRINTED number, not the
 * position: a worksheet that starts at 7 means "odds" = 7, 9, 11, which is
 * what the student's teacher said, not every other row on screen.
 * Unparseable labels ("3b" parses as 3) fall back to position parity.
 */
function labelNumber(label: string, index: number): number {
  const match = /^(\d{1,3})/.exec(label);
  return match ? Number(match[1]) : index + 1;
}

/**
 * The quick chips, derived from the ACTUAL scan (spec §3: "show a chip only
 * when it produces a valid non-empty subset"). A chip that would select
 * everything, or nothing, is not offered -- "Odds" on a 1-problem page is
 * noise, and "All N" is already the primary button.
 */
export function buildQuickChips(labels: readonly string[]): QuickChip[] {
  const chips: QuickChip[] = [];
  const all = labels.map((_, index) => index);

  const odds = all.filter((index) => labelNumber(labels[index], index) % 2 === 1);
  const evens = all.filter((index) => labelNumber(labels[index], index) % 2 === 0);
  const firstHalf = all.slice(0, Math.floor(labels.length / 2));

  const usable = (indexes: number[]) => indexes.length > 0 && indexes.length < labels.length;

  if (usable(odds)) chips.push({ id: 'odds', label: 'Odds', indexes: odds });
  if (usable(evens)) chips.push({ id: 'evens', label: 'Evens', indexes: evens });
  if (usable(firstHalf)) chips.push({ id: 'first-half', label: 'First half', indexes: firstHalf });

  return chips;
}

/**
 * The range input (spec §3): accepts `1-12`, `3,5,7`, `1-6, 9, 11` -- any mix
 * of comma-separated ranges and singletons. Values name PRINTED labels, since
 * that is what a student reads off their assignment sheet; anything that
 * doesn't match a printed label is ignored rather than guessed at.
 *
 * Returns 0-based indexes in page order, deduped. An empty result means the
 * input selected nothing real -- the caller keeps the Adjust panel open rather
 * than confirming an empty set.
 */
export function parseRangeSelection(input: string, labels: readonly string[]): number[] {
  const byLabel = new Map<number, number>();
  labels.forEach((label, index) => {
    const number = labelNumber(label, index);
    if (!byLabel.has(number)) byLabel.set(number, index);
  });

  const picked = new Set<number>();
  for (const partRaw of input.split(',')) {
    const part = partRaw.trim();
    if (!part) continue;
    // Accept hyphen, en dash, and em dash -- students paste all three.
    const range = /^(\d{1,3})\s*[-–—]\s*(\d{1,3})$/.exec(part);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      const [low, high] = from <= to ? [from, to] : [to, from];
      for (let value = low; value <= high; value++) {
        const index = byLabel.get(value);
        if (index !== undefined) picked.add(index);
      }
      continue;
    }
    const single = /^(\d{1,3})$/.exec(part);
    if (single) {
      const index = byLabel.get(Number(single[1]));
      if (index !== undefined) picked.add(index);
    }
  }

  return [...picked].sort((a, b) => a - b);
}
