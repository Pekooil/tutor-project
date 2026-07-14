import 'server-only'

// Sprint 16 / Task 3 (ADR-041): named per-provider cost estimates + the
// global cap thresholds, in one server-only file — the single tunable
// source of truth `cost-guard.ts` reads from and every paid route's
// estimate ultimately traces back to. These are BUDGET estimates, not
// invoice-accurate accounting: the point is a ceiling that trips
// approximately when it should, not a precise per-call bill. Every value
// below is a deliberately rough placeholder — grounded in the actual models
// this codebase calls (named per constant), not invented — that Task 9's
// manual acceptance pass tunes from real provider-dashboard numbers. Tuning
// any of these is a one-line diff; no migration, no route change.

// claude-haiku-4-5-20251001 (web/lib/ai/claude.ts's MODEL). A flat
// per-turn estimate, not token-scaled: with ADR-037's prompt caching, most
// of the large system prompt (system-prompt.ts) rides cached-read pricing,
// and the turn's genuinely-new tokens (student message + a short reply,
// ADR-014's default ≤3-sentence turns) are small and fairly uniform across
// turns — a flat cents-per-turn estimate is a reasonable proxy without
// threading token counts through every call site.
export const CLAUDE_TURN_CENTS = 1

// gpt-4o-mini-transcribe (web/lib/voice/whisper.ts). A per-second rate;
// estimateCost() below converts the route's audio byte length into an
// approximate duration before applying it (see WAV_BYTES_PER_SECOND).
export const WHISPER_PER_SEC_CENTS = 0.05

// eleven_flash_v2_5 (web/lib/voice/elevenlabs.ts). A per-character rate —
// ElevenLabs bills by character, so this needs no unit conversion at the
// call site, unlike the audio-duration estimate above.
export const ELEVENLABS_PER_CHAR_CENTS = 0.006

// Sprint 21 / Task 4 (ADR-049): the study-kit generation call
// (web/lib/study/generate.ts) — the one new paid Claude call this sprint
// adds. A flat per-kit estimate like CLAUDE_TURN_CENTS, but larger: a kit is
// a single call whose OUTPUT (notes + 2-3 worked problems + 3-5 flashcards,
// STUDY_KIT_MAX_TOKENS) is several times a turn's ≤3-sentence reply, and its
// input (the whole session transcript) is bigger than one turn's too. Three
// cents is a deliberately rough over-a-turn placeholder grounded in that
// size difference — same "budget-accurate, not invoice-accurate" bar as
// every constant here, tuned in a one-line diff from Task 8's real numbers.
export const STUDY_KIT_CENTS = 3

// The global daily ceiling (UTC day, cost_ledger's key — migration 0013).
// SOFT: the normal ceiling — voice degrades to text + browser TTS past this
// point, text turns keep working. HARD: the spike/abuse backstop, set well
// above expected beta volume — refuses new AI turns gracefully rather than
// letting the bill run away. Both are placeholder starting points; Task 9
// drives these deliberately low during its manual soft/hard-cap acceptance
// pass, then restores them to a real operating ceiling before beta.
//
// The optional env overrides (Sprint 16 / Task 8) exist so that pass — and
// cost-guard.test.ts's automated soft/hard-cap route tests — can drive the
// caps down for a single spawned dev-server process without touching the
// hardcoded default any real deployment uses, and without needing to push
// the shared global cost_ledger anywhere near its real threshold to
// exercise the branch. Unset (the deployed default), each falls back to its
// real value below.
export const SOFT_CAP_CENTS = Number(process.env.COST_SOFT_CAP_CENTS_OVERRIDE) || 2000 // $20.00/day
export const HARD_CAP_CENTS = Number(process.env.COST_HARD_CAP_CENTS_OVERRIDE) || 5000 // $50.00/day

export type CostKind = 'claude_turn' | 'whisper_stt' | 'elevenlabs_tts' | 'study_kit'

// web/overlay/VoiceController.ts's toWavUtterance: gpt-4o-mini-transcribe
// rejects Chrome's native webm/opus recording, so every utterance is
// normalised to 16-bit PCM WAV in-browser before upload (the rare
// decode-failure fallback stays raw webm/opus, which is far smaller per
// second than PCM — estimating every upload at PCM's rate is a safe,
// never-under, overestimate for that fallback). ~44.1kHz mono 16-bit
// approximates the browser's native capture rate: 44,100 samples/sec * 2
// bytes/sample.
const WAV_BYTES_PER_SECOND = 88_200

// `size` is the natural unit the caller already has on hand — audio byte
// length for STT, character count for TTS — never a pre-converted duration,
// so call sites don't need to know this file's internal unit conversions.
// A call that resolves to a fractional cent still costs at least 1: a
// near-zero estimate must never round down to a free, ungated call (a
// trivial way to bypass the guard entirely with tiny repeated requests).
export function estimateCost(kind: CostKind, size = 0): number {
  switch (kind) {
    case 'claude_turn':
      return CLAUDE_TURN_CENTS
    case 'whisper_stt': {
      const seconds = size / WAV_BYTES_PER_SECOND
      return Math.max(1, Math.ceil(WHISPER_PER_SEC_CENTS * seconds))
    }
    case 'elevenlabs_tts':
      return Math.max(1, Math.ceil(ELEVENLABS_PER_CHAR_CENTS * size))
    // Sprint 21 / Task 4 (ADR-049): a flat per-kit estimate, `size`-independent
    // like 'claude_turn' — the study-kit generator is one call whose token
    // shape (whole-session input, notes+problems+flashcards output) is roughly
    // uniform per kit, so the route passes no `size` and STUDY_KIT_CENTS stands
    // as the estimate. It refuses under the hard cap like every other paid call.
    case 'study_kit':
      return STUDY_KIT_CENTS
  }
}
