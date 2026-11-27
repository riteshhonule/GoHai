import { useState } from 'react';
import { api } from './api';
import type { Conversation, ThreadMessage } from './types';

interface Props {
  workspace: string;
  conversation: Conversation;
  messages: ThreadMessage[];
  me: string;
  onChanged: () => void;
}

export function Thread({ workspace, conversation, messages, me, onChanged }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const { contact } = conversation;

  const run = async (action: () => Promise<unknown>, conflict?: string) => {
    setError('');
    try {
      await action();
      onChanged();
    } catch (e) {
      setError((e as { status?: number }).status === 409 && conflict ? conflict : 'Something went wrong. Try again.');
    }
  };

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText('');
    void run(() => api.reply(workspace, contact, body));
  };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header style={{ padding: 12, borderBottom: '1px solid #ddd' }}>
        <strong>{contact}</strong> · {conversation.state} · assignee: {conversation.assignee ?? 'none'}
        <span style={{ marginLeft: 12 }}>
          {conversation.assignee !== me && (
            <button onClick={() => run(() => api.claim(workspace, contact), 'Someone else already holds this conversation.')}>Claim</button>
          )}{' '}
          {conversation.state === 'open' ? (
            <button onClick={() => run(() => api.close(workspace, contact))}>Close</button>
          ) : (
            <button onClick={() => run(() => api.reopen(workspace, contact))}>Reopen</button>
          )}
        </span>
        {error && <div style={{ color: 'crimson' }}>{error}</div>}
      </header>
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {messages.map((m) => (
          <div key={`${m.direction}:${m.id}`} style={{ textAlign: m.direction === 'out' ? 'right' : 'left', margin: '6px 0' }}>
            <span style={{ display: 'inline-block', padding: '6px 10px', borderRadius: 8, background: m.direction === 'out' ? '#d6e9ff' : '#eee' }}>{m.text}</span>
            <div style={{ fontSize: 11, color: m.status === 'failed' ? 'crimson' : '#777' }}>
              {new Date(m.at).toLocaleTimeString()}
              {m.status ? ` · ${m.status}` : ''}
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={send} style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid #ddd' }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a reply" style={{ flex: 1 }} />
        <button type="submit">Send</button>
      </form>
    </section>
  );
}
