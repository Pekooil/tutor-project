import { createShadowRootUi, defineContentScript } from '#imports';
import type { ShadowRootContentScriptUi } from '#imports';
import type { Root } from 'react-dom/client';
import { mountOverlay, unmountOverlay } from '../overlay/mount';
import { PANEL_CLOSED_EVENT, PANEL_EXPANDED_EVENT, SESSION_RECAP_EVENT, type TurnResult } from '../overlay/Overlay';
import type { Utterance } from '../overlay/VoiceController';
import {
  clearAnnotations,
  showTurnAnnotations,
  showTurnAnnotationsSequenced,
  teardown as teardownAnnotations,
  type EquationRegistry,
} from './annotations';
import { extractPageContext } from './pageExtractor';
import type {
  AiReplyPayload,
  Annotation,
  CalyxaMessage,
  GetProfileOverviewReplyPayload,
  OpeningScanReplyPayload,
  PageContext,
  ProfileOverview,
  ProfileTag,
  SessionEndedPayload,
  SessionStatePayload,
  TurnMessage,
  TurnPing,
  VoiceSttReplyPayload,
  VoiceTtsReplyPayload,
  VoiceTtsStreamMessage,
} from '../types/messages';

// Overlay UI handle, created once per page in main(). Held at module scope
// because a content script's execution context lives for the page's lifetime —
// unlike the background service worker, where module-level state is lost between
// wakes. Task 4 toggles it (mount/remove) when the keyboard shortcut fires.
let overlayUi: ShadowRootContentScriptUi<Root> | undefined;

// The PageContext captured on the most recent overlay EXPAND (Sprint 07 Task
// 5/6, ADR-012/ADR-013; moved from overlay-MOUNT to overlay-EXPAND in
// Sprint 14 Task 6 -- the filed Sprint 13 live-find). Mount happens once per
// page load for a signed-in user, which on an SPA (Khan Academy) can run
// before the exercise even renders, leaving the whole session context-blind;
// expand (handlePanelExpand below, wired to Overlay.tsx's PANEL_EXPANDED_EVENT)
// is the actually-intended "fresh right before the tutor needs it" moment,
// and it re-fires on every re-expand too (not just the first), so an SPA
// navigation between minimizes is picked up. Never cached across opens,
// never persisted to disk/DB — read by sendAiTurn below to attach to the
// next AI_TURN. Undefined until the panel has been expanded at least once
// in this page's lifetime.
let capturedPageContext: PageContext | undefined;

// The equation-element registry captured ALONGSIDE the PageContext above
// (Sprint 12, ADR-022): capturedEquationElements[i] is the live source
// element of capturedPageContext.equations[i]. Same lifetime discipline —
// refreshed on every overlay EXPAND (Sprint 14 Task 6, moved with the
// capture above), never cached across opens — and it never leaves this
// content script: elements can't serialize, and by design the registry
// never rides a chrome.runtime message or persists (ADR-023).
// currentEquationRegistry() below zips this with capturedPageContext.equations
// into what the annotation resolver (annotations.ts, Task 5) matches
// textMatch targets against; sendAiTurn (Task 7) reads it per turn. Entries
// can go stale (an SPA re-render disconnects them); the resolver checks
// isConnected at draw/re-anchor time rather than this file policing
// staleness here.
let capturedEquationElements: (Element | null)[] = [];

// Zips the two module-scope arrays above into the shape the annotation
// resolver expects (Sprint 12 Task 7). Read fresh on every turn rather than
// cached alongside them, since it's a trivial O(n) map over data that's
// already held -- no reason to keep a second copy in sync.
function currentEquationRegistry(): EquationRegistry {
  const equations = capturedPageContext?.equations ?? [];
  return equations.map((equation, index) => ({
    equation,
    element: capturedEquationElements[index] ?? null,
  }));
}

