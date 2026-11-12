import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { GaiaDesk, WebhookVerificationError } from '../dist/index.js';

const { verify, sign } = GaiaDesk.webhooks;
const secret = 'whsec_test';
const body = '{"id":"evt_3d4e5f60718293a4b5c6d7e8","type":"support.session.ended","created":1791300000,"livemode":true,"data":{}}';

test('a delivery signed by the server verifies and parses', () => {
  // The server's own vector (signal/src/api_v1/webhooks/deliver.rs `sign`): HMAC-SHA256("1791300000.<body>").
  const header = sign(secret, body, 1791300000);
  // A fixed vector, shared with the server's tests (computed with `openssl dgst -sha256 -hmac`).
  assert.equal(sign(secret, '{"a":1}', 1791300000), 't=1791300000,v1=5932a440433e064a555c1fb4432732b7b6bafb7a9fe2c00d134944288c70fef3');
  const ev = verify(secret, header, body, { now: 1791300100 });
  assert.equal(ev.id, 'evt_3d4e5f60718293a4b5c6d7e8');
  assert.equal(verify(secret, header, new TextEncoder().encode(body), { now: 1791300000 }).type, 'support.session.ended');
});

test('refuses a changed body, a wrong secret, a stale t and a bad header', () => {
  const header = sign(secret, body, 1791300000);
  const reason = (f: () => unknown) => {
    try {
      f();
    } catch (e) {
      assert.ok(e instanceof WebhookVerificationError);
      return e.reason;
    }
    return 'accepted';
  };
  assert.equal(reason(() => verify(secret, header, body + ' ', { now: 1791300000 })), 'bad_signature');
  assert.equal(reason(() => verify('other', header, body, { now: 1791300000 })), 'bad_signature');
  assert.equal(reason(() => verify(secret, header, body, { now: 1791300301 })), 'stale');
  assert.equal(reason(() => verify(secret, header, body, { now: 1791299699 })), 'stale');
  assert.equal(reason(() => verify(secret, 'v1=abc', body)), 'bad_header');
  assert.equal(reason(() => verify(secret, undefined, body)), 'bad_header');
  assert.equal(reason(() => verify(secret, header.replace(/v1=../, 'v1=zz'), body, { now: 1791300000 })), 'bad_header');
});
