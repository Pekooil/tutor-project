// The scripted onboarding lesson (Option 1: interactive live demo).
//
// Builds the exact OverlayTransports the real Overlay expects, but every one is
// CANNED — no network, no AI, no auth, no cost, fully deterministic. This is the
// pill-harness pattern (pill-harness/main.tsx) productionized: the student drives
// the REAL pill (scan → check-in → type an answer) and gets a scripted coaching
// conversation about a fixed factoring problem, x² − 5x + 6 = 0.
//
// The two `on*` hooks let the page's coach strip react to real student actions
// (a scan tapped, a turn sent) without reaching into the Overlay's internals.
import type { MountOverlayOptions } from '../overlay/mount';
import type { TurnResult } from '../overlay/Overlay';
import type { TurnMessage } from '../types/messages';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Stream a reply word-by-word into onChunk (mirrors the real turn's animation),
// then resolve the full TurnResult.
async function streamReply(reply: string, rest: Omit<TurnResult, 'reply'>, onChunk?: (c: string) => void): Promise<TurnResult> {
  await delay(700);
  if (onChunk) {
    for (const word of reply.split(' ')) {
      onChunk(word + ' ');
      await delay(55);
    }
  }
  return { reply, ...rest };
}

// The tutor's two scripted beats. Turn 1 is the opener the Overlay auto-sends
// after the check-in; turn 2+ answers whatever the student typed. Both coach
// toward the next step and never hand over the final answer outright.
const OPENER =
  "Let's factor x² − 5x + 6 together. I won't just hand you the answer — I'll get you to the step you're missing. What two numbers multiply to +6 and add to −5?";
const FOLLOWUP =
  'Exactly — −2 and −3: they multiply to +6 and add to −5. So x² − 5x + 6 = (x − 2)(x − 3). Now set each factor to 0 — what are the two solutions?';

export type ScriptHooks = {
  /** Fired when the student taps the viewfinder (onOpeningScan runs). */
  onScan: () => void;
  /** Fired for each scripted turn; `turn` is 1-based. */
  onTurn: (turn: number) => void;
};

export function buildScriptedTransports(hooks: ScriptHooks): MountOverlayOptions {
  let turnCount = 0;

  const noVoice = async (): Promise<never> => {
    throw new Error('Voice is off in the demo — try typing your answer with the Aa button.');
  };

  return {
    onSend: async (_messages: TurnMessage[], onChunk?: (chunk: string) => void): Promise<TurnResult> => {
      turnCount += 1;
      hooks.onTurn(turnCount);
      if (turnCount <= 1) {
        return streamReply(
          OPENER,
          { chips: ['−2 and −3', '+2 and +3', '−1 and −6'], solutionProgress: 0.25 },
          onChunk,
        );
      }
      return streamReply(
        FOLLOWUP,
        { chips: ['x = 2, x = 3', 'x = −2, x = −3'], solutionProgress: 0.7 },
        onChunk,
      );
    },

    onOpeningScan: async () => {
      hooks.onScan();
      await delay(1400);
      return {
        reply: 'Looks like problem 2 — solve x² − 5x + 6 = 0 by factoring. Where are you with it?',
        topic: { conceptKey: 'quadratics.factoring', title: 'Factoring quadratic trinomials' },
        stickingCandidates: [
          { category: 'sign_error.factoring', description: 'picking +2 and +3 — the pair has to add to −5, not +5' },
        ],
      };
    },

    // Voice + all post-launch transports are inert in the demo (same posture as
    // the pill-harness): the demo is text-only and touches no backend.
    onSendVoiceStreaming: noVoice,
    onTranscribe: noVoice,
    onSynthesize: noVoice,
    onSynthesizeStream: noVoice,
    onVoicePlaybackStart: () => {},
    onEndSession: async () => {},
    onSendTelemetry: async () => {},
    onReportFeedback: async () => {},
    onGetActiveSessionId: async () => undefined,
  };
}
