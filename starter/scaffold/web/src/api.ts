import type { Conversation, Me, ThreadMessage } from './types';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init });
  if (!res.ok) throw Object.assign(new Error(`${res.status}`), { status: res.status });
  return (await res.json()) as T;
}

const post = <T,>(path: string, body: unknown) =>
  call<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const q = (workspace: string, contact?: string) => new URLSearchParams(contact ? { workspace, contact } : { workspace }).toString();

export const api = {
  me: () => call<Me>('/api/me'),
  conversations: (ws: string) => call<{ conversations: Conversation[] }>(`/api/conversations?${q(ws)}`).then((r) => r.conversations),
  messages: (ws: string, contact: string) => call<{ messages: ThreadMessage[] }>(`/api/messages?${q(ws, contact)}`).then((r) => r.messages),
  reply: (workspace: string, contact: string, text: string) => post('/api/reply', { workspace, contact, text, client_ref: crypto.randomUUID() }),
  claim: (workspace: string, contact: string) => post('/api/claim', { workspace, contact }),
  close: (workspace: string, contact: string) => post('/api/close', { workspace, contact }),
  reopen: (workspace: string, contact: string) => post('/api/reopen', { workspace, contact }),
};
