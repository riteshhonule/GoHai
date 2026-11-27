import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { verifyPigeonSignature } from './signature.js';

const secret = 'whsec_test';
const body = Buffer.from('{"id":"evt_1","type":"message.inbound"}');
const now = 1_800_000_000_000;
const sign = (t: number, b: Buffer = body, s = secret) => `t=${t},v1=${createHmac('sha256', s).update(`${t}.`).update(b).digest('hex')}`;
const check = (header: string | undefined, b: Buffer = body) => verifyPigeonSignature(header, b, now, secret).ok;

test('accepts a genuine, recent signature', () => {
  assert.equal(check(sign(now / 1000 - 5)), true);
});

test('accepts a timestamp slightly in the future', () => {
  assert.equal(check(sign(now / 1000 + 30)), true);
});

test('rejects a genuine signature older than 300 seconds', () => {
  assert.equal(check(sign(now / 1000 - 301)), false);
  assert.equal(check(sign(now / 1000 - 299)), true);
});

test('rejects a body that changed after signing', () => {
  assert.equal(check(sign(now / 1000), Buffer.from('{"id":"evt_1","type":"message.inbound","x":1}')), false);
});

test('rejects a wrong secret, missing and malformed headers without throwing', () => {
  assert.equal(check(sign(now / 1000, body, 'other')), false);
  for (const bad of [undefined, '', 't=abc,v1=00', 'v1=00', `t=${now / 1000}`, `t=${now / 1000},v1=zz`, `t=${now / 1000},v1=${'a'.repeat(10)}`]) {
    assert.equal(check(bad), false);
  }
});
