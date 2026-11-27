import { randomUUID } from 'node:crypto';
import { getStores } from '../pigeon/store.js';
import { emitEvent } from '../realtime/events.js';

// Close or reopen an existing conversation. Returns false if it does not exist.
// A frame is only sent when the state actually changed.
export async function setClosed(workspace: string, contact: string, closed: boolean): Promise<boolean> {
  const { contacts } = await getStores();
  const res = await contacts.updateOne({ workspace, contact, closed: closed ? { $ne: true } : true }, { $set: { closed } });
  if (res.modifiedCount) {
    await emitEvent(workspace, `state:${contact}:${randomUUID()}`, { type: closed ? 'conversation.closed' : 'conversation.reopened', contact });
    return true;
  }
  return (await contacts.countDocuments({ workspace, contact }, { limit: 1 })) > 0;
}
