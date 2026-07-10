import type { SceneAnnotation, SceneCheckin, ScenePing, SceneRecap, SceneScript } from './scene'

// The scene scripts (Sprint 25 Task 4, ADR-040; originally Sprint 20
// Task 4, ADR-031) — pure data, played by useSceneTimeline. Every script
// tells ONE story around the repo's fixture problem (x² + 5x + 6 = 0) so
// the hero, the scrollytelling beats, the check-in/recap bookends, and the
// adaptive vignettes read as the same session seen from different angles.
// Copy or timing changes are edits HERE, never to the components.
//
// The story, in the redesigned overlay's vocabulary: the opening scan
// predicts the student's sticking point (sign errors — the check-in card),
// the session factors the fixture quadratic with Meadow annotations and
// answer chips, the predicted sign error actually happens (watch ping, live
// switch to Coaching), the student self-catches (positive ping, milestone
// marker), and the recap card closes the arc. The board strip tracks the
// problem's transformations; stage subtitles track the session plan.
//
// Annotation targets ('problem', 'term-b', 'term-c') are data-annot-target
// ids on DemoStage's fake math page. Echoed phrases must reuse the exact
// on-page text (ADR-029's discipline, mirrored): a near-miss renders plain,
// never a guessed highlight. Ping/milestone glyphs are typographic
// stand-ins for the product's 14px stroke icons (TitlePin.tsx) — never
// emoji, same brand rule as the mode glyphs.

// ── Shared fixtures (one story, many angles) ─────────────────────────────

// The check-in prediction every surface repeats: the profile flagged sign
// errors before the session, and the session proves it.
const PREDICTION: SceneCheckin = {
  variant: 'predict',
  topic: 'Factoring quadratics',
  sticking: 'Sign errors on the roots',
  evidence: "came up twice in Tuesday's session",
}

// The recap card every surface repeats (RecapCard.tsx's model): improved
// rows get sage checks, the revisit row waits under the amber overline.
const RECAP: SceneRecap = {
  concept: 'Factoring quadratics',
  meta: '12 min · 3 problems',
  outcomes: [
    { title: 'Factoring x² + bx + c', outcome: 'solid' },
    { title: 'Catching sign errors', outcome: 'mostly' },
    { title: 'Negative coefficients', outcome: 'revisit' },
  ],
}

// The Meadow marks on the fixture equation: ordinal 1 boxes the problem,
// ordinals 2/3 circle the b and c terms with the why-note on b (labels
// verb-first, ≤4 words; one why-note carries the teaching payload).
const MARK_PROBLEM: SceneAnnotation = { id: 'eq', target: 'problem', ordinal: 1, shape: 'box', label: 'Start here' }
const MARK_TERM_B: SceneAnnotation = {
  id: 'term-b',
  target: 'term-b',
  ordinal: 2,
  shape: 'circle',
  label: 'Add to 5',
  note: 'b is what the two numbers add up to.',
  step: 1,
  labelSide: 'above',
}
const MARK_TERM_C: SceneAnnotation = {
  id: 'term-c',
  target: 'term-c',
  ordinal: 3,
  shape: 'circle',
  label: 'Multiply to 6',
  step: 2,
  labelSide: 'below',
}

