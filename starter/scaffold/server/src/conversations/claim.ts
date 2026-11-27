import { emitAssigned } from '../realtime/frames.js';
import { claimConversation } from './repo.js';

export type ClaimOutcome = { ok: true } | { ok: false; reason: 'taken' };

// Business rule: the first agent to claim holds the conversation; the holder
// may claim again; anyone else is refused.
export async function claim(workspace: string, contact: string, agent: string): Promise<ClaimOutcome> {
  if (!(await claimConversation(workspace, contact, agent))) return { ok: false, reason: 'taken' };
  // Idempotent per contact, so the holder claiming again adds no frame.
  await emitAssigned(workspace, contact, agent);
  return { ok: true };
}
