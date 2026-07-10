// The demo engine's pure core (Sprint 20 Task 4, ADR-031; vocabulary rebuilt
// in Sprint 25 Task 2, ADR-040). A scene is data — an ordered list of
// timestamped actions — and this file turns (script, time) into the visible
// state of the overlay recreation. No React, no DOM: the hero's clock, the
// scrollytelling scrub, and the reduced-motion final frame are three ways of
// calling reduceScene, not three implementations.
//
// The vocabulary mirrors the REDESIGNED overlay (extension/src/overlay/):
// tutor modes, the stage subtitle, the board strip, milestone markers,
// answer chips, the check-in and recap cards, three-tone pings, and Meadow
// ordinal annotations. The retired Sprint-14 vocabulary — `progress`, `tag`,
// `strip` — is deleted, not deprecated: a consumer that still renders a
// retired feature must fail to compile (ADR-040 decision 1).
//
// Scripts must be time-ordered. The reducer trusts that order (it applies
// steps in array order), and web/tests/scene.test.ts enforces it as a data
// lint via assertTimeOrdered — keep new scripts sorted or the suite fails.

// ── Tutor modes (mirrors extension/src/overlay/tutor-modes.ts) ───────────
// The session header's identity during a session: the live mode takes the
// logo's place. Glyphs are typographic, never emoji (brand rule).

export type TutorModeKey =
  | 'explore'
  | 'coach'
  | 'build'
  | 'practice'
  | 'challenge'
  | 'verify'
  | 'review'
  | 'recover'

export type TutorMode = { key: TutorModeKey; name: string; glyph: string }

export const DEMO_TUTOR_MODES: Record<TutorModeKey, TutorMode> = {
  explore: { key: 'explore', name: 'Exploring', glyph: '✧' },
  coach: { key: 'coach', name: 'Coaching', glyph: '✚' },
  build: { key: 'build', name: 'Building', glyph: '▲' },
  practice: { key: 'practice', name: 'Practicing', glyph: '●' },
  challenge: { key: 'challenge', name: 'Challenging', glyph: '◆' },
  verify: { key: 'verify', name: 'Verifying', glyph: '✓' },
  review: { key: 'review', name: 'Reviewing', glyph: '↺' },
  recover: { key: 'recover', name: 'Recovering', glyph: '♡' },
}

// ── Pings + milestones (mirror extension/src/overlay/pings.ts) ───────────
// Three tones: sage for wins, neutral for the tutor's own teaching moves,
// amber for watch-outs. A ping is a transient toast; a milestone is the
// same event settling into the transcript as a hairline-rule marker row —
// "milestones persist after the ping toast fades" (the markers ARE the
// progress; the Sprint-14 progress bar is retired, ADR-034).

export type PingTone = 'positive' | 'adjust' | 'watch'

export type ScenePing = { glyph: string; label: string; tone: PingTone }

export type SceneMilestone = { tone: PingTone; glyph: string; line: string }

// ── Meadow annotations (mirror extension/src/overlay/AnnotationLayer.tsx) ─
// Four ordinal color triples (theme.css --calyxa-annot-1..4), a required
// label pill ("no naked shapes"), an optional why-note (the teaching
// payload) and step badge. `target` (and `to`, for arrows) are
// data-annot-target ids on the DemoStage's fake math page.

export type AnnotOrdinal = 1 | 2 | 3 | 4
export type AnnotShape = 'box' | 'circle' | 'underline' | 'arrow'

export type SceneAnnotation = {
  id: string
  target: string
  /** Arrow endpoints: drawn from `target` to `to`. Ignored by other shapes. */
  to?: string
  ordinal: AnnotOrdinal
  shape: AnnotShape
  /** Required — every mark carries a label pill (verb-first, ≤4 words). */
  label: string
  /** The why-note card (≤90 chars). If a mark has no why, reconsider the mark. */
  note?: string
  /** Renders the numbered step badge at the mark's corner. */
  step?: number
  labelSide?: 'above' | 'below'
}

// The transcript-echo link: a phrase in the tutor's reply that shares its
// annotation's ordinal color (the redesign's echo chips, replacing the old
// color-link underlines).
export type OrdinalLink = { phrase: string; ordinal: AnnotOrdinal }

// ── The check-in and recap cards (mirror CheckinCard.tsx / RecapCard.tsx) ─
// These replace the retired pre/post insight strips: the check-in is the
// session-start body (scanning orb → one glow-haloed AI-prediction card),
// the recap is the terminal body (What improved / Still needs practicing).

export type SceneCheckin =
  | { variant: 'scan'; line: string }
  | {
      variant: 'predict'
      topic: string
      /** The top-ranked sticking-point prediction (the "AI PREDICTION" card). */
      sticking: string
      /** The honest evidence subline; null renders the generic phrasing. */
      evidence: string | null
    }