// The panel-EXPAND handler (Sprint 14 Task 6): wired to Overlay.tsx's
// PANEL_EXPANDED_EVENT below, which fires on every real expand -- first
// open AND every re-expand after a minimize, keyboard shortcut or a direct
// pill click alike. Synchronous (extractPageContext is a one-shot DOM read,
// ADR-012) so the opening-scan effect's onOpeningScan call, triggered by
// the SAME expand and resolved in the next microtask, always sees this
// turn's fresh capture, never the previous one.
function handlePanelExpand(): void {
  const { context, equationElements } = extractPageContext();
  capturedPageContext = context;
  capturedEquationElements = equationElements;
}

// The opening-scan plausible-problem gate (Sprint 14 Task 6, ADR-030): a
// cheap, pure pre-filter so a blank tab or a non-math page never reaches
// the model for no value -- non-empty equations, OR a text excerpt past a
// trivial length. Exported for the Task 9 vitest spec (lifecycle.test.ts).
const MIN_PLAUSIBLE_TEXT_CHARS = 20;

export function isPlausibleProblem(context: PageContext | undefined): boolean {
  if (!context) return false;
  if (context.equations.length > 0) return true;
  return (context.text?.trim().length ?? 0) >= MIN_PLAUSIBLE_TEXT_CHARS;
}

// The opening scan's transport (Sprint 14 Task 6, ADR-030): called by
// Overlay.tsx once per real expand while the conversation is still empty.
// Gates on the freshly captured capturedPageContext (handlePanelExpand
// above already ran for this same expand); requests OPENING_SCAN only when
// the gate passes, draws any annotations the reply carries (same
// showTurnAnnotations call sendAiTurn uses), and resolves null -- never
// throws -- on every degrade path: nothing plausible on the page, a
// request failure, or an empty/whitespace reply (the model's own "not
// confident" signal, ADR-030 Decision 5). Overlay.tsx appends the result as
// the first assistant bubble; a null result renders nothing, same as a
// failed overview fetch.
//
// Sprint 14 Task 7: also surfaces `annotations` (in addition to drawing
// them, unchanged) so Overlay.tsx's color-linked highlighting can apply to
// the opening scan's own bubble too -- the model is held to the same
// exact-target.text-reuse discipline there (system-prompt.ts's OPENING SCAN
// MODE block), so there's no reason the first bubble should be exempt.
async function requestOpeningScan(): Promise<{ reply: string; tags?: ProfileTag[]; annotations?: Annotation[] } | null> {
  if (!isPlausibleProblem(capturedPageContext)) return null;

  const registry = currentEquationRegistry();
  const message: CalyxaMessage = {
    type: 'OPENING_SCAN',
    payload: { pageContext: capturedPageContext },
  };

  let response: CalyxaMessage;
  try {
    response = await chrome.runtime.sendMessage(message);
  } catch (error) {
    console.warn('Calyxa content: opening scan not acknowledged', error);
    return null;
  }

  const payload = response?.payload as OpeningScanReplyPayload | undefined;
  if (!payload || 'error' in payload || !payload.reply.trim()) {
    return null;
  }

  showTurnAnnotations(payload.annotations ?? [], registry);
  return {
    reply: payload.reply,
    ...(payload.profileTags && payload.profileTags.length > 0 ? { tags: payload.profileTags } : {}),
    ...(payload.annotations && payload.annotations.length > 0 ? { annotations: payload.annotations } : {}),
  };
}

