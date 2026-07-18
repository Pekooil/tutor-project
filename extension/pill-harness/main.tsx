// Dev-only visual harness for the ambient pill (never shipped; not part of
// the WXT build). Mounts the REAL Overlay through the REAL mountOverlay with
// stubbed transports, so every pill state and transient surface can be
// eyeballed in a plain browser tab.
import { mountOverlay } from '../src/overlay/mount';
import type { TurnResult } from '../src/overlay/Overlay';
import type { TurnMessage, SessionStartInfo } from '../src/types/messages';

const REPLY =
  "Good place to start. Before reaching for the formula — what does the plus six tell you about the signs? $$x^2 - 5x + 6 = 0$$ becomes $$(x - 2)(x - 3) = 0$$ once the pair is right.";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fakeSend(
  _messages: TurnMessage[],
  onChunk?: (chunk: string) => void,
  _sessionStart?: SessionStartInfo,
): Promise<TurnResult> {
  await delay(900);
  if (onChunk) {
    for (const word of REPLY.split(' ')) {
      onChunk(word + ' ');
      await delay(70);
    }
  }
  return {
    reply: REPLY,
    chips: ['x = 2, x = 3', 'x = -2, x = -3'],
    solutionProgress: 0.45,
    pins: [
      {
        category: 'progress',
        kind: 'misconception-detected',
        conceptKey: 'quadratics.factoring',
        label: 'Watching: sign slips',
      },
    ],
  };
}

const root = document.getElementById('calyxa-root')!;
mountOverlay(root, {
  onSend: fakeSend,
  onSendVoiceStreaming: async () => {
    throw new Error('no voice backend in the harness');
  },
  onTranscribe: async () => {
    throw new Error('no voice backend in the harness');
  },
  onSynthesize: async () => {
    throw new Error('no voice backend in the harness');
  },
  onSynthesizeStream: async () => {
    throw new Error('no voice backend in the harness');
  },
  onVoicePlaybackStart: () => {},
  onEndSession: async () => {},
  onOpeningScan: async () => {
    await delay(1900);
    return {
      reply: 'Solve x^2 - 5x + 6 = 0 by factoring — problem 2 on this sheet.',
      topic: { conceptKey: 'quadratics.factoring', title: 'Factoring quadratic trinomials' },
      stickingCandidates: [
        { category: 'sign_error.factoring', description: 'picking +2 and +3 — the pair must add to −5' },
      ],
    };
  },
  onSendTelemetry: async () => {},
  onReportFeedback: async () => {},
  // Harness: report the first-run tour as already seen so surfaces under
  // test aren't pre-empted by the tutorial slot. Open with ?tutorial to
  // preview the tour itself.
  onFetchTutorialSeen: async () => !new URLSearchParams(window.location.search).has('tutorial'),
  onMarkTutorialSeen: async () => {},
  onGetActiveSessionId: async () => undefined,
});