export type RecapOutcome = 'solid' | 'mostly' | 'revisit'

export type SceneRecap = {
  concept: string
  /** The header meta line, e.g. "18 min · 5 problems". */
  meta: string | null
  outcomes: { title: string; outcome: RecapOutcome }[]
}

export type MasteryDelta = { title: string; from: number; to: number }
export type ArtifactKind = 'notes' | 'problems' | 'flashcards'

// ── Actions ───────────────────────────────────────────────────────────────

export type SceneAction =
  | { kind: 'bubble'; role: 'tutor' | 'student'; text: string; links?: OrdinalLink[]; revealMs?: number }
  | { kind: 'milestone'; milestone: SceneMilestone }
  | { kind: 'annotate'; annotations: SceneAnnotation[] }
  | { kind: 'mode'; mode: TutorModeKey }
  | { kind: 'stage'; label: string | null }
  | { kind: 'board'; expression: string | null }
  | { kind: 'chips'; chips: string[] | null }
  | { kind: 'checkin'; checkin: SceneCheckin | null }
  | { kind: 'recap'; recap: SceneRecap | null }
  | { kind: 'ping'; ping: ScenePing; durationMs: number }
  // The section-complete congratulation (SectionBloom.tsx): the panel frame
  // lights up with the sage bloom for durationMs while the card stays
  // readable, then hands off to the recap. `line` is the sr-only completion
  // line ("… · every step was yours").
  | { kind: 'bloom'; line: string; durationMs: number }
  | { kind: 'waveform'; active: boolean }
  | { kind: 'masteryDelta'; deltas: MasteryDelta[] }
  | { kind: 'artifact'; artifact: ArtifactKind }

export type SceneStep = { at: number; do: SceneAction }

export type SceneScript = {
  steps: SceneStep[]
  durationMs: number
  /** Hold on the final frame before the clock-mode loop restarts. */
  restMs: number
}

// ── State ─────────────────────────────────────────────────────────────────
// The transcript is a single ordered list, like the real Transcript.tsx:
// tutor turns (un-bubbled, streaming), student turns (sage bubbles, whole),
// and milestone marker rows interleaved where they settled.

export type SceneEntry =
  | { role: 'tutor'; text: string; revealedChars: number; links: OrdinalLink[] }
  | { role: 'student'; text: string; revealedChars: number }
  | { role: 'milestone'; milestone: SceneMilestone }

export type SceneState = {
  transcript: SceneEntry[]
  annotations: SceneAnnotation[]
  /** Sessions start in (and idle at) Explore, same as the real reducer. */
  mode: TutorModeKey
  stage: string | null
  board: string | null
  /** The LATEST tutor turn's answer chips; any new turn clears them. */
  chips: string[] | null
  checkin: SceneCheckin | null
  recap: SceneRecap | null
  ping: ScenePing | null
  /** The section-complete bloom's sr-only line while the glow is up; null otherwise. */
  bloom: string | null
  waveform: boolean
  masteryDeltas: MasteryDelta[]
  artifacts: ArtifactKind[]
  /** True while the last speaker is the student and a tutor bubble is still coming. */
  pendingReply: boolean
  /** The clamped scene time — drives the session header's m:ss clock. */
  elapsedMs: number
  done: boolean
}

/** Default tutor streaming rate; a bubble's revealMs overrides for scrub scripts. */
export const TUTOR_CHARS_PER_SEC = 42

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function revealedCharsAt(action: Extract<SceneAction, { kind: 'bubble' }>, at: number, t: number): number {
  if (action.role === 'student') return action.text.length
  const totalMs = action.revealMs ?? (action.text.length / TUTOR_CHARS_PER_SEC) * 1000
  if (totalMs <= 0) return action.text.length
  return Math.min(action.text.length, Math.floor(((t - at) / totalMs) * action.text.length))
}

