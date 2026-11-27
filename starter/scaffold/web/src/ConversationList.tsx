import type { Conversation } from './types';

interface Props {
  conversations: Conversation[];
  selected: string | null;
  me: string;
  onSelect: (contact: string) => void;
}

export function ConversationList({ conversations, selected, me, onSelect }: Props) {
  if (!conversations.length) return <p style={{ padding: 12 }}>No conversations yet.</p>;
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {conversations.map((c) => (
        <li key={c.contact}>
          <button
            onClick={() => onSelect(c.contact)}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 0, borderBottom: '1px solid #ddd', background: c.contact === selected ? '#e8f0fe' : 'white', cursor: 'pointer' }}
          >
            <strong>{c.contact}</strong>
            <div style={{ fontSize: 12, color: '#555' }}>
              {c.state === 'closed' ? 'closed' : 'open'} · {c.assignee ? (c.assignee === me ? 'you' : c.assignee) : 'unassigned'}
              {c.last_activity_at ? ` · ${new Date(c.last_activity_at).toLocaleTimeString()}` : ''}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