// The overlay's AI_TURN transport. When `onChunk` is provided (text turns),
// streams via a persistent port (AI_STREAM) so the overlay can render
// word-by-word. When omitted (voice turns that need the full reply before
// TTS synthesis), falls back to the non-streaming sendMessage path.
// This is the ONLY chrome.* surface threaded into the overlay — Overlay.tsx
// itself never imports chrome.*, so this function is its sole window onto
// the extension. pageContext is captured at overlay-open time (see below).
//
// Sprint 13 (ADR-024/026): resolves { reply, tags?, pings? } instead of a
// bare string -- profileTags/pings ride both reply paths (the port's `done`
// message and the AI_REPLY payload) additively, each key present only when
// the wire carried entries, so the overlay's omission checks mirror the
// route's own. Annotation handling on both paths is unchanged.
//
// Sprint 14 Task 7 (ADR-027/028/029): also surfaces `annotations`,
// `solutionProgress`, and `session` on the resolved TurnResult -- Task 6
// already put all three on the wire, but nothing downstream read them until
// now (the close choreography and the progress bar need session/
// solutionProgress; the color-linked highlighting needs the raw
// annotations, which the resolved DrawInstruction[] the layer draws from
// has already lost target.text by the time it's dispatched). Additive only
// -- the existing showTurnAnnotations draw call and pendingVoiceAnnotations
// sequencing are unchanged; this just ALSO hands the same array to Overlay.tsx.
async function sendAiTurn(
  messages: TurnMessage[],
  onChunk?: (text: string) => void,
): Promise<TurnResult> {
  // Snapshotted once per turn, not re-read at reply time: a turn's whole
  // round trip should resolve against the page as it was when the turn was
  // sent, not whatever the overlay happens to hold by the time the reply
  // lands (Sprint 12 Task 7 -- "the current registry").
  const registry = currentEquationRegistry();

  if (onChunk) {
    return new Promise<TurnResult>((resolve, reject) => {
      const port = chrome.runtime.connect({ name: 'AI_STREAM' });
      let settled = false;

      port.onMessage.addListener(
        (msg: {
          type: string;
          text?: string;
          reply?: string;
          annotations?: Annotation[];
          profileTags?: ProfileTag[];
          pings?: TurnPing[];
          solutionProgress?: number;
          session?: TurnResult['session'];
          error?: string;
        }) => {
          if (msg.type === 'chunk' && msg.text) {
            onChunk(msg.text);
          } else if (msg.type === 'done' && !settled) {
            settled = true;
            port.disconnect();
            // New turn's annotations replace the previous turn's drawings
            // (controller behaviour); a turn with none is a no-op there.
            showTurnAnnotations(msg.annotations ?? [], registry);
            resolve({
              reply: msg.reply ?? '',
              ...(msg.profileTags && msg.profileTags.length > 0 ? { tags: msg.profileTags } : {}),
              ...(msg.pings && msg.pings.length > 0 ? { pings: msg.pings } : {}),
              ...(msg.annotations && msg.annotations.length > 0 ? { annotations: msg.annotations } : {}),
              ...(msg.solutionProgress !== undefined ? { solutionProgress: msg.solutionProgress } : {}),
              ...(msg.session ? { session: msg.session } : {}),
            });
          } else if (msg.type === 'error' && !settled) {
            settled = true;
            port.disconnect();
            reject(new Error(msg.error ?? 'Unknown streaming error'));
          }
        },
      );

      port.onDisconnect.addListener(() => {
        if (!settled) {
          settled = true;
          reject(new Error('Background disconnected unexpectedly during streaming.'));
        }
      });

      port.postMessage({ messages, pageContext: capturedPageContext });
    });
  }

  // Non-streaming path (voice turns): annotations are NOT drawn here.
  // Synthesis + playback happen after this promise resolves (Overlay.tsx's
  // handleMicStop calls onSynthesize then plays the audio), and the voice
  // sequencing feature needs the actual TTS duration -- unknown until
  // playback starts -- to time the reveal ladder. The resolved payload is
  // held here and consumed by handleVoicePlaybackStart below, once that
  // duration is known. Always overwrites any previous pending value, so an
  // interrupted/failed prior voice turn can never leak into this one.
  const message: CalyxaMessage = {
    type: 'AI_TURN',
    payload: { messages, pageContext: capturedPageContext },
  };
  const response: CalyxaMessage = await chrome.runtime.sendMessage(message);
  const payload = response.payload as AiReplyPayload;
  if ('error' in payload) {
    throw new Error(payload.error);
  }
  pendingVoiceAnnotations = { annotations: payload.annotations ?? [], registry };
  return {
    reply: payload.reply,
    ...(payload.profileTags && payload.profileTags.length > 0 ? { tags: payload.profileTags } : {}),
    ...(payload.pings && payload.pings.length > 0 ? { pings: payload.pings } : {}),
    ...(payload.annotations && payload.annotations.length > 0 ? { annotations: payload.annotations } : {}),
    ...(payload.solutionProgress !== undefined ? { solutionProgress: payload.solutionProgress } : {}),
    ...(payload.session ? { session: payload.session } : {}),
  };
}

