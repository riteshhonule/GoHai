import assert from 'node:assert/strict';
import { test } from 'node:test';
import { challengeFor, randomToken } from './pkce.js';

test('S256 challenge matches the RFC 7636 example', () => {
  assert.equal(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('random tokens are url-safe and unique', () => {
  const a = randomToken(32);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(a, randomToken(32));
});