export function reduceScene(script: SceneScript, tMs: number): SceneState {
  const t = Math.max(0, Math.min(tMs, script.durationMs))
  const state: SceneState = {
    transcript: [],
    annotations: [],
    mode: 'explore',
    stage: null,
    board: null,
    chips: null,
    checkin: null,
    recap: null,
    ping: null,
    bloom: null,
    waveform: false,
    masteryDeltas: [],
    artifacts: [],
    pendingReply: false,
    elapsedMs: t,
    done: t >= script.durationMs,
  }

  let activePing: { at: number; ping: ScenePing; durationMs: number } | null = null
  let activeBloom: { at: number; line: string; durationMs: number } | null = null

  for (const step of script.steps) {
    if (step.at > t) break
    const action = step.do
    switch (action.kind) {
      case 'bubble':
        // Chips belong to the latest turn only: any new turn clears them
        // (a chip tap commits a student bubble; a new tutor turn brings its
        // own chips via a following `chips` step) — Overlay.tsx's rule.
        state.chips = null
        state.transcript.push(
          action.role === 'tutor'
            ? {
                role: 'tutor',
                text: action.text,
                revealedChars: revealedCharsAt(action, step.at, t),
                links: action.links ?? [],
              }
            : { role: 'student', text: action.text, revealedChars: action.text.length }
        )
        break
      case 'milestone':
        state.transcript.push({ role: 'milestone', milestone: action.milestone })
        break
      case 'annotate':
        state.annotations = action.annotations
        break
      case 'mode':
        state.mode = action.mode
        break
      case 'stage':
        state.stage = action.label
        break
      case 'board':
        state.board = action.expression
        break
      case 'chips':
        state.chips = action.chips
        break
      case 'checkin':
        state.checkin = action.checkin
        break
      case 'recap':
        state.recap = action.recap
        break
      case 'ping':
        // One at a time — a new ping replaces the current (the real toast).
        activePing = { at: step.at, ping: action.ping, durationMs: action.durationMs }
        break
      case 'bloom':
        activeBloom = { at: step.at, line: action.line, durationMs: action.durationMs }
        break
      case 'waveform':
        state.waveform = action.active
        break
      case 'masteryDelta':
        state.masteryDeltas = action.deltas
        break
      case 'artifact':
        if (!state.artifacts.includes(action.artifact)) state.artifacts.push(action.artifact)
        break
    }
  }

  if (activePing && t < activePing.at + activePing.durationMs) {
    state.ping = activePing.ping
  }

  // The bloom holds for its window, then hands off (the recap step lands as
  // it ends). Transient like the ping — the reduced-motion end frame is past
  // it, so the composed final frame is the recap, never the glow.
  if (activeBloom && t < activeBloom.at + activeBloom.durationMs) {
    state.bloom = activeBloom.line
  }

  // pendingReply looks at SPEAKERS, not raw entries — a milestone settling
  // between the student's answer and the tutor's reply must not hide the
  // typing indicator.
  const lastSpeaker = [...state.transcript].reverse().find(
    (entry): entry is Extract<SceneEntry, { role: 'tutor' | 'student' }> => entry.role !== 'milestone'
  )
  if (lastSpeaker && lastSpeaker.role === 'student') {
    const nextBubble = script.steps.find((step) => step.at > t && step.do.kind === 'bubble')
    state.pendingReply =
      nextBubble !== undefined && (nextBubble.do as Extract<SceneAction, { kind: 'bubble' }>).role === 'tutor'
  }

  return state
}

/** The reduced-motion frame: everything the scene ever shows, fully composed. */
export function sceneEndState(script: SceneScript): SceneState {
  return reduceScene(script, script.durationMs)
}

/** Scrub position (0..1) → scene time, for scroll-driven playback. */
export function scrubTime(script: SceneScript, progress: number): number {
  return clamp01(progress) * script.durationMs
}

/** The data lint (Task 10): every script's steps must be time-ordered. */
export function assertTimeOrdered(script: SceneScript, name: string): void {
  for (let i = 1; i < script.steps.length; i++) {
    if (script.steps[i].at < script.steps[i - 1].at) {
      throw new Error(
        `Scene script "${name}" is not time-ordered: step ${i} (at=${script.steps[i].at}) ` +
          `comes after step ${i - 1} (at=${script.steps[i - 1].at})`
      )
    }
  }
  const lastStep = script.steps[script.steps.length - 1]
  if (lastStep && lastStep.at > script.durationMs) {
    throw new Error(
      `Scene script "${name}" has a step at ${lastStep.at}ms past its durationMs (${script.durationMs})`
    )
  }
}

export type TextSegment = { text: string; ordinal: AnnotOrdinal | null }

// The transcript echo, the demo's version of ADR-029's exact-match
// discipline on the redesign's ordinal colors: each link claims its
// phrase's first occurrence in the text that no earlier link already
// claimed; a phrase that never matches highlights nothing — plain text,
// never a guessed link.
export function segmentText(text: string, links: OrdinalLink[]): TextSegment[] {
  const claims: { start: number; end: number; ordinal: AnnotOrdinal }[] = []

  for (const link of links) {
    let from = 0
    while (from <= text.length - link.phrase.length) {
      const index = text.indexOf(link.phrase, from)
      if (index === -1) break
      const end = index + link.phrase.length
      const overlaps = claims.some((claim) => index < claim.end && end > claim.start)
      if (!overlaps) {
        claims.push({ start: index, end, ordinal: link.ordinal })
        break
      }
      from = index + 1
    }
  }

  claims.sort((a, b) => a.start - b.start)

  const segments: TextSegment[] = []
  let cursor = 0
  for (const claim of claims) {
    if (claim.start > cursor) segments.push({ text: text.slice(cursor, claim.start), ordinal: null })
    segments.push({ text: text.slice(claim.start, claim.end), ordinal: claim.ordinal })
    cursor = claim.end
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), ordinal: null })
  return segments
}