// The overlay's overview transport (Sprint 13, ADR-024/025): relays
// GET_PROFILE_OVERVIEW to the background and unwraps the error-shaped
// reply, same pattern as sendVoiceStt below. A rejection is the overlay's
// signal to render the plain Sprint 10 empty state.
async function loadProfileOverview(): Promise<ProfileOverview> {
  const response: CalyxaMessage = await chrome.runtime.sendMessage({ type: 'GET_PROFILE_OVERVIEW' });
  const payload = response.payload as GetProfileOverviewReplyPayload;
  if ('error' in payload) {
    throw new Error(payload.error);
  }
  return payload.overview;
}

// The overlay's End-session transport (Sprint 13, ADR-025): the EXISTING
// END_SESSION message -- the same background handler, RPC, and storage
// clear the popup uses, no parallel path. The reply is a SESSION_STATE
// (error-carrying on failure); the recap arrives separately via the
// SESSION_ENDED broadcast handled in main() below.
async function endSessionFromOverlay(): Promise<void> {
  const response: CalyxaMessage = await chrome.runtime.sendMessage({ type: 'END_SESSION' });
  const payload = response.payload as SessionStatePayload | undefined;
  if (payload?.error) {
    throw new Error(payload.error);
  }
}

// Set by sendAiTurn's voice-path branch above when a reply arrives, and
// consumed the moment TTS playback actually starts (handleVoicePlaybackStart
// below) -- the gap between the two is exactly the onSynthesize + audio-
// decode time Overlay.tsx's handleMicStop spends between them. undefined
// whenever no voice reply is currently waiting on a playback-start signal.
let pendingVoiceAnnotations: { annotations: Annotation[]; registry: EquationRegistry } | undefined;

// Wired to Overlay.tsx's onVoicePlaybackStart (Sprint 12 follow-up): reveals
// the held turn's annotations sequenced to the now-known speech duration
// (showTurnAnnotationsSequenced -- "point at what's currently being said",
// item 2 of the live annotation-precision follow-up) instead of showing
// them all at once. A no-op if nothing is pending (e.g. a text turn, which
// never sets pendingVoiceAnnotations in the first place).
function handleVoicePlaybackStart(durationMs: number): void {
  if (!pendingVoiceAnnotations) return;
  const { annotations, registry } = pendingVoiceAnnotations;
  pendingVoiceAnnotations = undefined;
  showTurnAnnotationsSequenced(annotations, registry, durationMs);
}

// The overlay's VOICE_STT/VOICE_TTS transports (Sprint 06). Same role as
// sendAiTurn above: the ONLY chrome.* surface threaded into the overlay for
// voice, relaying to the background worker and adding no host-page read.
// `audio` crosses the messaging boundary as base64 (ADR-010 — see the
// binary-over-messaging note in types/messages.ts), so each direction is
// encoded/decoded here, the mirror image of background/index.ts's helpers.
async function sendVoiceStt(audio: Utterance): Promise<{ transcript: string; sttMs: number }> {
  const message: CalyxaMessage = {
    type: 'VOICE_STT',
    payload: { audio: arrayBufferToBase64(audio.bytes), mimeType: audio.mimeType },
  };
  const response: CalyxaMessage = await chrome.runtime.sendMessage(message);
  const payload = response.payload as VoiceSttReplyPayload;
  if ('error' in payload) {
    throw new Error(payload.error);
  }
  return payload;
}

