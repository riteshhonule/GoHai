import { config } from '../config.js';
import { emitEvent } from '../realtime/events.js';
import { ensureContact, getStores, isDuplicateKey, type OutboundDoc } from './store.js';

export const REQUEST_TIMEOUT_MS = 8000;

export interface ReplyInput {
  workspace: string;
  contact: string;
  client_ref: string;
  text: string;
}

// Persist a reply (status "queued") so a worker can send it. Idempotent on
// (workspace, client_ref): the same reply asked twice, even concurrently, is
// one row. The caller may answer 202 once this resolves.
export async function enqueueReply(input: ReplyInput): Promise<void> {
  const { outbound } = await getStores();
  await ensureContact(input.workspace, input.contact, new Date());
  const doc: OutboundDoc = {
    workspace: input.workspace,
    contact: input.contact,
    client_ref: input.client_ref,
    text: input.text,
    // Derived only from the reply's identity, so every retry reuses it.
    idempotency_key: `sb:${input.workspace}:${input.client_ref}`,
    status: 'queued',
    send_state: 'pending',
    attempts: 0,
    next_attempt_at: Date.now(),
    lease_until: 0,
    claim_id: null,
    created_at: new Date(),
  };
  try {
    await outbound.insertOne(doc);
  } catch (err) {
    if (!isDuplicateKey(err)) throw err; // already stored: still a success
  }
  // Tell other agents a reply exists (idempotent per client_ref).
  await emitEvent(input.workspace, `outbound:${input.client_ref}`, {
    type: 'message.outbound',
    contact: input.contact,
    client_ref: input.client_ref,
    text: input.text,
    status: 'queued',
  });
  wake();
}

// ---- wake-up for the in-process worker ----
let wakeFn: (() => void) | undefined;
export function onWake(fn: () => void): void {
  wakeFn = fn;
}
function wake(): void {
  wakeFn?.();
}

// ---- HTTP client ----
export type SendResult =
  | { kind: 'accepted'; pigeonId?: string }
  | { kind: 'rate_limited'; retryAfterMs: number }
  | { kind: 'retry'; reason: string }
  | { kind: 'fatal'; status: number; reason: string };

function parseRetryAfter(value: string | null): number {
  if (!value) return 1000;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return 1000;
}

export async function sendToPigeon(doc: Pick<OutboundDoc, 'workspace' | 'contact' | 'client_ref' | 'text' | 'idempotency_key'>): Promise<SendResult> {
  const key = config.pigeon.apiKeys[doc.workspace];
  if (!key) return { kind: 'fatal', status: 0, reason: 'no api key for workspace' };

  let res: Response;
  try {
    res = await fetch(`${config.pigeon.url}/v1/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        'idempotency-key': doc.idempotency_key,
      },
      body: JSON.stringify({ to: doc.contact, text: doc.text, client_ref: doc.client_ref }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    // Timeout or network error: Pigeon may still have delivered it. Retrying
    // with the same Idempotency-Key is safe and returns the original result.
    return { kind: 'retry', reason: err instanceof Error ? err.name : 'network error' };
  }

  if (res.ok) {
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    return { kind: 'accepted', pigeonId: typeof body.id === 'string' ? body.id : undefined };
  }
  await res.arrayBuffer().catch(() => undefined); // release the connection
  if (res.status === 429) return { kind: 'rate_limited', retryAfterMs: parseRetryAfter(res.headers.get('retry-after')) };
  if (res.status === 408 || res.status >= 500) return { kind: 'retry', reason: `http ${res.status}` };
  return { kind: 'fatal', status: res.status, reason: `http ${res.status}` };
}
