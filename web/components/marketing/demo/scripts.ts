import type { SceneScript } from './scene'

// The three scene scripts (Sprint 20 Task 4, ADR-031) — pure data, played
// by useSceneTimeline. All four scripts tell ONE story around the repo's
// fixture problem (x² + 5x + 6 = 0) so the hero, the scrollytelling beats,
// the profile section, and the study-loop section read as the same session
// seen from four angles. Copy or timing changes are edits HERE, never to
// the components.
//
// Annotation targets ('problem', 'term-b', 'term-c') are data-annot-target
// ids on DemoStage's fake math page. Color-linked phrases must reuse the
// exact on-page text (ADR-029's discipline, mirrored): a near-miss renders
// plain, never a guessed highlight.

// ── The hero's full session loop (~20s + rest) ──────────────────────────
// opening scan → annotation draws → guided turns → wrong step (bar eases
// back) → ping on the gap closing → solve (bar fills) → "Now closing
// tutoring session." → recap → rest → loop.
export const heroSession: SceneScript = {
  durationMs: 20500,
  restMs: 2800,
  steps: [
    {
      at: 300,
      do: {
        kind: 'strip',
        strip: {
          variant: 'overview',
          mastery: [
            { title: 'Factoring quadratics', value: 0.45 },
            { title: 'Distributive property', value: 0.72 },
            { title: 'Linear equations', value: 0.88 },
          ],
          workingThrough: 'Sign errors — flagged last session',
          due: 'Distributive property — due today',
        },
      },
    },
    { at: 900, do: { kind: 'waveform', active: true } },
    { at: 900, do: { kind: 'annotate', annotations: [{ id: 'eq', target: 'problem', color: 'amber' }] } },
    {
      at: 950,
      do: {
        kind: 'bubble',
        role: 'tutor',
        text: "Looks like you're working on x² + 5x + 6 = 0. Want to work through it together?",
        links: [{ phrase: 'x² + 5x + 6 = 0', color: 'amber' }],
      },
    },
    { at: 3300, do: { kind: 'waveform', active: false } },
    { at: 3900, do: { kind: 'bubble', role: 'student', text: "Yeah — I don't know where to start." } },
    // The overview strip auto-dismisses a few seconds in, exactly like the
    // real InsightStrip (Sprint 14) — it's a session-open glance, not a
    // fixture. The recap strip at the end is the other bookend.
    { at: 4300, do: { kind: 'strip', strip: null } },
    { at: 4900, do: { kind: 'waveform', active: true } },
    {
      at: 4900,
      do: {
        kind: 'bubble',
        role: 'tutor',
        text: 'Factoring un-does multiplying — look at the middle term 5x and the constant 6. What two numbers multiply to 6 and add up to 5?',
        links: [
          { phrase: '5x', color: 'blue' },
          { phrase: '6', color: 'green' },
        ],
      },
    },
    {
      at: 4950,
      do: {
        kind: 'annotate',
        annotations: [
          { id: 'eq', target: 'problem', color: 'amber' },
          { id: 'term-b', target: 'term-b', color: 'blue', label: 'b = 5', labelSide: 'above' },
          { id: 'term-c', target: 'term-c', color: 'green', label: 'c = 6', labelSide: 'below' },
        ],
      },
    },
    { at: 5300, do: { kind: 'tag', tag: { kind: 'reviewing', label: 'Factoring quadratics' } } },
    { at: 5400, do: { kind: 'progress', value: 0.2 } },
    { at: 8100, do: { kind: 'waveform', active: false } },
    { at: 8700, do: { kind: 'bubble', role: 'student', text: '2 and 3.' } },
    { at: 9600, do: { kind: 'waveform', active: true } },
    {
      at: 9600,
      do: {
        kind: 'bubble',
        role: 'tutor',
        text: 'Right — so it factors to (x + 2)(x + 3). What values of x make that product zero?',
      },
    },
    { at: 9650, do: { kind: 'annotate', annotations: [{ id: 'eq', target: 'problem', color: 'amber' }] } },
    { at: 9800, do: { kind: 'progress', value: 0.55 } },
    { at: 11700, do: { kind: 'waveform', active: false } },
    { at: 12300, do: { kind: 'bubble', role: 'student', text: 'x = 2 or x = 3?' } },
    { at: 13200, do: { kind: 'waveform', active: true } },
    {
      at: 13200,
      do: {
        kind: 'bubble',
        role: 'tutor',
        text: 'Careful with the signs — if x + 2 = 0, what does x have to be?',
      },
    },
    { at: 13500, do: { kind: 'progress', value: 0.42 } },
    { at: 13600, do: { kind: 'tag', tag: { kind: 'known-gap', label: 'Sign errors' } } },
    { at: 14900, do: { kind: 'waveform', active: false } },
    { at: 15500, do: { kind: 'bubble', role: 'student', text: 'Oh — negative. x = −2 or x = −3.' } },
    { at: 16300, do: { kind: 'ping', label: 'Gap closed: sign errors', durationMs: 3600 } },
    { at: 16500, do: { kind: 'waveform', active: true } },
    {
      at: 16500,
      do: {
        kind: 'bubble',
        role: 'tutor',
        text: 'Exactly — you caught the sign flip yourself. Now closing tutoring session.',
      },
    },
    { at: 16700, do: { kind: 'progress', value: 1 } },
    { at: 18500, do: { kind: 'waveform', active: false } },
    {
      at: 18800,
      do: {
        kind: 'strip',
        strip: {
          variant: 'recap',
          concepts: [{ title: 'Factoring quadratics', value: 0.61, delta: 'up' }],
          resolved: 'Sign errors',
          trend: '3 sessions in a row improving',
          comingBack: 'Factoring quadratics — Thursday',
        },
      },
    },
  ],
}

