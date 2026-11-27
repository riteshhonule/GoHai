import { config } from '../config.js';
import { SESSION_TTL_SECONDS } from './session.js';

export const SESSION_COOKIE = 'sb_sid';

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function sessionCookie(id: string): string {
  const secure = config.webOrigin.startsWith('https:') ? '; Secure' : '';
  return `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}
