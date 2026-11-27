import { getStores, type OutboundStatus } from '../pigeon/store.js';

export interface ThreadMessage {
  id: string; // message_id for inbound, client_ref for outbound
  direction: 'in' | 'out';
  text: string;
  at: string;
  status?: OutboundStatus;
}

const LIMIT = 500;

// Inbound messages ordered by the provider's occurred_at, outbound by when the
// reply was accepted, merged oldest first.
export async function getThread(workspace: string, contact: string): Promise<ThreadMessage[]> {
  const { messages, outbound } = await getStores();
  const [inbound, outbounds] = await Promise.all([
    messages.find({ workspace, contact }).sort({ occurred_at: 1, message_id: 1 }).limit(LIMIT).toArray(),
    outbound.find({ workspace, contact }).sort({ created_at: 1 }).limit(LIMIT).toArray(),
  ]);
  const all: Array<ThreadMessage & { ts: number }> = [
    ...inbound.map((m) => ({ id: m.message_id, direction: 'in' as const, text: m.text, at: m.occurred_at.toISOString(), ts: m.occurred_at.getTime() })),
    ...outbounds.map((o) => ({ id: o.client_ref, direction: 'out' as const, text: o.text, at: o.created_at.toISOString(), ts: o.created_at.getTime(), status: o.status })),
  ];
  all.sort((a, b) => a.ts - b.ts);
  return all.map(({ ts: _ts, ...rest }) => rest);
}
