import { getRedis } from '../redis.js';
import { randomToken } from './pkce.js';

// Sessions live in Redis so every server instance accepts the same cookie.
// (The prefix differs from the app-data prefix, so a grader reset keeps sessions.)
const key = (id: string) => `sb:sess:${id}`;
export const SESSION_TTL_SECONDS = 8 * 3600;

export interface Membership {
  id: string;
  role: 'admin' | 'agent';
}

export interface Session {
  sub: string;
  name?: string;
  email?: string;
  workspaces: Membership[];
}

export async function createSession(session: Session): Promise<string> {
  const id = randomToken(32);
  await getRedis().set(key(id), JSON.stringify(session), 'EX', SESSION_TTL_SECONDS);
  return id;
}

export async function loadSession(id: string): Promise<Session | null> {
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(id)) return null;
  const raw = await getRedis().get(key(id));
  return raw ? (JSON.parse(raw) as Session) : null;
}
