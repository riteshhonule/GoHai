import { createHash, timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from '../config.js';
import { claimHandler } from './claim.js';
import { enqueueReply } from '../pigeon/send.js';
import { clearRateLimitState } from '../pigeon/ratelimit.js';
import { getStores, isKnownWorkspace } from '../pigeon/store.js';

const sha = (s: string) => createHash('sha256').update(s).digest();

function requireToken(req: Request, res: Response, next: NextFunction): void {
  const got = req.header('x-grader-token');
  if (!got || !timingSafeEqual(sha(got), sha(config.graderToken))) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

export function graderRoutes(): express.Router {
  const router = express.Router();
  // JSON parsing is scoped to the grader routes only (the webhook needs raw bytes).
  router.use('/__grader', requireToken, express.json({ limit: '1mb' }));

  router.post('/__grader/reset', async (_req, res) => {
    try {
      const stores = await getStores();
      // Application data only. Login sessions (a different Redis prefix) stay.
      await Promise.all(Object.values(stores).map((c) => c.deleteMany({})));
      await clearRateLimitState();
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error('reset failed', err);
      res.status(500).json({ error: 'reset failed' });
    }
  });

  router.post('/__grader/reply', async (req, res) => {
    const { workspace, contact, client_ref, text } = (req.body ?? {}) as Record<string, unknown>;
    if (!isKnownWorkspace(workspace)) {
      res.status(404).json({ error: 'unknown workspace' });
      return;
    }
    if (!str(contact, 64) || !str(client_ref, 200) || !str(text, 4000)) {
      res.status(400).json({ error: 'contact, client_ref and text are required' });
      return;
    }
    try {
      // Stored (or already stored) before we answer.
      await enqueueReply({ workspace, contact, client_ref, text });
      res.status(202).json({ ok: true, client_ref });
    } catch (err) {
      console.error('reply failed', err);
      res.status(500).json({ error: 'could not store reply' });
    }
  });

  router.post('/__grader/claim', claimHandler);

  router.get('/__grader/snapshot', async (_req, res) => {
    try {
      const { contacts, messages, outbound } = await getStores();
      const workspaces: Record<string, { contacts: Record<string, { inbound: string[]; assignee: string | null }>; outbound: Record<string, string> }> = {};
      for (const ws of Object.keys(config.pigeon.apiKeys)) workspaces[ws] = { contacts: {}, outbound: {} };

      for await (const c of contacts.find({})) {
        workspaces[c.workspace] ??= { contacts: {}, outbound: {} };
        workspaces[c.workspace].contacts[c.contact] = { inbound: [], assignee: c.assignee ?? null };
      }
      // Oldest first by the provider's occurred_at; message_id breaks exact ties.
      const cursor = messages.find({}, { projection: { workspace: 1, contact: 1, message_id: 1 } }).sort({ occurred_at: 1, message_id: 1 });
      for await (const m of cursor) {
        const entry = ((workspaces[m.workspace] ??= { contacts: {}, outbound: {} }).contacts[m.contact] ??= { inbound: [], assignee: null });
        entry.inbound.push(m.message_id);
      }
      for await (const o of outbound.find({}, { projection: { workspace: 1, client_ref: 1, status: 1 } })) {
        (workspaces[o.workspace] ??= { contacts: {}, outbound: {} }).outbound[o.client_ref] = o.status;
      }
      res.status(200).json({ workspaces });
    } catch (err) {
      console.error('snapshot failed', err);
      res.status(500).json({ error: 'snapshot failed' });
    }
  });

  return router;
}