// ── The hero's full session arc (~25s + rest, ADR-040 decision 2) ────────
// opening scan → AI-prediction check-in (inside the first ~5s — the
// flagship moment must land before a visitor scrolls) → tutoring with
// annotations, chips, pings, a live mode switch, and milestone markers →
// recap card → rest → loop.
export const heroSession: SceneScript = {
  durationMs: 28000,
  restMs: 3000,
  steps: [
    // The opening scan (CheckinCard.tsx's two scan lines), then the one
    // glow-haloed prediction — front-loaded, per the ADR.
    { at: 300, do: { kind: 'checkin', checkin: { variant: 'scan', line: 'Reading the page…' } } },
    { at: 1600, do: { kind: 'checkin', checkin: { variant: 'scan', line: 'Checking your last session…' } } },
    { at: 2800, do: { kind: 'checkin', checkin: PREDICTION } },
    // Session start: the check-in clears, the mode header + stage subtitle
    // + board strip take over (the header identity swaps to the live mode).
    { at: 5600, do: { kind: 'checkin', checkin: null } },
    { at: 5600, do: { kind: 'stage', label: 'Factoring quadratics · Stage 1 of 3' } },
    { at: 5600, do: { kind: 'board', expression: 'x² + 5x + 6 = 0' } },
    { at: 5800, do: { kind: 'annotate', annotations: [MARK_PROBLEM] } },
    { at: 5900, do: { kind: 'waveform', active: true } },
    {
      at: 6000,
      do: {
        kind: 'bubble',
        role: 'tutor',
        text: "Looks like you're working on x² + 5x + 6 = 0 — factoring un-does multiplying. What two numbers multiply to 6 and add up to 5?",
        links: [
          { phrase: 'x² + 5x + 6 = 0', ordinal: 1 },
          { phrase: '6', ordinal: 3 },
          { phrase: '5', ordinal: 2 },
        ],
      },
    },
    // The b/c marks draw on mid-sentence, as the tutor names the terms.
    { at: 7400, do: { kind: 'annotate', annotations: [MARK_PROBLEM, MARK_TERM_B, MARK_TERM_C] } },
    { at: 9000, do: { kind: 'waveform', active: false } },
    { at: 9200, do: { kind: 'chips', chips: ['2 and 3', '1 and 6', 'Not sure'] } },
    // A chip tap commits the student bubble (exact chip text) and clears the row.
    { at: 10300, do: { kind: 'bubble', role: 'student', text: '2 and 3' } },
    {
      at: 10600,
      do: {
        kind: 'ping',
        ping: { glyph: '✓', label: 'Key concept understood · factor pairs', tone: 'positive' },
        durationMs: 2600,
      },
    },
    {
      at: 10900,
      do: { kind: 'milestone', milestone: { tone: 'positive', glyph: '✓', line: 'Key concept understood · factor pairs' } },
    },
    { at: 11600, do: { kind: 'waveform', active: true } },
    {
      at: 11700,
      do: {
        kind: 'bubble',
        role: 'tutor',
        text: 'Right — 2 and 3 it is. That factors the left side into (x + 2)(x + 3). What values of x make that product zero?',
        links: [{ phrase: '(x + 2)(x + 3)', ordinal: 1 }],
      },
    },
    // The problem transforms: the board strip updates, the stage advances,
    // and the term marks retire (their teaching moment is over).
    { at: 12400, do: { kind: 'board', expression: '(x + 2)(x + 3) = 0' } },
    { at: 12400, do: { kind: 'stage', label: 'Factoring quadratics · Stage 2 of 3' } },
    { at: 12400, do: { kind: 'annotate', annotations: [MARK_PROBLEM] } },
    { at: 14300, do: { kind: 'waveform', active: false } },
    { at: 14700, do: { kind: 'chips', chips: ['x = 2 or x = 3', 'x = −2 or x = −3', 'Not sure'] } },
    // The predicted mistake, on cue: the student picks the sign-error chip.
    { at: 15300, do: { kind: 'bubble', role: 'student', text: 'x = 2 or x = 3' } },
    {
      at: 15700,
      do: {
        kind: 'ping',
        ping: { glyph: '◎', label: 'Misconception confirmed · sign errors', tone: 'watch' },
        durationMs: 3000,
      },
    },
    // The session adapts where everyone can see it: Explore → Coaching.
    { at: 16000, do: { kind: 'mode', mode: 'coach' } },
    { at: 16300, do: { kind: 'waveform', active: true } },
    {
      at: 16400,
      do: {
        kind: 'bubble',
        role: 'tutor',
        text: "Careful with the signs — that's the step that usually gets you. If x + 2 = 0, what does x have to be?",
      },
    },
    { at: 18800, do: { kind: 'waveform', active: false } },
    { at: 19600, do: { kind: 'bubble', role: 'student', text: 'Oh — negative. x = −2 or x = −3.' } },
    { at: 20000, do: { kind: 'ping', ping: { glyph: '✦', label: 'Self-caught · sign flip', tone: 'positive' }, durationMs: 2800 } },
    { at: 20300, do: { kind: 'milestone', milestone: { tone: 'positive', glyph: '✓', line: 'Pattern broken · sign errors' } } },
    { at: 20600, do: { kind: 'mode', mode: 'verify' } },
    { at: 20600, do: { kind: 'stage', label: 'Factoring quadratics · Stage 3 of 3' } },
    { at: 20800, do: { kind: 'board', expression: 'x = −2, x = −3' } },
    { at: 21000, do: { kind: 'waveform', active: true } },
    {
      at: 21100,
      do: {
        kind: 'bubble',
        role: 'tutor',
        text: 'Exactly — you caught the sign flip yourself. Check both roots against the original and this one is done.',
      },
    },
    { at: 23600, do: { kind: 'waveform', active: false } },
    // The problem is solved: the panel frame blooms sage (SectionBloom's
    // "congratulation, not confetti") for 2.8s while the transcript stays
    // readable, then hands off to the recap exactly as the glow fades.
    { at: 23800, do: { kind: 'bloom', line: 'Factoring quadratics · every step was yours', durationMs: 2800 } },
    { at: 26600, do: { kind: 'recap', recap: RECAP } },
  ],
}

