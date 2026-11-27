import express from 'express';
import { config } from '../config.js';
import { sessionCookie } from './cookies.js';
import { consumeLogin, saveLogin } from './loginState.js';
import { buildAuthorizeUrl, exchangeCode } from './oidc.js';
import { challengeFor, randomToken } from './pkce.js';
import { createSession } from './session.js';

export function authRoutes(): express.Router {
  const router = express.Router();

  router.get('/auth/login', async (_req, res) => {
    try {
      const state = randomToken(16);
      const nonce = randomToken(16);
      const verifier = randomToken(48);
      await saveLogin(state, { verifier, nonce });
      res.redirect(302, await buildAuthorizeUrl({ state, nonce, challenge: challengeFor(verifier) }));
    } catch (err) {
      console.error('login start failed', err);
      res.status(502).json({ error: 'identity provider unavailable' });
    }
  });

  router.get('/auth/callback', async (req, res) => {
    const { code, state } = req.query;
    if (typeof code !== 'string' || typeof state !== 'string') {
      res.status(400).json({ error: 'missing code or state' });
      return;
    }
    try {
      const pending = await consumeLogin(state);
      if (!pending) {
        res.status(400).json({ error: 'unknown or expired login' });
        return;
      }
      const identity = await exchangeCode(code, pending.verifier, pending.nonce);
      const sid = await createSession(identity);
      res.setHeader('set-cookie', sessionCookie(sid));
      res.redirect(302, config.webOrigin);
    } catch (err) {
      console.error('login failed', err instanceof Error ? err.message : err);
      res.status(401).json({ error: 'login failed' });
    }
  });

  return router;
}
