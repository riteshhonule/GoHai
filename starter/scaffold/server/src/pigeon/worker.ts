import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { getStores, type OutboundDoc } from './store.js';
import { onWake, sendToPigeon } from './send.js';
import { cooloffRemainingMs, setCooloff, takeToken, workspacesCoolingOff } from './ratelimit.js';

const CONCURRENCY = 6;
const IDLE_POLL_MS = 250;
// A claim that is not finished within the lease is treated as abandoned (the
// process died) and any worker may take it over. Must exceed the 8 s request
// timeout; kept well under the 60 s failover budget.
const LEASE_MS = 20000;
const MAX_TOKEN_WAIT_MS = 2000;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 10000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let started = false;
let stopping = false;
const sleepers = new Set<() => void>();

// Start the outbound worker once per process. Safe to call twice.
export function startWorker(): void {
  if (started) return;
  started = true;
  onWake(() => {
    for (const wakeUp of [...sleepers]) wakeUp();
  });
  for (let i = 0; i < CONCURRENCY; i++) void runLoop(i);
}

export function stopWorker(): void {
  stopping = true;
}

async function runLoop(id: number): Promise<void> {
  while (!stopping) {
    let worked = false;
    try {
      worked = await tick();
    } catch (err) {
      console.error(`worker ${id} error`, err instanceof Error ? err.message : err);
    }
    if (!worked) await idle(IDLE_POLL_MS);
  }
}

// Sleep until the timeout or until a new reply is enqueued in this process.
function idle(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(t);
      sleepers.delete(done);
      resolve();
    };
    const t = setTimeout(done, ms);
    sleepers.add(done);
  });
}

// Atomically claim one due message. findOneAndUpdate is atomic, so across
// threads and processes only one claimant gets a given document. A message
// whose lease expired (crashed worker) is claimable again.
async function claim(): Promise<OutboundDoc | null> {
  const { outbound } = await getStores();
  const now = Date.now();
  const cooling = await workspacesCoolingOff(Object.keys(config.pigeon.apiKeys));
  const claimId = randomUUID();
  return outbound.findOneAndUpdate(
    {
      ...(cooling.length ? { workspace: { $nin: cooling } } : {}),
      $or: [
        { send_state: 'pending', next_attempt_at: { $lte: now } },
        { send_state: 'inflight', lease_until: { $lte: now } },
      ],
    },
    { $set: { send_state: 'inflight', claim_id: claimId, lease_until: now + LEASE_MS }, $inc: { attempts: 1 } },
    { sort: { next_attempt_at: 1 }, returnDocument: 'after' },
  );
}

// Return the message to the queue, only if this worker still owns the claim.
async function release(doc: OutboundDoc, delayMs: number, error?: string, refundAttempt = false): Promise<void> {
  const { outbound } = await getStores();
  await outbound.updateOne(
    { workspace: doc.workspace, client_ref: doc.client_ref, claim_id: doc.claim_id, send_state: 'inflight' },
    {
      $set: { send_state: 'pending', next_attempt_at: Date.now() + delayMs, claim_id: null, ...(error ? { last_error: error } : {}) },
      ...(refundAttempt ? { $inc: { attempts: -1 } } : {}),
    },
  );
}

function backoff(attempts: number): number {
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));
  return Math.round(exp / 2 + Math.random() * (exp / 2)); // jitter
}

async function tick(): Promise<boolean> {
  const doc = await claim();
  if (!doc) return false;
  const { outbound } = await getStores();

  // 1. Shared workspace cool-off (another process may have just seen a 429).
  const cool = await cooloffRemainingMs(doc.workspace);
  if (cool > 0) {
    await release(doc, cool, undefined, true);
    return true;
  }
  // 2. Shared token bucket across all processes.
  const wait = await takeToken(doc.workspace);
  if (wait > 0) {
    if (wait > MAX_TOKEN_WAIT_MS) {
      await release(doc, wait, undefined, true);
      return true;
    }
    await sleep(wait);
    // Re-check the cool-off that may have started while we waited.
    const again = await cooloffRemainingMs(doc.workspace);
    if (again > 0) {
      await release(doc, again, undefined, true);
      return true;
    }
  }

  // 3. Send, with the same Idempotency-Key on every attempt.
  const result = await sendToPigeon(doc);
  switch (result.kind) {
    case 'accepted':
      // Accepted is not delivered: the visible status stays "queued" until the
      // status webhook says otherwise. We only stop sending.
      await outbound.updateOne(
        { workspace: doc.workspace, client_ref: doc.client_ref, claim_id: doc.claim_id, send_state: 'inflight' },
        { $set: { send_state: 'done', ...(result.pigeonId ? { pigeon_id: result.pigeonId } : {}) } },
      );
      break;
    case 'rate_limited': {
      const ms = result.retryAfterMs + 100;
      await setCooloff(doc.workspace, ms);
      await release(doc, ms, 'rate limited', true); // a 429 is not a failed attempt
      break;
    }
    case 'retry':
      await release(doc, backoff(doc.attempts), result.reason);
      break;
    case 'fatal':
      // Permanent rejection: nothing to retry. Only fail if no webhook already moved it on.
      await outbound.updateOne(
        { workspace: doc.workspace, client_ref: doc.client_ref, claim_id: doc.claim_id, send_state: 'inflight' },
        { $set: { send_state: 'done', last_error: result.reason } },
      );
      await outbound.updateOne(
        { workspace: doc.workspace, client_ref: doc.client_ref, status: 'queued' },
        { $set: { status: 'failed' } },
      );
      break;
  }
  return true;
}
