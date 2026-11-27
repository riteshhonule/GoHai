import { getStores } from '../pigeon/store.js';

export interface ConversationSummary {
  contact: string;
  assignee: string | null;
  state: 'open' | 'closed';
  last_activity_at: string | null;
}

// Newest activity first, paginated by offset.
export async function listConversations(workspace: string, limit: number, offset: number): Promise<ConversationSummary[]> {
  const { contacts } = await getStores();
  const rows = await contacts
    .find({ workspace })
    .sort({ last_activity_at: -1, created_at: -1, contact: 1 })
    .skip(offset)
    .limit(limit)
    .toArray();
  return rows.map((c) => ({
    contact: c.contact,
    assignee: c.assignee ?? null,
    state: c.closed ? 'closed' : 'open',
    last_activity_at: c.last_activity_at ? c.last_activity_at.toISOString() : null,
  }));
}
