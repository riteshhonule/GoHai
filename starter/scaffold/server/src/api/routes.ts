import express from 'express';
import { isMember, requireSession } from '../auth/middleware.js';
import type { Session } from '../auth/session.js';
import { listConversations } from '../conversations/list.js';
import { conversationRoutes } from './conversationRoutes.js';

const intParam = (v: unknown, fallback: number, max: number): number => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : fallback;
};

export function apiRoutes(): express.Router {
  const router = express.Router();
  router.use('/api', requireSession, express.json({ limit: '64kb' }));

  router.get('/api/me', (_req, res) => {
    const s = res.locals.session as Session;
    res.json({ sub: s.sub, name: s.name, email: s.email, workspaces: s.workspaces });
  });

  router.get('/api/conversations', async (req, res) => {
    const s = res.locals.session as Session;
    const workspace = req.query.workspace;
    // Membership is checked before any data is touched. Unknown workspaces look the same as foreign ones.
    if (typeof workspace !== 'string' || !isMember(s, workspace)) {
      res.status(403).json({ error: 'not a member of this workspace' });
      return;
    }
    try {
      const conversations = await listConversations(workspace, intParam(req.query.limit, 50, 200) || 50, intParam(req.query.offset, 0, 100000));
      res.json({ workspace, conversations });
    } catch (err) {
      console.error('list conversations failed', err);
      res.status(500).json({ error: 'could not list conversations' });
    }
  });

  router.use(conversationRoutes());

  return router;
}
