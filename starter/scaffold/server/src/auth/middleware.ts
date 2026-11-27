import type { IncomingMessage } from 'node:http';
import type { NextFunction, Request, Response } from 'express';
import { parseCookies, SESSION_COOKIE } from './cookies.js';
import { loadSession, type Session } from './session.js';

// Used by Express routes and by the WebSocket upgrade, so both authenticate alike.
export async function sessionFromRequest(req: IncomingMessage): Promise<Session | null> {
  const id = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  return id ? loadSession(id) : null;
}

export const isMember = (session: Session, workspace: string): boolean => session.workspaces.some((w) => w.id === workspace);

export async function requireSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const session = await sessionFromRequest(req);
    if (!session) {
      res.status(401).json({ error: 'not signed in' });
      return;
    }
    res.locals.session = session;
    next();
  } catch (err) {
    console.error('session lookup failed', err);
    res.status(503).json({ error: 'session store unavailable' });
  }
}
