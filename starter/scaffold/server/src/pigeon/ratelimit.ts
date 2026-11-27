import { getRedis } from '../redis.js';

// All Redis keys for this feature live under this prefix, so a reset can
// clear them without touching login sessions.
export const REDIS_PREFIX = 'sb:pigeon:';

const cooloffKey = (ws: string) => `${REDIS_PREFIX}cooloff:${ws}`;
const bucketKey = (ws: string) => `${REDIS_PREFIX}bucket:${ws}`;

// Pigeon's real limit is a bucket of 8 refilling at 4/s. Stay a little under
// it so we rarely get a 429 at all (requests sent too early are penalised). A
// small burst matters: concurrent in-flight sends cannot see a 429 that is
// still on its way back, and would each land inside the Retry-After window.
const CAPACITY = 3;
const REFILL_PER_SEC = 3.5;

// Shared token bucket across every server process. Returns ms to wait before
// sending (0 = go now). The slot is reserved either way. Uses Redis TIME so processes do not need synced clocks.
const BUCKET_LUA = `
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
local cap = tonumber(ARGV[1])
local rate = tonumber(ARGV[2]) / 1000
local h = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(h[1])
local ts = tonumber(h[2])
if tokens == nil then tokens = cap; ts = now end
tokens = math.min(cap, tokens + math.max(0, now - ts) * rate)
-- Always reserve a slot, even when none is free yet: tokens may go negative,
-- so each caller is told to wait for its own slot instead of everyone being
-- told the same wait and firing together.
local wait = 0
if tokens < 1 then wait = math.ceil((1 - tokens) / rate) end
tokens = tokens - 1
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', now)
redis.call('PEXPIRE', KEYS[1], 30000)
return wait
`;

// Extend the workspace cool-off to at least `ms` from now. Never shortens it.
const COOLOFF_LUA = `
local cur = redis.call('PTTL', KEYS[1])
local want = tonumber(ARGV[1])
if cur < want then redis.call('SET', KEYS[1], '1', 'PX', want) end
return 1
`;

export async function cooloffRemainingMs(ws: string): Promise<number> {
  const ttl = await getRedis().pttl(cooloffKey(ws));
  return ttl > 0 ? ttl : 0;
}

export async function workspacesCoolingOff(workspaces: string[]): Promise<string[]> {
  const ttls = await Promise.all(workspaces.map((w) => cooloffRemainingMs(w)));
  return workspaces.filter((_, i) => ttls[i] > 0);
}

export async function setCooloff(ws: string, ms: number): Promise<void> {
  await getRedis().eval(COOLOFF_LUA, 1, cooloffKey(ws), String(Math.ceil(ms)));
}

export async function takeToken(ws: string): Promise<number> {
  const wait = await getRedis().eval(BUCKET_LUA, 1, bucketKey(ws), String(CAPACITY), String(REFILL_PER_SEC));
  return Number(wait);
}

// Delete every key under the prefix (used by the grader reset).
export async function clearRateLimitState(): Promise<void> {
  const redis = getRedis();
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${REDIS_PREFIX}*`, 'COUNT', 200);
    cursor = next;
    if (keys.length) await redis.del(...keys);
  } while (cursor !== '0');
}
