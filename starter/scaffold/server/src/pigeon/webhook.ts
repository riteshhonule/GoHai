import express, { type Request, type Response } from 'express';
import { emitEvent } from '../realtime/events.js';
import { emitStatus } from '../realtime/frames.js';
import { verifyPigeonSignature } from './signature.js';
import { ensureContact, getStores, isDuplicateKey, isKnownWorkspace, type OutboundStatus } from './store.js';

// Raw body only on this route: the signature covers the exact bytes Pigeon sent.
const rawBody = express.raw({ type: () => true, limit: '1mb' });

interface PigeonEvent {
  id: string;
  type: string;
  workspace: string;
  occurred_at: Date;
  data: Record<string, unknown>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

export function pigeonWebhook(app: express.Express): void {
  app.post('/webhooks/pigeon', rawBody, async (req: Request, res: Response) => {
    const body: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

    // 1. Signature first, on the raw bytes. Never a 5xx for a bad signature.
    const sig = verifyPigeonSignature(req.header('x-pigeon-signature'), body);
    if (!sig.ok) {
      res.status(401).json({ error: sig.reason });
      return;
    }

    // 2. Only now parse.
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch {
      res.status(400).json({ error: 'invalid json' });
      return;
    }
    if (!isObj(parsed)) {
      res.status(400).json({ error: 'body must be an object' });
      return;
    }

    const id = parsed.id ?? req.header('x-pigeon-event-id');
    const { type, workspace } = parsed;
    // Unknown event types and workspaces are acknowledged and ignored.
    if (typeof type !== 'string' || (type !== 'message.inbound' && type !== 'message.status')) {
      res.status(200).json({ ignored: 'unknown event type' });
      return;
    }
    if (!isKnownWorkspace(workspace)) {
      res.status(200).json({ ignored: 'unknown workspace' });
      return;
    }

    const occurred = new Date(typeof parsed.occurred_at === 'string' ? parsed.occurred_at : NaN);
    if (!nonEmpty(id) || !isObj(parsed.data) || Number.isNaN(occurred.getTime())) {
      res.status(400).json({ error: 'malformed event' });
      return;
    }
    const event: PigeonEvent = { id, type, workspace, occurred_at: occurred, data: parsed.data };

    try {
      const stores = await getStores();

      // 3. Durable journal of the event (unique on event id). A duplicate is fine.
      try {
        await stores.events.insertOne({
          event_id: event.id,
          type: event.type,
          workspace: event.workspace,
          occurred_at: event.occurred_at,
          received_at: new Date(),
          payload: parsed,
        });
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
      }

      // 4. Apply. Every effect is idempotent, so re-applying a duplicate (or an
      //    event whose first attempt crashed halfway) is safe.
      if (event.type === 'message.inbound') {
        if (!(await applyInbound(event))) {
          res.status(400).json({ error: 'malformed inbound event' });
          return;
        }
      } else {
        await applyStatus(event);
      }

      // 5. Only now acknowledge.
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error('webhook failed', err);
      // Not stored safely: let Pigeon retry.
      res.status(500).json({ error: 'temporarily unavailable' });
    }
  });
}

async function applyInbound(event: PigeonEvent): Promise<boolean> {
  const { message_id, from, text } = event.data;
  if (!nonEmpty(message_id) || !nonEmpty(from)) return false;
  const { messages } = await getStores();
  await ensureContact(event.workspace, from, event.occurred_at);
  try {
    await messages.updateOne(
      { message_id },
      {
        $setOnInsert: {
          workspace: event.workspace,
          contact: from,
          text: typeof text === 'string' ? text : '',
          // Ordering key is the provider's occurred_at, never arrival time.
          occurred_at: event.occurred_at,
          received_at: new Date(),
        },
      },
      { upsert: true },
    );
  } catch (err) {
    if (!isDuplicateKey(err)) throw err; // concurrent duplicate: already stored
  }
  // Idempotent by message id, so duplicates (and a retry after a crash between
  // the insert and this call) never produce a second frame.
  await emitEvent(event.workspace, `inbound:${message_id}`, {
    type: 'message.inbound',
    contact: from,
    message_id,
    text: typeof text === 'string' ? text : '',
    occurred_at: event.occurred_at.toISOString(),
  });
  return true;
}

const TERMINAL: OutboundStatus[] = ['delivered', 'failed'];

async function applyStatus(event: PigeonEvent): Promise<void> {
  const { client_ref, status, message_id } = event.data;
  if (!nonEmpty(client_ref) || typeof status !== 'string') return;
  const { outbound } = await getStores();

  // A status can only move forward: queued -> sent -> delivered|failed.
  // A late "sent" never overwrites a terminal status, and a terminal status is final.
  let allowedFrom: OutboundStatus[];
  if (status === 'sent') allowedFrom = ['queued'];
  else if (TERMINAL.includes(status as OutboundStatus)) allowedFrom = ['queued', 'sent'];
  else return; // unknown status values are ignored

  // Pigeon has the message, so the worker has nothing left to send.
  const updated = await outbound.findOneAndUpdate(
    { workspace: event.workspace, client_ref, status: { $in: allowedFrom } },
    {
      $set: {
        status: status as OutboundStatus,
        send_state: 'done',
        ...(nonEmpty(message_id) ? { pigeon_id: message_id } : {}),
      },
    },
    { returnDocument: 'after' },
  );
  // No match means an unknown message (ignored) or a stale/duplicate event. A
  // duplicate whose first attempt crashed before emitting still reaches its
  // frame: emitting is idempotent per (client_ref, status).
  const doc = updated ?? (await outbound.findOne({ workspace: event.workspace, client_ref, status: status as OutboundStatus }));
  if (doc) await emitStatus(doc.workspace, doc.contact, doc.client_ref, doc.status);
}
