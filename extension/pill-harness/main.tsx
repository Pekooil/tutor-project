// Dev-only visual harness for the ambient pill (never shipped; not part of
// the WXT build). Mounts the REAL Overlay through the REAL mountOverlay with
// stubbed transports, so every pill state and transient surface can be
// eyeballed in a plain browser tab.
import { mountOverlay } from '../src/overlay/mount';
import type { HomeworkTransports, TurnResult } from '../src/overlay/Overlay';
import type { TurnMessage, SessionStartInfo } from '../src/types/messages';
import { readPageGrade, scanProblems } from '../src/content/problemScanner';
import type { HomeworkHistoryEntry, HomeworkSession, SetProblem } from '../src/overlay/homework/types';

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

// ---- v4 homework session (spec slice 1) ----
// The SCAN is the real one -- problemScanner.ts only reads the DOM, so the
// count, labels and graded verdict here are genuine. Everything that would
// cross a chrome.runtime boundary (storage, the concept model call) is held
// in memory instead.
let homeworkElements: (Element | null)[] = [];
let storedSession: HomeworkSession | null = null;
let storedHistory: HomeworkHistoryEntry[] = [];
let storedMuted = false;

function seedHistory(count: number, concept: string | null): HomeworkHistoryEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    concept,
    denominator: 8,
    totalSeconds: (48 + index * 4) * 60,
    endedAt: Date.now() - (index + 1) * 86_400_000,
    longestUnaidedRun: 3,
  }));
}

// Opener variants are driven by the URL so the seed is in place BEFORE the
// overlay mounts and reads it (the boot effect loads history once):
//   /                                  -> variant A (first session ever)
//   /?history=4                        -> variant C (prior set, same topic)
//   /?history=4&topic=Long%20division  -> variant B (pace, different topic)
{
  const params = new URLSearchParams(window.location.search);
  const count = Number.parseInt(params.get('history') ?? '', 10);
  if (Number.isFinite(count) && count > 0) {
    storedHistory = seedHistory(count, params.get('topic') ?? 'Factoring quadratics');
  }
}

Object.assign(window as unknown as Record<string, unknown>, {
  __cx: {
    seedHistory(count = 4, concept: string | null = 'Factoring quadratics') {
      storedHistory = seedHistory(count, concept);
      return storedHistory.length;
    },
    reset() {
      storedHistory = [];
      storedSession = null;
    },
    dump: () => ({ storedSession, storedHistory, storedMuted }),
  },
});

const homework: HomeworkTransports = {
  scan: () => {
    const result = scanProblems();
    homeworkElements = result.problems.map((problem) => problem.element);
    return {
      problems: result.problems.map<SetProblem>((problem) => ({
        label: problem.label,
        snippet: problem.snippet,
        sourceIndex: problem.index,
      })),
      graded: result.graded,
      confidence: result.confidence,
      locationKey: `${window.location.origin}${window.location.pathname}`,
      pageTitle: document.title,
    };
  },
  // Stands in for the one allowed model call, at a plausible latency well
  // inside the spec's 4s ceiling.
  concept: async () => {
    await delay(900);
    return 'Factoring quadratics';
  },
  locationKey: () => `${window.location.origin}${window.location.pathname}`,
  readPageGrade: (sourceIndex) => readPageGrade(homeworkElements[sourceIndex] ?? null),
  loadSession: async () => storedSession,
  saveSession: async (session) => {
    storedSession = session;
  },
  clearSession: async () => {
    storedSession = null;
  },
  loadHistory: async () => storedHistory,
  appendHistory: async (entry) => {
    storedHistory = [...storedHistory, entry];
  },
  loadMuted: async () => storedMuted,
  saveMuted: async (muted) => {
    storedMuted = muted;
  },
};

const root = document.getElementById('calyxa-root')!;
mountOverlay(root, {
  homework,
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
  onGetActiveSessionId: async () => undefined,
});
