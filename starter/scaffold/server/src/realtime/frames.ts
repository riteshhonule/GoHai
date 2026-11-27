import { emitEvent } from './events.js';

// Frame builders shared by every place that changes state.
export const emitStatus = (workspace: string, contact: string, clientRef: string, status: string): Promise<void> =>
  emitEvent(workspace, `status:${clientRef}:${status}`, { type: 'message.status', contact, client_ref: clientRef, status });

// A conversation is claimed once and never released, so one key per contact.
export const emitAssigned = (workspace: string, contact: string, assignee: string): Promise<void> =>
  emitEvent(workspace, `assigned:${contact}`, { type: 'conversation.assigned', contact, assignee });
