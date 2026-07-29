import type { HomeworkHistoryEntry, HomeworkSession } from '../overlay/homework/types';

// Homework-session persistence (spec §7). chrome.storage.LOCAL, deliberately
// -- unlike the auth tokens in storage.ts (session storage, ADR-006/PLAN §2.2,
// never on disk), a homework session MUST survive a tab crash, a browser
// restart, and going offline. That is the entire point of resume.
//
// What lands here is the student's own progress bookkeeping: problem labels,
// short problem snippets read off the page they are already looking at,
// outcomes, and durations. No tokens, no transcripts, no audio.
//
// Local remains the source of truth for the WORKING portion of a set, and
// always will be -- a tap must never wait on the network. ADR-057 added the
// server half on top of that, not in place of it: a set is mirrored to
// `homework_session` through the queue at the bottom of this file, so the
// Studio dashboard can show progress that outlives one browser profile. "Never
// let a sync failure block or lose a tap" is upheld by the queue's posture
// (every write below swallows rather than rejects), not by the absence of a
// sync. Slice 1 shipped with no sync at all (Darcy's call, 2026-07-29).
//
// What is mirrored is deliberately narrower than what is stored here: the sync
// payload (content/index.ts's toSyncPayload) carries labels, outcomes,
// durations and totals, and NEVER `snippet`. Problem text stays on this device
// and reaches the server only when the student opens a tutoring detour, as an
// ordinary session turn. Keep it that way -- /privacy and the Chrome data-safety
// disclosure both state it as fact (ADR-046).

const ACTIVE_KEY = 'calyxa_homework_active';
const HISTORY_KEY = 'calyxa_homework_history';
const MUTED_KEY = 'calyxa_homework_muted';
const SYNC_QUEUE_KEY = 'calyxa_homework_sync_queue';

/** Enough history for a stable pace estimate; bounded so storage can't grow. */
const MAX_HISTORY = 40;

function storage(): chrome.storage.StorageArea | null {
  // The overlay's own test harness and the vitest specs run with no chrome.*
  // at all; every read degrades to "nothing stored" rather than throwing.
  return typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null;
}

export async function loadActiveHomework(): Promise<HomeworkSession | null> {
  const area = storage();
  if (!area) return null;
  try {
    const stored = await area.get(ACTIVE_KEY);
    return (stored[ACTIVE_KEY] as HomeworkSession | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Called after EVERY tap (spec §7). Fire-and-forget by contract: a write that
 * fails must never block or lose the tap the student already saw acknowledged,
 * so this swallows rather than rejects.
 */
export async function saveActiveHomework(session: HomeworkSession): Promise<void> {
  const area = storage();
  if (!area) return;
  try {
    await area.set({ [ACTIVE_KEY]: session });
  } catch {
    // Quota/serialization failure -- the in-memory session is still correct
    // and the student loses nothing until they close the tab.
  }
}

export async function clearActiveHomework(): Promise<void> {
  const area = storage();
  if (!area) return;
  try {
    await area.remove(ACTIVE_KEY);
  } catch {
    // Same posture as saveActiveHomework.
  }
}

export async function loadHomeworkHistory(): Promise<HomeworkHistoryEntry[]> {
  const area = storage();
  if (!area) return [];
  try {
    const stored = await area.get(HISTORY_KEY);
    const entries = stored[HISTORY_KEY] as HomeworkHistoryEntry[] | undefined;
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

/** Appends one completed set, newest last, bounded at MAX_HISTORY. */
export async function appendHomeworkHistory(entry: HomeworkHistoryEntry): Promise<void> {
  const area = storage();
  if (!area) return;
  try {
    const existing = await loadHomeworkHistory();
    const next = [...existing, entry].slice(-MAX_HISTORY);
    await area.set({ [HISTORY_KEY]: next });
  } catch {
    // A lost history entry costs a slightly less precise pace estimate later.
  }
}

// ---- The server-sync queue (ADR-057) ------------------------------------
//
// A set is enqueued when it completes or pauses, and only leaves the queue
// once the server has confirmed that exact id. Local storage stays the source
// of truth throughout; this is a mirror with a retry, and a student mid-set
// must never feel it.

/** Bounded so a long offline stretch can't grow storage without limit. */
const MAX_SYNC_QUEUE = 20;

export async function loadSyncQueue(): Promise<HomeworkSession[]> {
  const area = storage();
  if (!area) return [];
  try {
    const stored = await area.get(SYNC_QUEUE_KEY);
    const queued = stored[SYNC_QUEUE_KEY] as HomeworkSession[] | undefined;
    return Array.isArray(queued) ? queued : [];
  } catch {
    return [];
  }
}

/**
 * Adds (or replaces) one session in the queue, keyed on its id -- a set that
 * pauses twice must not enqueue twice, and the LATER state is the one worth
 * sending.
 */
export async function enqueueForSync(session: HomeworkSession): Promise<void> {
  const area = storage();
  if (!area) return;
  try {
    const existing = await loadSyncQueue();
    const next = [...existing.filter((entry) => entry.id !== session.id), session].slice(-MAX_SYNC_QUEUE);
    await area.set({ [SYNC_QUEUE_KEY]: next });
  } catch {
    // A lost queue entry costs one set on the dashboard, never the set itself.
  }
}

/** Drops the ids the server confirmed, keeping everything it didn't. */
export async function clearSynced(ids: readonly string[]): Promise<void> {
  const area = storage();
  if (!area || ids.length === 0) return;
  try {
    const remaining = (await loadSyncQueue()).filter((entry) => !ids.includes(entry.id));
    await area.set({ [SYNC_QUEUE_KEY]: remaining });
  } catch {
    // Worst case the same set syncs again -- the upsert is idempotent.
  }
}

/** The single persistent sound toggle (spec §9.2). */
export async function loadSoundMuted(): Promise<boolean> {
  const area = storage();
  if (!area) return false;
  try {
    const stored = await area.get(MUTED_KEY);
    return stored[MUTED_KEY] === true;
  } catch {
    return false;
  }
}

export async function saveSoundMuted(muted: boolean): Promise<void> {
  const area = storage();
  if (!area) return;
  try {
    await area.set({ [MUTED_KEY]: muted });
  } catch {
    // The in-memory toggle still applies for this page's lifetime.
  }
}
