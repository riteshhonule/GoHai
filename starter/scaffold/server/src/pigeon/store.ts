import type { Collection } from 'mongodb';
import { getDb } from '../db.js';
import { config } from '../config.js';

export type OutboundStatus = 'queued' | 'sent' | 'delivered' | 'failed';

export interface EventDoc {
  event_id: string;
  type: string;
  workspace: string;
  occurred_at: Date;
  received_at: Date;
  payload: unknown;
}

export interface MessageDoc {
  message_id: string;
  workspace: string;
  contact: string;
  text: string;
  occurred_at: Date;
  received_at: Date;
}

export interface ContactDoc {
  workspace: string;
  contact: string;
  assignee: string | null;
  closed?: boolean; // absent means open
  last_activity_at?: Date;
  created_at: Date;
}

export interface OutboundDoc {
  workspace: string;
  contact: string;
  client_ref: string;
  text: string;
  idempotency_key: string;
  // Visible status. Only webhooks move it past 'queued'.
  status: OutboundStatus;
  // Internal delivery-to-Pigeon state, separate from the visible status.
  send_state: 'pending' | 'inflight' | 'done';
  attempts: number;
  next_attempt_at: number; // epoch ms
  lease_until: number; // epoch ms, only meaningful while inflight
  claim_id: string | null;
  pigeon_id?: string;
  last_error?: string;
  created_at: Date;
}

// A change reported to browsers. `seq` rises per workspace; `key` makes
// emitting the same change twice a no-op.
export interface RealtimeEventDoc {
  workspace: string;
  seq: number;
  key: string;
  frame: Record<string, unknown>;
  created_at: Date;
}

export interface CounterDoc {
  _id: string; // workspace
  seq: number;
}

export interface Stores {
  realtime: Collection<RealtimeEventDoc>;
  counters: Collection<CounterDoc>;
  events: Collection<EventDoc>;
  messages: Collection<MessageDoc>;
  contacts: Collection<ContactDoc>;
  outbound: Collection<OutboundDoc>;
}

let storesPromise: Promise<Stores> | undefined;

export function getStores(): Promise<Stores> {
  if (!storesPromise) {
    storesPromise = init().catch((err) => {
      storesPromise = undefined; // allow a retry, e.g. when Mongo was not up yet
      throw err;
    });
  }
  return storesPromise;
}

async function init(): Promise<Stores> {
  const db = await getDb();
  const stores: Stores = {
    realtime: db.collection<RealtimeEventDoc>('realtime_events'),
    counters: db.collection<CounterDoc>('counters'),
    events: db.collection<EventDoc>('pigeon_events'),
    messages: db.collection<MessageDoc>('messages'),
    contacts: db.collection<ContactDoc>('contacts'),
    outbound: db.collection<OutboundDoc>('outbound'),
  };
  // createIndex is idempotent, so concurrent processes can all call it.
  await Promise.all([
    stores.realtime.createIndex({ workspace: 1, seq: 1 }, { unique: true }),
    stores.realtime.createIndex({ workspace: 1, key: 1 }, { unique: true }),
    stores.events.createIndex({ event_id: 1 }, { unique: true }),
    stores.messages.createIndex({ message_id: 1 }, { unique: true }),
    stores.messages.createIndex({ workspace: 1, contact: 1, occurred_at: 1, message_id: 1 }),
    stores.contacts.createIndex({ workspace: 1, contact: 1 }, { unique: true }),
    stores.contacts.createIndex({ workspace: 1, last_activity_at: -1 }),
    stores.outbound.createIndex({ workspace: 1, client_ref: 1 }, { unique: true }),
    stores.outbound.createIndex({ send_state: 1, next_attempt_at: 1 }),
    stores.outbound.createIndex({ send_state: 1, lease_until: 1 }),
  ]);
  return stores;
}

export function isKnownWorkspace(ws: unknown): ws is string {
  return typeof ws === 'string' && Object.prototype.hasOwnProperty.call(config.pigeon.apiKeys, ws);
}

export function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

// Create the contact if missing and record activity (used to order the inbox,
// newest first). Safe under concurrency; activity only ever moves forward.
export async function ensureContact(workspace: string, contact: string, activityAt?: Date): Promise<void> {
  const { contacts } = await getStores();
  try {
    await contacts.updateOne(
      { workspace, contact },
      {
        $setOnInsert: { assignee: null, created_at: new Date() },
        ...(activityAt ? { $max: { last_activity_at: activityAt } } : {}),
      },
      { upsert: true },
    );
  } catch (err) {
    if (!isDuplicateKey(err)) throw err; // lost the upsert race: the contact exists
  }
}
