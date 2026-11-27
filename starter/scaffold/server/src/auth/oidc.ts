import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';
import { config } from '../config.js';
import type { Membership } from './session.js';

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}
type Jwk = JsonWebKey & { kid?: string };

let discovery: Promise<Discovery> | undefined;
function getDiscovery(): Promise<Discovery> {
  discovery ??= fetch(`${config.oidc.issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000) })
    .then((r) => {
      if (!r.ok) throw new Error(`discovery ${r.status}`);
      return r.json() as Promise<Discovery>;
    })
    .catch((err) => {
      discovery = undefined; // retry next time
      throw err;
    });
  return discovery;
}

export async function buildAuthorizeUrl(p: { state: string; nonce: string; challenge: string }): Promise<string> {
  const d = await getDiscovery();
  const u = new URL(d.authorization_endpoint);
  u.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.oidc.clientId,
    redirect_uri: config.oidc.redirectUri,
    scope: 'openid profile email',
    state: p.state,
    nonce: p.nonce,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
  }).toString();
  return u.toString();
}

export interface Identity {
  sub: string;
  name?: string;
  email?: string;
  workspaces: Membership[];
}

export async function exchangeCode(code: string, verifier: string, nonce: string): Promise<Identity> {
  const d = await getDiscovery();
  const res = await fetch(d.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.oidc.redirectUri,
      client_id: config.oidc.clientId,
      client_secret: config.oidc.clientSecret,
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`token endpoint ${res.status}`);
  const body = (await res.json()) as { id_token?: string };
  if (!body.id_token) throw new Error('no id_token');
  return verifyIdToken(body.id_token, d, nonce);
}

async function fetchKeys(d: Discovery): Promise<Jwk[]> {
  const r = await fetch(d.jwks_uri, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`jwks ${r.status}`);
  return ((await r.json()) as { keys: Jwk[] }).keys;
}

async function verifyIdToken(token: string, d: Discovery, nonce: string): Promise<Identity> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed id_token');
  const [h, p, s] = parts;
  const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8')) as { alg?: string; kid?: string };
  if (header.alg !== 'RS256') throw new Error('unexpected alg');
  const jwk = (await fetchKeys(d)).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown signing key');
  const ok = verify('RSA-SHA256', Buffer.from(`${h}.${p}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s, 'base64url'));
  if (!ok) throw new Error('bad id_token signature');

  const c = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as Record<string, unknown>;
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (c.iss !== d.issuer || !aud.includes(config.oidc.clientId)) throw new Error('wrong issuer or audience');
  if (typeof c.exp !== 'number' || c.exp * 1000 < Date.now()) throw new Error('id_token expired');
  if (c.nonce !== nonce) throw new Error('nonce mismatch');
  if (typeof c.sub !== 'string') throw new Error('no sub');

  const workspaces = (Array.isArray(c.workspaces) ? c.workspaces : [])
    .filter((w): w is Membership => !!w && typeof w.id === 'string' && (w.role === 'admin' || w.role === 'agent'))
    .map((w) => ({ id: w.id, role: w.role }));
  return { sub: c.sub, name: typeof c.name === 'string' ? c.name : undefined, email: typeof c.email === 'string' ? c.email : undefined, workspaces };
}
