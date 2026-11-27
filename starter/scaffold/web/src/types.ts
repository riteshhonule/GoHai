export interface Me {
  sub: string;
  name?: string;
  email?: string;
  workspaces: { id: string; role: 'admin' | 'agent' }[];
}

export interface Conversation {
  contact: string;
  assignee: string | null;
  state: 'open' | 'closed';
  last_activity_at: string | null;
}

export interface ThreadMessage {
  id: string;
  direction: 'in' | 'out';
  text: string;
  at: string;
  status?: 'queued' | 'sent' | 'delivered' | 'failed';
}

// A change pushed over the WebSocket. `seq` rises per workspace.
export interface Frame {
  seq: number;
  type: string;
  contact?: string;
  [key: string]: unknown;
}
