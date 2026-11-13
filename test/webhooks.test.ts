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

// The session shared by the two examples in the public docs (docs-site/docs/webhooks.md, "Support
// session events"); the server's CI checks real deliveries against those same examples.
const docsSession = {
  id: 'ss_4f1c2a9b7d3e5f60', object: 'support_session', livemode: true, state: 'ended', mode: 'cobrowse',
  customer: { name: 'Ada Lovelace', plan: 'pro' }, customer_verified: true, external_id: 'ticket-4411',
  metadata: { region: 'eu' }, origin: 'https://app.example.com', owner: 'support@acme.example',
  created_at: 1791300000, expires_at: 1791303600, connected_at: 1791300012, joined_at: 1791300042,
  joined_by: 'agent@acme.example', ended_at: 1791300960, end_reason: 'stopped', duration_seconds: 960,
  client: { os: 'macos', os_version: '15.1', app_version: '4.2.0', sdk: 'tauri', sdk_version: '0.5.0' },
  admin_url: 'https://admin.acme.example/customers/4411',
  notes: 'Re-sent the invoice; customer confirmed.', outcome: 'resolved',
};
const endedBody = JSON.stringify({
  id: 'evt_9a8b7c6d5e4f30211a2b3c4d', type: 'support.session.ended', created: 1791300960, livemode: true,
  data: { support_session: { ...docsSession, csat: null, consent: {
    id: 'cr_01JCZ8Y3K9W2Q4V6T8R0M1N3P5', decision: 'accepted', at: '2026-11-12T16:04:05.123Z',
    surface: 'native_dialog', locale: 'en', wording_version: 'gaiadesk-0.4.0-en',
    wording_sha256: '9f2c4e1a7b3d5f60819a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f70',
    choices: { guided: true, share_logs: false, capture: 'window' },
    os_user: 'jane', os: 'macos', app_name: 'Horus', app_version: '2.4.1', sdk: 'libgaiadesk_embed/0.4.0',
  } } },
});
const ratedBody = JSON.stringify({
  id: 'evt_0f1e2d3c4b5a69788796a5b4', type: 'support.session.rated', created: 1791301020, livemode: true,
  data: { support_session: {
    ...docsSession, csat: { rating: 5, comment: 'Quick and kind.', rated_at: 1791301020 }, consent: null,
  } },
});

test('support.session.ended carries notes, outcome and a null csat; .rated carries the csat (docs examples)', () => {
  const ended = verify(secret, sign(secret, endedBody, 1791300960), endedBody, { now: 1791300960 });
  assert.equal(ended.type, 'support.session.ended');
  if (ended.type !== 'support.session.ended') return;
  const s = ended.data.support_session;
  assert.equal(s.id, 'ss_4f1c2a9b7d3e5f60');
  assert.equal(s.notes, 'Re-sent the invoice; customer confirmed.');
  assert.equal(s.outcome, 'resolved');
  assert.ok('csat' in s, '.ended must carry csat');
  assert.equal(s.csat, null);

  const rated = verify(secret, sign(secret, ratedBody, 1791301020), ratedBody, { now: 1791301020 });
  assert.equal(rated.type, 'support.session.rated');
  if (rated.type !== 'support.session.rated') return;
  const r = rated.data.support_session;
  assert.equal(r.id, s.id);
  assert.equal(r.notes, 'Re-sent the invoice; customer confirmed.');
  assert.equal(r.outcome, 'resolved');
  assert.deepEqual(r.csat, { rating: 5, comment: 'Quick and kind.', rated_at: 1791301020 });
});
