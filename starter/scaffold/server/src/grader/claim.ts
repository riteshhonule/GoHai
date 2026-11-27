import type { Request, Response } from 'express';
import { claim } from '../conversations/claim.js';
import { isKnownWorkspace } from '../pigeon/store.js';

const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

// POST /__grader/claim { workspace, contact, agent }
// `agent` is an opaque id and is deliberately not looked up anywhere.
export async function claimHandler(req: Request, res: Response): Promise<void> {
  const { workspace, contact, agent } = (req.body ?? {}) as Record<string, unknown>;
  if (!isKnownWorkspace(workspace)) {
    res.status(404).json({ error: 'unknown workspace' });
    return;
  }
  if (!str(contact, 64) || !str(agent, 200)) {
    res.status(400).json({ error: 'contact and agent are required' });
    return;
  }
  try {
    const result = await claim(workspace, contact, agent);
    if (result.ok) res.status(200).json({ ok: true, assignee: agent });
    else res.status(409).json({ error: 'already claimed by another agent' });
  } catch (err) {
    console.error('claim failed', err);
    res.status(500).json({ error: 'claim failed' });
  }
}