async function sendVoiceTts(text: string): Promise<{ audio: ArrayBuffer; ttsMs: number }> {
  const message: CalyxaMessage = { type: 'VOICE_TTS', payload: { text } };
  const response: CalyxaMessage = await chrome.runtime.sendMessage(message);
  const payload = response.payload as VoiceTtsReplyPayload;
  if ('error' in payload) {
    throw new Error(payload.error);
  }
  return { audio: base64ToArrayBuffer(payload.audio), ttsMs: payload.ttsMs };
}

/**
 * Streaming sibling of sendVoiceTts (Sprint 15 Task 6, ADR-033): opens the
 * VOICE_TTS_STREAM port (the same chrome.runtime.connect pattern sendAiTurn
 * uses for AI_STREAM above) instead of a one-shot sendMessage, so `onChunk`
 * fires as each base64 chunk arrives rather than waiting for one full-reply
 * VOICE_TTS_REPLY. sendVoiceTts above is UNTOUCHED and stays the fallback
 * Overlay.tsx falls back to per-utterance on a MediaSource/codec failure.
 */
async function sendVoiceTtsStream(text: string, onChunk: (chunk: Uint8Array) => void): Promise<{ ttsMs: number }> {
  return new Promise<{ ttsMs: number }>((resolve, reject) => {
    const port = chrome.runtime.connect({ name: 'VOICE_TTS_STREAM' });
    let settled = false;

    port.onMessage.addListener((msg: VoiceTtsStreamMessage) => {
      if (msg.type === 'chunk') {
        onChunk(base64ToUint8Array(msg.audio));
      } else if (msg.type === 'done' && !settled) {
        settled = true;
        port.disconnect();
        resolve({ ttsMs: msg.ttsMs });
      } else if (msg.type === 'error' && !settled) {
        settled = true;
        port.disconnect();
        reject(new Error(msg.error));
      }
    });

    port.onDisconnect.addListener(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Background disconnected unexpectedly during TTS streaming.'));
      }
    });

    port.postMessage({ text });
  });
}

