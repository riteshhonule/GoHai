import { getRedis } from '../redis.js';

// In-flight logins (state -> PKCE verifier + nonce) live in Redis, not in
// process memory, so the callback can land on any server instance.
const key = (state: string) => `sb:auth:login:${state}`;
const TTL_SECONDS = 600;

export interface PendingLogin {
  verifier: string;
  nonce: string;
}

export async function saveLogin(state: string, login: PendingLogin): Promise<void> {
  await getRedis().set(key(state), JSON.stringify(login), 'EX', TTL_SECONDS);
}

// Single use: GETDEL so a replayed callback cannot reuse the state.
export async function consumeLogin(state: string): Promise<PendingLogin | null> {
  const raw = await getRedis().getdel(key(state));
  return raw ? (JSON.parse(raw) as PendingLogin) : null;
}
