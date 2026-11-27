import type { WebSocket } from 'ws';
import { eventsAfter } from './events.js';
import { onWake } from './notify.js';

const BATCH = 200;
const GAP_RETRY_MS = 100;
const GAP_GIVE_UP_MS = 1500;
const FALLBACK_POLL_MS = 2000;

// Streams a workspace's events to one socket, strictly in seq order, starting
// after `after`. Replay and live delivery are the same loop reading the same
// table, so a frame can neither be sent twice nor fall between the two.
export function startPump(socket: WebSocket, workspace: string, after: number): void {
  let last = after;
  let running = false;
  let again = false;
  let gapSince = 0;
  let closed = false;
  let gapTimer: NodeJS.Timeout | undefined;

  const run = async (): Promise<void> => {
    if (closed) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      let more = true;
      while (more && !closed) {
        const events = await eventsAfter(workspace, last, BATCH);
        more = events.length === BATCH;
        for (const e of events) {
          // A higher seq can be visible before a lower one finishes being written.
          // Hold back briefly for the missing one, then move on if it never shows.
          if (e.seq > last + 1) {
            gapSince ||= Date.now();
            if (Date.now() - gapSince < GAP_GIVE_UP_MS) {
              gapTimer ??= setTimeout(() => {
                gapTimer = undefined;
                void run();
              }, GAP_RETRY_MS);
              more = false;
              break;
            }
          }
          gapSince = 0;
          last = e.seq;
          if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(e.frame));
        }
      }
    } catch (err) {
      console.error('socket pump failed', err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
    if (again) {
      again = false;
      void run();
    }
  };

  const unsubscribe = onWake(workspace, () => void run());
  const poll = setInterval(() => void run(), FALLBACK_POLL_MS); // covers a missed wake-up
  socket.on('close', () => {
    closed = true;
    unsubscribe();
    clearInterval(poll);
    if (gapTimer) clearTimeout(gapTimer);
  });
  socket.on('error', () => socket.close());
  void run();
}