// ── The scrollytelling cut (Task 6 consumes) ────────────────────────────
// The same session compressed into four scrub-addressable beats of 1000ms
// each: 1) annotations + color-linking, 2) solution progress (with the
// ease-back), 3) tags + the ping, 4) voice. Scroll progress maps linearly
// onto [0, durationMs]; sessionBeatTimes marks the beat boundaries.
export const sessionBeatTimes = [0, 1000, 2000, 3000, 4000] as const

export const sessionBeats: SceneScript = {
  durationMs: 4000,
  restMs: 0,
  steps: [
    // Beat 1 — "It points at the problem"
    {
      at: 60,
      do: {
        kind: 'strip',
        strip: {
          variant: 'overview',
          mastery: [
            { title: 'Factoring quadratics', value: 0.45 },
            { title: 'Distributive property', value: 0.72 },
          ],
          workingThrough: 'Sign errors — flagged last session',
        },
      },
    },
    {
      at: 120,
      do: {
        kind: 'annotate',
        annotations: [
          { id: 'eq', target: 'problem', color: 'amber' },
          { id: 'term-b', target: 'term-b', color: 'blue', label: 'b = 5', labelSide: 'above' },
          { id: 'term-c', target: 'term-c', color: 'green', label: 'c = 6', labelSide: 'below' },
        ],
      },
    },
    {
      at: 140,
      do: {
        kind: 'bubble',
        role: 'tutor',
        text: "Looks like you're working on x² + 5x + 6 = 0 — the middle term 5x and the constant 6 are the key.",
        links: [
          { phrase: 'x² + 5x + 6 = 0', color: 'amber' },
          { phrase: '5x', color: 'blue' },
          { phrase: '6', color: 'green' },
        ],
        revealMs: 500,
      },
    },
    // Beat 2 — "You see yourself getting closer"
    { at: 1020, do: { kind: 'progress', value: 0.55 } },
    { at: 1050, do: { kind: 'bubble', role: 'student', text: 'So x = 2 or x = 3?' } },
    {
      at: 1150,
      do: {
        kind: 'bubble',
        role: 'tutor',
        text: 'Careful with the signs — check x + 2 = 0 again.',
        revealMs: 450,
      },
    },
    { at: 1250, do: { kind: 'progress', value: 0.42 } },
    { at: 1700, do: { kind: 'bubble', role: 'student', text: 'x = −2 or x = −3.' } },
    { at: 1850, do: { kind: 'progress', value: 0.78 } },
    // Beat 3 — "It knows what you're working on"
    { at: 2050, do: { kind: 'tag', tag: { kind: 'known-gap', label: 'Sign errors' } } },
    {
      at: 2100,
      do: {
        kind: 'bubble',
        role: 'tutor',
        text: "That closes the sign-error gap you've been working on since Tuesday.",
        revealMs: 500,
      },
    },
    { at: 2300, do: { kind: 'tag', tag: { kind: 'callback', label: 'factoring practice — 3 days ago' } } },
    { at: 2400, do: { kind: 'ping', label: 'Gap closed: sign errors', durationMs: 1200 } },
    { at: 2500, do: { kind: 'progress', value: 1 } },
    // Beat 4 — "Talk it through out loud"
    { at: 3100, do: { kind: 'waveform', active: true } },
    {
      at: 3150,
      do: {
        kind: 'bubble',
        role: 'tutor',
        text: 'Nice work — want to try one more like it?',
        revealMs: 400,
      },
    },
    {
      at: 3400,
      do: {
        kind: 'strip',
        strip: {
          variant: 'recap',
          concepts: [{ title: 'Factoring quadratics', value: 0.61, delta: 'up' }],
          resolved: 'Sign errors',
          comingBack: 'Factoring quadratics — Thursday',
        },
      },
    },
  ],
}

// ── The profile before/after (Task 7 consumes) ──────────────────────────
export const profileScene: SceneScript = {
  durationMs: 3200,
  restMs: 1800,
  steps: [
    {
      at: 200,
      do: {
        kind: 'masteryDelta',
        deltas: [
          { title: 'Factoring quadratics', from: 0.45, to: 0.61 },
          { title: 'Distributive property', from: 0.72, to: 0.74 },
          { title: 'Linear equations', from: 0.88, to: 0.88 },
        ],
      },
    },
    {
      at: 1200,
      do: {
        kind: 'strip',
        strip: {
          variant: 'recap',
          concepts: [{ title: 'Factoring quadratics', value: 0.61, delta: 'up' }],
          resolved: 'Sign errors',
          trend: '3 sessions in a row improving',
          comingBack: 'Factoring quadratics — Thursday',
        },
      },
    },
  ],
}

// ── The study-loop fan-out (Task 8 consumes) ────────────────────────────
export const studyLoopScene: SceneScript = {
  durationMs: 2600,
  restMs: 2000,
  steps: [
    { at: 300, do: { kind: 'artifact', artifact: 'notes' } },
    { at: 800, do: { kind: 'artifact', artifact: 'problems' } },
    { at: 1300, do: { kind: 'artifact', artifact: 'flashcards' } },
  ],
}

export const allScripts = { heroSession, sessionBeats, profileScene, studyLoopScene } as const
