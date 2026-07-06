// The demo engine's pure core (Sprint 20 Task 4, ADR-031). A scene is data
// — an ordered list of timestamped actions — and this file turns (script,
// time) into the visible state of the overlay recreation. No React, no DOM:
// the hero's clock, the scrollytelling scrub, and the reduced-motion final
// frame are three ways of calling reduceScene, not three implementations.
//
// Scripts must be time-ordered. The reducer trusts that order (it applies
// steps in array order), and web/tests/scene.test.ts enforces it as a data
// lint via assertTimeOrdered — keep new scripts sorted or the suite fails.

export type TagKind = 'reviewing' | 'known-gap' | 'due-review' | 'strength' | 'callback'

// The extension's own annotation palette (extension/src/overlay/Overlay.css,
// .cx-annot-*): amber default, blue, green, red. The recreation mirrors the
// product's real vocabulary rather than inventing a marketing one.
export type AnnotColor = 'amber' | 'blue' | 'green' | 'red'

export type ColorLink = { phrase: string; color: AnnotColor }

export type SceneAnnotation = {
  id: string
  /** data-annot-target id on the DemoStage's fake math page */
  target: string
  color: AnnotColor
  label?: string
  labelSide?: 'above' | 'below'
}

export type StripState =
  | {
      variant: 'overview'
      mastery: { title: string; value: number }[]
      workingThrough?: string
      due?: string
    }
  | {
      variant: 'recap'
      concepts: { title: string; value: number; delta: 'up' | 'down' | null }[]
      resolved?: string
      trend?: string
      comingBack?: string
    }

export type MasteryDelta = { title: string; from: number; to: number }
export type ArtifactKind = 'notes' | 'problems' | 'flashcards'

export type SceneAction =
  | { kind: 'bubble'; role: 'tutor' | 'student'; text: string; links?: ColorLink[]; revealMs?: number }
  | { kind: 'tag'; tag: { kind: TagKind; label: string } }
  | { kind: 'annotate'; annotations: SceneAnnotation[] }
  | { kind: 'progress'; value: number }
  | { kind: 'ping'; label: string; durationMs: number }
  | { kind: 'strip'; strip: StripState | null }
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

export type SceneBubble = {
  role: 'tutor' | 'student'
  text: string
  /** How much of `text` is visible — tutor bubbles stream in, student bubbles arrive whole. */
  revealedChars: number
  tags: { kind: TagKind; label: string }[]
  links: ColorLink[]
}

export type SceneState = {
  bubbles: SceneBubble[]
  annotations: SceneAnnotation[]
  progress: number
  ping: { label: string } | null
  strip: StripState | null
  waveform: boolean
  masteryDeltas: MasteryDelta[]
  artifacts: ArtifactKind[]
  /** True while the last speaker is the student and a tutor bubble is still coming. */
  pendingReply: boolean
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
    bubbles: [],
    annotations: [],
    progress: 0,
    ping: null,
    strip: null,
    waveform: false,
    masteryDeltas: [],
    artifacts: [],
    pendingReply: false,
    done: t >= script.durationMs,
  }

  let activePing: { at: number; label: string; durationMs: number } | null = null

  for (const step of script.steps) {
    if (step.at > t) break
    const action = step.do
    switch (action.kind) {
      case 'bubble':
        state.bubbles.push({
          role: action.role,
          text: action.text,
          revealedChars: revealedCharsAt(action, step.at, t),
          tags: [],
          links: action.links ?? [],
        })
        break
      case 'tag': {
        for (let i = state.bubbles.length - 1; i >= 0; i--) {
          if (state.bubbles[i].role === 'tutor') {
            state.bubbles[i].tags.push(action.tag)
            break
          }
        }
        break
      }
      case 'annotate':
        state.annotations = action.annotations
        break
      case 'progress':
        state.progress = clamp01(action.value)
        break
      case 'ping':
        activePing = { at: step.at, label: action.label, durationMs: action.durationMs }
        break
      case 'strip':
        state.strip = action.strip
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
    state.ping = { label: activePing.label }
  }

  const last = state.bubbles[state.bubbles.length - 1]
  if (last && last.role === 'student') {
    const nextBubble = script.steps.find(
      (step) => step.at > t && step.do.kind === 'bubble'
    )
    state.pendingReply = nextBubble !== undefined && (nextBubble.do as { role: string }).role === 'tutor'
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

export type TextSegment = { text: string; color: AnnotColor | null }

// Color-linking, the demo's version of ADR-029's exact-match discipline:
// each link claims its phrase's first occurrence in the text that no earlier
// link already claimed; a phrase that never matches highlights nothing —
// plain text, never a guessed link.
export function segmentText(text: string, links: ColorLink[]): TextSegment[] {
  const claims: { start: number; end: number; color: AnnotColor }[] = []

  for (const link of links) {
    let from = 0
    while (from <= text.length - link.phrase.length) {
      const index = text.indexOf(link.phrase, from)
      if (index === -1) break
      const end = index + link.phrase.length
      const overlaps = claims.some((claim) => index < claim.end && end > claim.start)
      if (!overlaps) {
        claims.push({ start: index, end, color: link.color })
        break
      }
      from = index + 1
    }
  }

  claims.sort((a, b) => a.start - b.start)

  const segments: TextSegment[] = []
  let cursor = 0
  for (const claim of claims) {
    if (claim.start > cursor) segments.push({ text: text.slice(cursor, claim.start), color: null })
    segments.push({ text: text.slice(claim.start, claim.end), color: claim.color })
    cursor = claim.end
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), color: null })
  return segments
}