/**
 * btoa/atob operate on binary strings, not bytes directly, so a typed-array
 * walk is needed on each side. Fine for a single short push-to-talk
 * utterance (ADR-010) -- this is not a bulk-data path.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/** Same walk as base64ToArrayBuffer, returning a Uint8Array view directly (VOICE_TTS_STREAM chunks feed a SourceBuffer, which wants a typed array, not an ArrayBuffer). */
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Calyxa content script.
//
// DOM policy (locked): READ-ONLY on the host page. This script must never
// read-modify any node, style, or attribute that belongs to the host page.
//
// The ONE sanctioned exception (ADR-002): the overlay lives in a shadow root on
// a single extension-owned host element, <calyxa-overlay>, appended to the
// document root and removed on dismissal. The shadow boundary isolates its
// styles, so nothing the overlay does is observable in the host page's light
// DOM. createShadowRootUi does not touch the host DOM until ui.mount() runs, so
// while the overlay is closed the host-page footprint is zero.
//
// Sprint 07 adds the first actual READ of host-page content: on every
// overlay EXPAND (Sprint 14 Task 6 -- moved from overlay mount, see
// handlePanelExpand above), extractPageContext() (pageExtractor.ts) makes a
// one-shot, synchronous, read-only pass over the page's math + visible
// text, excluding this script's own <calyxa-overlay> host. The result is
// held at module scope only long enough to attach to the next AI_TURN — it
// is never written to disk/DB (ADR-012/ADR-013).
export default defineContentScript({
  // (1) Inject on every page the student visits.
  matches: ['<all_urls>'],
  // Route the bundled overlay stylesheet INTO the shadow root (consumed by
  // createShadowRootUi below) instead of injecting it into the host page <head>.
  cssInjectionMode: 'ui',
  async main(ctx) {
    // (2) Confirm injection.
    console.log(`Calyxa content: injected on ${window.location.hostname}`);

    // (3) Two listeners, registered FIRST and synchronously — before any
    // `await` below — because the awaits that follow (CONTENT_READY,
    // GET_STATE, createShadowRootUi's stylesheet fetch) take real time and
    // either event can arrive in that window; both are queued if `overlayUi`
    // isn't built yet.
    //
    // SESSION_STATE (Sprint 10 Task 6 round 4): the background pushes this on
    // every sign-in/sign-out (not just as a GET_STATE reply — see
    // broadcastToAllTabs in background/index.ts) so the idle pill mounts or
    // unmounts live for every open tab, matching "the pill stays up as long
    // as the user is signed in" rather than requiring a page reload.
    //
    // TOGGLE_OVERLAY: the keyboard shortcut no longer mounts/removes the
    // overlay (that is now purely a function of signedIn) — it opens/closes
    // the expanded panel on an already-mounted idle pill instead, via a
    // window CustomEvent Overlay.tsx listens for. A page with no signed-in
    // user has nothing mounted to toggle, so the shortcut is a no-op there.
    // The panel-close signal (Overlay.tsx's handleClose, Sprint 12 Task 6):
    // a dismissed tutor leaves a clean page, so the annotation controller
    // clears whatever it's holding. Registered once for the content
    // script's whole lifetime, same as the listener below -- annotations
    // are controller-owned state independent of any one overlay mount.
    window.addEventListener(PANEL_CLOSED_EVENT, () => {
      clearAnnotations();
    });

    // The panel-EXPAND signal (Sprint 14 Task 6): fires on every real
    // expand -- see handlePanelExpand's own comment for why this replaces
    // the old onMount-time capture below. Registered once for the content
    // script's lifetime, same as the listener above.
    window.addEventListener(PANEL_EXPANDED_EVENT, handlePanelExpand);

    let pendingToggle = false;
    let pendingSignedIn: boolean | undefined;
    chrome.runtime.onMessage.addListener((message: CalyxaMessage) => {
      if (message.type === 'SESSION_STATE') {
        const { signedIn } = message.payload as SessionStatePayload;
        console.log('Calyxa content: SESSION_STATE pushed; signedIn =', signedIn);
        if (!overlayUi) {
          pendingSignedIn = signedIn;
          return;
        }
        applySignedIn(overlayUi, signedIn);
        return;
      }
      // SESSION_ENDED (Sprint 13, ADR-025): forwarded to the overlay as the
      // SESSION_RECAP_EVENT window CustomEvent (the 'calyxa:toggle-panel'
      // bridge). Registered once here for the content script's lifetime,
      // like the panel-close listener above; if no panel is mounted/open,
      // the event simply has no listener -- ephemeral by design.
      if (message.type === 'SESSION_ENDED') {
        const { recap } = (message.payload ?? {}) as SessionEndedPayload;
        window.dispatchEvent(
          new CustomEvent(SESSION_RECAP_EVENT, { detail: recap ? { recap } : {} }),
        );
        return;
      }
      if (message.type !== 'TOGGLE_OVERLAY') return;
      console.log('Calyxa content: TOGGLE_OVERLAY received; overlay ready =', !!overlayUi);
      if (!overlayUi) {
        pendingToggle = true;
        return;
      }
      if (overlayUi.mounted) {
        window.dispatchEvent(new CustomEvent('calyxa:toggle-panel'));
      }
    });

    // (4) Announce readiness to the background service worker (Sprint 01). The
    // worker may be asleep and sendMessage can throw / reject, so guard it.
    const message: CalyxaMessage = { type: 'CONTENT_READY' };
    try {
      const response = await chrome.runtime.sendMessage(message);
      if (response !== undefined) {
        console.log('Calyxa content: response from background', response);
      }
    } catch (error) {
      console.warn('Calyxa content: CONTENT_READY not acknowledged', error);
    }

    // (4b) Read the current signedIn state (Sprint 10 Task 6 round 4). The
    // idle pill's visibility tracks this directly rather than the keyboard
    // shortcut, so an already-authenticated user sees it on every page with
    // no shortcut press required. Defaults to signed-out if the query fails
    // (e.g. a cold service-worker wake) -- the SESSION_STATE push above
    // still catches up if the real state was signed-in.
    let signedInAtLoad = false;
    try {
      const stateResponse: CalyxaMessage = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      signedInAtLoad = (stateResponse?.payload as SessionStatePayload | undefined)?.signedIn ?? false;
    } catch (error) {
      console.warn('Calyxa content: GET_STATE not acknowledged', error);
    }

    // (5) Build the overlay UI once. createShadowRootUi is async because it
    // fetches the bundled stylesheet to inject into the shadow root. The host
    // element is appended to the document root (<html>) so it cannot be trapped
    // inside a host-page stacking context. Mounting itself is deferred to step
    // 6 below, which applies whichever signedIn state is freshest (the initial
    // read above, or a SESSION_STATE push that arrived while this was in flight).
    overlayUi = await createShadowRootUi<Root>(ctx, {
      name: 'calyxa-overlay',
      position: 'inline',
      anchor: document.documentElement,
      append: 'last',
      onMount: (container) => {
        // No PageContext capture here (Sprint 14 Task 6 -- the filed Sprint
        // 13 live-find): building the idle pill is NOT "the tutor is about
        // to need this page's content" the way expanding the panel is. See
        // handlePanelExpand and the PANEL_EXPANDED_EVENT listener above --
        // capturedPageContext/capturedEquationElements stay whatever they
        // were (undefined, before the first-ever expand) until that fires.
        return mountOverlay(container, {
          onSend: sendAiTurn,
          onTranscribe: sendVoiceStt,
          onSynthesize: sendVoiceTts,
          onSynthesizeStream: sendVoiceTtsStream,
          onVoicePlaybackStart: handleVoicePlaybackStart,
          onLoadOverview: loadProfileOverview,
          onEndSession: endSessionFromOverlay,
          onOpeningScan: requestOpeningScan,
        });
      },
      onRemove: (root) => {
        // Full annotation teardown (listeners, timers, the layer's dispatch
        // to an empty set) on overlay unmount / sign-out (Sprint 12 Task 7)
        // -- the shadow root's own removal already guarantees no pixel
        // survives, but the controller's window-level scroll/resize
        // listeners and ttl timers are outside that shadow root and need
        // their own cleanup.
        teardownAnnotations();
        if (root) unmountOverlay(root);
      },
    });

    // (6) Apply whichever signedIn state is freshest: a SESSION_STATE push
    // that arrived while createShadowRootUi was in flight (step 3) wins over
    // the step 4b snapshot, since it is strictly newer.
    applySignedIn(overlayUi, pendingSignedIn ?? signedInAtLoad);

    // Apply a toggle that arrived before setup finished (see step 3). Only
    // meaningful if the pill ended up mounted above -- signed-out has
    // nothing to open.
    if (pendingToggle && overlayUi.mounted) {
      console.log('Calyxa content: applying queued toggle from before overlay was ready');
      window.dispatchEvent(new CustomEvent('calyxa:toggle-panel'));
    }
  },
});

/** Mounts or removes the overlay host to match `signedIn`, idempotently. */
function applySignedIn(ui: ShadowRootContentScriptUi<Root>, signedIn: boolean): void {
  if (signedIn && !ui.mounted) {
    ui.mount();
  } else if (!signedIn && ui.mounted) {
    ui.remove();
  }
}
