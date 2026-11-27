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

export interface Stores {
  events: Collection<EventDoc>;
  messages: Collection<MessageDoc>;
  contacts: Collection<ContactDoc>;
  outbound: Collection<OutboundDoc>;
}

// Names of every collection that holds application data (cleared by reset).
export const APP_COLLECTIONS = ['pigeon_events', 'messages', 'contacts', 'outbound'] as const;

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
    events: db.collection<EventDoc>('pigeon_events'),
    messages: db.collection<MessageDoc>('messages'),
    contacts: db.collection<ContactDoc>('contacts'),
    outbound: db.collection<OutboundDoc>('outbound'),
  };
  // createIndex is idempotent, so concurrent processes can all call it.
  await Promise.all([
    stores.events.createIndex({ event_id: 1 }, { unique: true }),
    stores.messages.createIndex({ message_id: 1 }, { unique: true }),
    stores.messages.createIndex({ workspace: 1, contact: 1, occurred_at: 1, message_id: 1 }),
    stores.contacts.createIndex({ workspace: 1, contact: 1 }, { unique: true }),
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

// Create the contact if missing. Safe under concurrency.
export async function ensureContact(workspace: string, contact: string): Promise<void> {
  const { contacts } = await getStores();
  try {
    await contacts.updateOne(
      { workspace, contact },
      { $setOnInsert: { assignee: null, created_at: new Date() } },
      { upsert: true },
    );
  } catch (err) {
    if (!isDuplicateKey(err)) throw err; // lost the upsert race: the contact exists
  }
}
