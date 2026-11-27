import { claimConversation } from './repo.js';

export type ClaimOutcome = { ok: true } | { ok: false; reason: 'taken' };

// Business rule: the first agent to claim holds the conversation; the holder
// may claim again; anyone else is refused.
export async function claim(workspace: string, contact: string, agent: string): Promise<ClaimOutcome> {
  return (await claimConversation(workspace, contact, agent)) ? { ok: true } : { ok: false, reason: 'taken' };
}
