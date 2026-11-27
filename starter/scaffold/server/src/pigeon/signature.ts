import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

export const MAX_AGE_SECONDS = 300;

export type SignatureResult = { ok: true } | { ok: false; reason: string };

// Header format: "t=<unix seconds>,v1=<hex>". Signed payload: "<t>.<raw body>".
export function verifyPigeonSignature(
  header: string | undefined,
  rawBody: Buffer,
  nowMs: number = Date.now(),
  secret: string = config.pigeon.webhookSecret,
): SignatureResult {
  if (!header) return { ok: false, reason: 'missing signature' };

  let t: string | undefined;
  const candidates: string[] = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') t = v;
    else if (k === 'v1') candidates.push(v);
  }
  if (!t || !/^\d{1,15}$/.test(t) || candidates.length === 0) return { ok: false, reason: 'malformed signature' };

  const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();

  let match = false;
  for (const c of candidates) {
    if (!/^[0-9a-fA-F]{64}$/.test(c)) continue;
    const got = Buffer.from(c, 'hex');
    // Same length is guaranteed (32 bytes), so timingSafeEqual cannot throw.
    if (got.length === expected.length && timingSafeEqual(got, expected)) match = true;
  }
  if (!match) return { ok: false, reason: 'signature mismatch' };

  // Only old timestamps are rejected; a timestamp slightly in the future is fine.
  const ageSeconds = nowMs / 1000 - Number(t);
  if (ageSeconds > MAX_AGE_SECONDS) return { ok: false, reason: 'timestamp too old' };

  return { ok: true };
}
