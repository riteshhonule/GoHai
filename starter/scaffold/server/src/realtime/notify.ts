import { getRedis } from '../redis.js';

// Cross-instance wake-ups. The payload is only the workspace: the database is
// the source of truth for events, so a lost or duplicated wake-up cannot lose
// or duplicate a frame.
const PREFIX = 'sb:rt:';

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();
let subscribed = false;

function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  const sub = getRedis().duplicate();
  sub.on('pmessage', (_pattern: string, channel: string) => {
    const set = listeners.get(channel.slice(PREFIX.length));
    if (set) for (const fn of [...set]) fn();
  });
  sub.on('error', (err: Error) => console.error('realtime subscriber error', err.message));
  sub.psubscribe(`${PREFIX}*`).catch((err: Error) => {
    console.error('realtime subscribe failed', err.message);
    subscribed = false;
  });
}

export function publishWake(workspace: string): void {
  getRedis()
    .publish(PREFIX + workspace, '1')
    .catch((err: Error) => console.error('realtime publish failed', err.message));
}

// Returns an unsubscribe function.
export function onWake(workspace: string, fn: Listener): () => void {
  ensureSubscribed();
  let set = listeners.get(workspace);
  if (!set) listeners.set(workspace, (set = new Set()));
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(workspace);
  };
}