export const heroSessionAlt =
  'Animated recreation of the Calyxa overlay running a full session on a math practice page: it scans the page, predicts sign errors as the likely sticking point, tutors through factoring x squared plus 5x plus 6 with color-coded annotations, answer chips, and status pings, switches into coaching when the predicted mistake happens, marks the breakthrough as a milestone, lights the panel with a sage completion glow when the problem is solved, and ends with a recap card of what improved.'

// ── The scrollytelling cut (Task 6 consumes) ─────────────────────────────
// The same session compressed into four scrub-addressable beats of 1000ms
// each, one per redesigned system: 1) Meadow annotations + transcript
// echoes, 2) milestone markers + stages on the board, 3) the prediction
// coming true + the ping and mode switch, 4) voice. Scroll progress maps
// linearly onto [0, durationMs]; sessionBeatTimes marks the beat
// boundaries (the stacked below-lg cards render the frame at each beat's
// END time).
export const sessionBeatTimes = [0, 1000, 2000, 3000, 4000] as const

export const sessionBeats: SceneScript = {
  durationMs: 4000,
  restMs: 0,
  steps: [
    // Beat 1 — annotations v2: the full Meadow anatomy (pills, why-note,
    // step badges) plus the ordinal echoes in the tutor's line.
    { at: 60, do: { kind: 'board', expression: 'x² + 5x + 6 = 0' } },
    { at: 60, do: { kind: 'stage', label: 'Factoring quadratics · Stage 1 of 3' } },
    { at: 120, do: { kind: 'annotate', annotations: [MARK_PROBLEM, MARK_TERM_B, MARK_TERM_C] } },
    {
      at: 140,
      do: {
        kind: 'bubble',
        role: 'tutor',
        text: 'The middle term 5x and the constant 6 are the whole game — two numbers that multiply to 6 and add up to 5.',
        links: [
          { phrase: '5x', ordinal: 2 },
          { phrase: '6', ordinal: 3 },
        ],
        revealMs: 500,
      },
    },
    // Beat 2 — milestones + stages: the win settles into the transcript as
    // a marker row while the board and stage advance with the problem.
    { at: 1050, do: { kind: 'bubble', role: 'student', text: '2 and 3' } },
    {
      at: 1150,
      do: { kind: 'milestone', milestone: { tone: 'positive', glyph: '✓', line: 'Key concept understood · factor pairs' } },
    },
    { at: 1250, do: { kind: 'board', expression: '(x + 2)(x + 3) = 0' } },
    { at: 1250, do: { kind: 'stage', label: 'Factoring quadratics · Stage 2 of 3' } },
    {
      at: 1400,
      do: {
        kind: 'bubble',
        role: 'tutor',
        text: 'That factors it — (x + 2)(x + 3). What values of x make that zero?',
        links: [{ phrase: '(x + 2)(x + 3)', ordinal: 1 }],
        revealMs: 450,
      },
    },
    // Beat 3 — prediction + pings: the sticking point the check-in called
    // actually happens; the watch ping fires and the mode switches live.
    { at: 2100, do: { kind: 'bubble', role: 'student', text: 'x = 2 or x = 3' } },
    {
      at: 2250,
      do: {
        kind: 'ping',
        ping: { glyph: '◎', label: 'Misconception confirmed · sign errors', tone: 'watch' },
        durationMs: 850,
      },
    },
    { at: 2350, do: { kind: 'mode', mode: 'coach' } },
    {
      at: 2450,
      do: {
        kind: 'bubble',
        role: 'tutor',
        text: 'Called it — signs are where you usually slip. If x + 2 = 0, what is x?',
        revealMs: 500,
      },
    },
    // Beat 4 — voice: the student talks it through; the tutor speaks back
    // (waveform + Speaking indicator) and the breakthrough persists.
    { at: 3080, do: { kind: 'bubble', role: 'student', text: 'Oh — negative. x = −2 or x = −3.' } },
    { at: 3250, do: { kind: 'milestone', milestone: { tone: 'positive', glyph: '✓', line: 'Pattern broken · sign errors' } } },
    { at: 3400, do: { kind: 'waveform', active: true } },
    {
      at: 3450,
      do: {
        kind: 'bubble',
        role: 'tutor',
        text: 'Exactly — say it out loud: why negative?',
        revealMs: 450,
      },
    },
  ],
}

