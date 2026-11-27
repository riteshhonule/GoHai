import { randomUUID } from 'node:crypto';
import express, { type Request, type Response } from 'express';
import { isMember } from '../auth/middleware.js';
import type { Session } from '../auth/session.js';
import { claim } from '../conversations/claim.js';
import { setClosed } from '../conversations/state.js';
import { getThread } from '../conversations/thread.js';
import { enqueueReply } from '../pigeon/send.js';

const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

// Every route needs workspace + contact, and the caller must be a member.
// Returns null after sending the error response.
function target(req: Request, res: Response): { workspace: string; contact: string; session: Session } | null {
  const session = res.locals.session as Session;
  const src = (req.method === 'GET' ? req.query : req.body ?? {}) as Record<string, unknown>;
  const { workspace, contact } = src;
  if (typeof workspace !== 'string' || !isMember(session, workspace)) {
    res.status(403).json({ error: 'not a member of this workspace' });
    return null;
  }
  if (!str(contact, 64)) {
    res.status(400).json({ error: 'contact is required' });
    return null;
  }
  return { workspace, contact, session };
}

const fail = (res: Response, err: unknown) => {
  console.error('api error', err);
  res.status(500).json({ error: 'internal error' });
};

// Mounted after requireSession and a JSON body parser (see api/routes.ts).
export function conversationRoutes(): express.Router {
  const router = express.Router();

  router.get('/api/messages', async (req, res) => {
    const t = target(req, res);
    if (!t) return;
    try {
      res.json({ messages: await getThread(t.workspace, t.contact) });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post('/api/reply', async (req, res) => {
    const t = target(req, res);
    if (!t) return;
    const { text, client_ref } = req.body as Record<string, unknown>;
    if (!str(text, 4000)) {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    const ref = client_ref === undefined ? randomUUID() : client_ref;
    if (!str(ref, 200)) {
      res.status(400).json({ error: 'invalid client_ref' });
      return;
    }
    try {
      await enqueueReply({ workspace: t.workspace, contact: t.contact, client_ref: ref, text });
      res.status(202).json({ client_ref: ref });
    } catch (err) {
      fail(res, err);
    }
  });

  // The agent is the signed-in user, never a value from the request.
  router.post('/api/claim', async (req, res) => {
    const t = target(req, res);
    if (!t) return;
    try {
      const result = await claim(t.workspace, t.contact, t.session.sub);
      if (result.ok) res.json({ assignee: t.session.sub });
      else res.status(409).json({ error: 'already claimed by another agent' });
    } catch (err) {
      fail(res, err);
    }
  });

  for (const [path, closed] of [['/api/close', true], ['/api/reopen', false]] as const) {
    router.post(path, async (req, res) => {
      const t = target(req, res);
      if (!t) return;
      try {
        if (await setClosed(t.workspace, t.contact, closed)) res.json({ state: closed ? 'closed' : 'open' });
        else res.status(404).json({ error: 'no such conversation' });
      } catch (err) {
        fail(res, err);
      }
    });
  }

  return router;
}
