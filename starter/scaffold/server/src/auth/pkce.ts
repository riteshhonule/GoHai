import { createHash, randomBytes } from 'node:crypto';

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

// PKCE S256: challenge = base64url(sha256(verifier)).
export const challengeFor = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url');