// Drafted alt strings for SessionShowcase (Task 6 adopts): the pinned scrub
// stage plus one line per stacked beat card.
export const sessionShowcaseAlts = {
  pinned:
    'Pinned recreation of the Calyxa overlay working through x squared plus 5x plus 6 equals 0 as you scroll: annotations draw onto the equation, a milestone settles into the transcript as the board updates, the predicted sign error triggers a ping and a switch into coaching, and the tutor answers out loud.',
  beats: [
    'The overlay circles the b and c terms of the equation with labeled marks, a why-note, and step badges; the same colors echo in the tutor’s reply.',
    'A "Key concept understood" milestone row settles into the transcript while the board strip updates to the factored form and the stage advances.',
    'The sign error the profile predicted happens; a "Misconception confirmed" ping drops in and the session header switches from Exploring to Coaching.',
    'The tutor speaks its coaching question aloud — the Speaking waveform runs in the header while the breakthrough milestone stays in the transcript.',
  ],
} as const

// ── The check-in / recap bookends (Task 8 consumes) ──────────────────────
// One timeline holding both bookends: the opening scan resolving into the
// AI-prediction card, then the terminal recap card. Task 8's before/after
// panels can play it once-in-view or pin the two composed frames below.
export const checkinRecapScene: SceneScript = {
  durationMs: 6800,
  restMs: 2600,
  steps: [
    { at: 300, do: { kind: 'checkin', checkin: { variant: 'scan', line: 'Reading the page…' } } },
    { at: 1400, do: { kind: 'checkin', checkin: { variant: 'scan', line: 'Checking your last session…' } } },
    { at: 2400, do: { kind: 'checkin', checkin: PREDICTION } },
    { at: 5200, do: { kind: 'checkin', checkin: null } },
    { at: 5200, do: { kind: 'recap', recap: RECAP } },
  ],
}

// Fixed frames for the before/after cards (DemoStage's frameMs): the
// composed prediction card and the composed recap card.
export const checkinRecapFrames = { checkin: 3200, recap: 6800 } as const

