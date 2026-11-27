import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { ConversationList } from './ConversationList';
import { Thread } from './Thread';
import type { Conversation, Frame, Me, ThreadMessage } from './types';
import { useLive } from './useLive';

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined: loading, null: signed out
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);

  useEffect(() => {
    api.me().then(
      (m) => {
        setMe(m);
        setWorkspace(m.workspaces[0]?.id ?? null);
      },
      () => setMe(null),
    );
  }, []);

  const loadList = useCallback(() => {
    if (workspace) api.conversations(workspace).then(setConversations, () => undefined);
  }, [workspace]);

  const loadThread = useCallback(() => {
    if (workspace && selected) api.messages(workspace, selected).then(setMessages, () => undefined);
  }, [workspace, selected]);

  useEffect(() => {
    setSelected(null);
    setMessages([]);
    loadList();
  }, [loadList]);

  useEffect(() => {
    setMessages([]);
    loadThread();
  }, [loadThread]);

  // Any change refreshes the list; the open thread refreshes if it was affected.
  useLive(workspace, (f: Frame) => {
    loadList();
    if (f.type === 'reconnected' || f.contact === selected) loadThread();
  });

  if (me === undefined) return <p style={{ padding: 24 }}>Loading…</p>;
  if (me === null) {
    return (
      <main style={{ font: '16px system-ui', maxWidth: 480, margin: '80px auto' }}>
        <h1>Switchboard</h1>
        <a href="/auth/login">Sign in</a>
      </main>
    );
  }

  const current = conversations.find((c) => c.contact === selected);
  return (
    <div style={{ font: '15px system-ui', display: 'grid', gridTemplateColumns: '300px 1fr', gridTemplateRows: 'auto 1fr', height: '100vh' }}>
      <header style={{ gridColumn: '1 / 3', padding: 10, borderBottom: '1px solid #ccc', display: 'flex', gap: 12, alignItems: 'center' }}>
        <strong>Switchboard</strong>
        <span>{me.name ?? me.sub}</span>
        <label>
          Workspace{' '}
          <select value={workspace ?? ''} onChange={(e) => setWorkspace(e.target.value)}>
            {me.workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.id} ({w.role})
              </option>
            ))}
          </select>
        </label>
      </header>
      <nav style={{ overflow: 'auto', borderRight: '1px solid #ccc' }}>
        <ConversationList conversations={conversations} selected={selected} me={me.sub} onSelect={setSelected} />
      </nav>
      <main style={{ minHeight: 0 }}>
        {workspace && current ? (
          <Thread workspace={workspace} conversation={current} messages={messages} me={me.sub} onChanged={() => { loadList(); loadThread(); }} />
        ) : (
          <p style={{ padding: 12 }}>Select a conversation.</p>
        )}
      </main>
    </div>
  );
}