export const checkinRecapAlts = {
  checkin:
    'The Calyxa check-in card before a session: after scanning the page it predicts the topic, Factoring quadratics, and the likely sticking point — sign errors on the roots, flagged from Tuesday’s session.',
  recap:
    'The Calyxa recap card after the session: under Factoring quadratics, factoring and catching sign errors show as improved while negative coefficients is marked still needs practicing, above the Generated-for-you placeholder tiles.',
} as const

// ── The adaptive-section vignettes (Task 7 consumes, ADR-040 decision 4) ─
// Four parallel systems, one script (or catalog) each. The scripts stay on
// the one fixture story; the ping catalog is data for the tap-to-fire
// vignette (the page's second interactive element).

// Vignette 1 — misconception prediction: scan → the one glow-haloed card.
export const predictionVignette: SceneScript = {
  durationMs: 6800,
  restMs: 2400,
  steps: [
    { at: 300, do: { kind: 'checkin', checkin: { variant: 'scan', line: 'Reading the page…' } } },
    { at: 1600, do: { kind: 'checkin', checkin: { variant: 'scan', line: 'Checking your last session…' } } },
    { at: 2800, do: { kind: 'checkin', checkin: PREDICTION } },
  ],
}

// Vignette 2 — tutor modes: the header identity cycling through all eight
// modes mid-session (starts and ends on Explore, so the loop is seamless).
// One full pass over the eight modes, holding each for exactly 2s (the title
// card and the session header recolor together on this beat). The session
// starts on Explore (the reducer's default), so the first switch is at 2s;
// after Recover (14–16s) the loop wraps back to Explore.
export const modesVignette: SceneScript = {
  durationMs: 16000,
  restMs: 0,
  steps: [
    { at: 0, do: { kind: 'stage', label: 'Factoring quadratics · Stage 2 of 3' } },
    { at: 0, do: { kind: 'board', expression: '(x + 2)(x + 3) = 0' } },
    { at: 2000, do: { kind: 'mode', mode: 'coach' } },
    { at: 4000, do: { kind: 'mode', mode: 'build' } },
    { at: 6000, do: { kind: 'mode', mode: 'practice' } },
    { at: 8000, do: { kind: 'mode', mode: 'challenge' } },
    { at: 10000, do: { kind: 'mode', mode: 'verify' } },
    { at: 12000, do: { kind: 'mode', mode: 'review' } },
    { at: 14000, do: { kind: 'mode', mode: 'recover' } },
  ],
}

// Vignette 3 — annotation anatomy: the Meadow mark assembling piece by
// piece (mark → label pill → why-note → second mark with step badges).
export const annotationVignette: SceneScript = {
  durationMs: 7000,
  restMs: 2400,
  steps: [
    { at: 300, do: { kind: 'annotate', annotations: [MARK_PROBLEM] } },
    {
      at: 1700,
      do: { kind: 'annotate', annotations: [MARK_PROBLEM, { ...MARK_TERM_B, note: undefined, step: undefined }] },
    },
    { at: 3100, do: { kind: 'annotate', annotations: [MARK_PROBLEM, { ...MARK_TERM_B, step: undefined }] } },
    { at: 4500, do: { kind: 'annotate', annotations: [MARK_PROBLEM, MARK_TERM_B, MARK_TERM_C] } },
  ],
}

// Vignette 4 — the ping catalog (tap-to-fire, design 8b): all nineteen
// kinds with their product tones (pings.ts's PIN_TONE), display copy in
// the server labels' voice (event · subject — milestoneLine's middle-dot
// typography), and typographic stand-in glyphs. Not a timed script: Task
// 7's vignette fires an entry's ScenePing on tap/keyboard.
export type PingCatalogEntry = ScenePing & {
  /** The product's StatusPinKind this entry mirrors (stable render key). */
  kind: string
}

export const pingCatalog: readonly PingCatalogEntry[] = [
  { kind: 'prediction-confirmed', glyph: '◎', label: 'Misconception confirmed · sign errors', tone: 'watch' },
  { kind: 'misconception-detected', glyph: '✱', label: 'New misconception · dropped negative', tone: 'watch' },
  { kind: 'pattern-detected', glyph: '∿', label: 'Pattern noticed · rushing the last step', tone: 'watch' },
  { kind: 'pattern-broken', glyph: '✓', label: 'Pattern broken · sign errors', tone: 'positive' },
  { kind: 'streak-progress', glyph: '●', label: 'Almost broken · sign errors (2 of 3)', tone: 'positive' },
  { kind: 'concept-understood', glyph: '✓', label: 'Key concept understood · factor pairs', tone: 'positive' },
  { kind: 'progress', glyph: '↗', label: 'Progress · factoring quadratics', tone: 'positive' },
  { kind: 'final-step', glyph: '⚑', label: 'Final step', tone: 'positive' },
  { kind: 'teaching-visual', glyph: '▦', label: 'Drawing it out', tone: 'adjust' },
  { kind: 'teaching-decompose', glyph: '≡', label: 'Breaking it into steps', tone: 'adjust' },
  { kind: 'pace-up', glyph: '»', label: 'Picking up the pace', tone: 'adjust' },
  { kind: 'guidance-up', glyph: '◐', label: 'More guidance for now', tone: 'adjust' },
  { kind: 'guidance-down', glyph: '◑', label: 'Less guidance needed', tone: 'positive' },
  { kind: 'difficulty-up', glyph: '↗', label: 'Difficulty up · you earned it', tone: 'positive' },
  { kind: 'difficulty-down', glyph: '↘', label: 'Easing difficulty down', tone: 'adjust' },
  { kind: 'callback', glyph: '↺', label: "Callback · Tuesday's session", tone: 'adjust' },
  { kind: 'due-review', glyph: '◷', label: 'Review due · distributive property', tone: 'adjust' },
  { kind: 'confidence-up', glyph: '↗', label: 'Confidence rising', tone: 'positive' },
  { kind: 'self-caught', glyph: '✦', label: 'Self-caught · sign flip', tone: 'positive' },
] as const

export const adaptiveVignetteAlts = {
  prediction:
    'The check-in card scanning the page, then predicting the likely sticking point for this session: sign errors on the roots.',
  modes:
    'The session header cycling through Calyxa’s eight tutor modes — Exploring, Coaching, Building, Practicing, Challenging, Verifying, Reviewing, Recovering — each with its own glyph and color.',
  annotations:
    'A Calyxa annotation assembling on the equation: the mark, its label pill, the why-note explaining the step, and numbered step badges.',
  pings:
    'A catalog of Calyxa’s session pings in three tones — sage wins, neutral teaching moves, amber watch-outs. Tap one to fire it as a toast.',
} as const

// ── The study-loop fan-out (Task 9's section consumes) ──────────────────
// Unchanged vocabulary (artifact steps survived the Sprint 25 cut); Task 9
// reframes the SECTION's copy as roadmap and chains it off the recap
// card's "Generated for you" placeholder slot — the artifacts here are the
// tiles that slot will one day fill.
export const studyLoopScene: SceneScript = {
  durationMs: 2600,
  restMs: 2000,
  steps: [
    { at: 300, do: { kind: 'artifact', artifact: 'notes' } },
    { at: 800, do: { kind: 'artifact', artifact: 'problems' } },
    { at: 1300, do: { kind: 'artifact', artifact: 'flashcards' } },
  ],
}

export const studyLoopAlt =
  'Three study-material tiles fanning out of the recap card’s Generated-for-you slot — notes, practice problems, flashcards — shown as what Calyxa will generate from each session. On the way; not in the beta build.'

export const allScripts = {
  heroSession,
  sessionBeats,
  checkinRecapScene,
  predictionVignette,
  modesVignette,
  annotationVignette,
  studyLoopScene,
} as const
