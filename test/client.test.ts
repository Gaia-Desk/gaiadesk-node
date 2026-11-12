import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { GaiaDesk, GaiaDeskError } from '../dist/index.js';

interface Seen {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** A fetch that records each call and answers `reply`. */
function mock(reply: (s: Seen) => Response): { fetch: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const f = (async (url: URL, init: RequestInit) => {
    const s = { method: String(init.method), url: String(url), headers: init.headers as Record<string, string>, body: init.body as string | undefined };
    seen.push(s);
    return reply(s);
  }) as unknown as typeof fetch;
  return { fetch: f, seen };
}

const json = (status: number, v: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json', ...headers } });

test('refuses a publishable key, a missing key, and a browser', () => {
  assert.throws(() => new GaiaDesk({ apiKey: 'pk_live_abc' }), /publishable key/);
  assert.throws(() => new GaiaDesk({ apiKey: '' }), /secret API key/);
  const g = globalThis as { window?: unknown };
  g.window = { document: {} };
  try {
    assert.throws(() => new GaiaDesk({ apiKey: 'sk_test_x' }), /for your server/);
  } finally {
    delete g.window;
  }
});

test('creates a session with the key, the body and an Idempotency-Key', async () => {
  const m = mock(() => json(201, { id: 'ss_0123456789abcdef', embed_token: 'gdemb_x' }));
  const gd = new GaiaDesk({ apiKey: 'sk_test_k', fetch: m.fetch, baseUrl: 'http://x/v1/' });
  const s = await gd.support.sessions.create({ mode: 'cobrowse', customer: { name: 'Ada' } }, { idempotencyKey: 'ticket-1' });
  assert.equal(s.embed_token, 'gdemb_x');
  const [c] = m.seen;
  assert.equal(c.method, 'POST');
  assert.equal(c.url, 'http://x/v1/support/sessions');
  assert.equal(c.headers.authorization, 'Bearer sk_test_k');
  assert.equal(c.headers['idempotency-key'], 'ticket-1');
  assert.equal(c.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(c.body!), { mode: 'cobrowse', customer: { name: 'Ada' } });
});

test('every operation hits its path', async () => {
  const m = mock((s) => {
    if (s.url.includes('/attachments/sa_')) return new Response(new Uint8Array([1, 2, 3]));
    if (s.url.endsWith('/attachments')) return json(200, { attachments: [{ id: 'sa_1' }] });
    if (s.url.includes('/support/sessions?') || s.url.endsWith('/support/sessions')) return json(200, { sessions: [{ id: 'ss_1' }] });
    if (s.url.endsWith('/webhooks') && s.method === 'GET') return json(200, { webhooks: [] });
    return json(200, { ok: true });
  });
  const gd = new GaiaDesk({ apiKey: 'sk_live_k', fetch: m.fetch });
  assert.deepEqual(await gd.support.sessions.list({ state: 'ended', external_id: 'ticket 4', limit: 5 }), [{ id: 'ss_1' }]);
  await gd.support.sessions.get('ss_1');
  await gd.support.sessions.update('ss_1', { notes: 'n', outcome: 'resolved' });
  await gd.support.sessions.end('ss_1');
  assert.deepEqual(await gd.support.sessions.attachments.list('ss_1'), [{ id: 'sa_1' }]);
  assert.deepEqual([...(await gd.support.sessions.attachments.download('ss_1', 'sa_2'))], [1, 2, 3]);
  await gd.support.alerts.get();
  await gd.support.alerts.set({ wait_seconds: 45 });
  await gd.support.listeners.create({ external_id: 'user-1' });
  await gd.support.listeners.revoke('sl_1');
  await gd.support.requests.create({ external_id: 'user-1', message: 'hi' });
  await gd.support.requests.get('sr_1');
  await gd.webhooks.list();
  await gd.webhooks.create({ url: 'https://e.example/h', events: ['support.session.ended'] });
  await gd.webhooks.delete('wh_1');
  const base = 'https://api.gaiadesk.net/v1';
  assert.deepEqual(
    m.seen.map((s) => `${s.method} ${s.url.replace(base, '')}`),
    [
      'GET /support/sessions?state=ended&external_id=ticket+4&limit=5',
      'GET /support/sessions/ss_1',
      'PATCH /support/sessions/ss_1',
      'POST /support/sessions/ss_1/end',
      'GET /support/sessions/ss_1/attachments',
      'GET /support/sessions/ss_1/attachments/sa_2',
      'GET /support/alerts',
      'PUT /support/alerts',
      'POST /support/listeners',
      'DELETE /support/listeners/sl_1',
      'POST /support/requests',
      'GET /support/requests/sr_1',
      'GET /webhooks',
      'POST /webhooks',
      'DELETE /webhooks/wh_1',
    ],
  );
});

test('a failure is a GaiaDeskError carrying kind, reason, status and request id', async () => {
  const m = mock(() =>
    json(429, { error: { kind: 'refused', reason: 'rate_limited', message: 'Slow down.', request_id: 'req_1' } }, { 'retry-after': '7' }),
  );
  const gd = new GaiaDesk({ apiKey: 'sk_live_k', fetch: m.fetch });
  await assert.rejects(gd.support.sessions.get('ss_1'), (e: unknown) => {
    assert.ok(e instanceof GaiaDeskError);
    assert.deepEqual([e.kind, e.reason, e.status, e.requestId, e.retryAfter, e.message], ['refused', 'rate_limited', 429, 'req_1', 7, 'Slow down.']);
    return true;
  });
});

test('a non-envelope failure and a network failure are typed too', async () => {
  const gd = new GaiaDesk({ apiKey: 'sk_live_k', fetch: mock(() => new Response('<html>bad gateway', { status: 502 })).fetch });
  await assert.rejects(gd.support.alerts.get(), (e: GaiaDeskError) => e.kind === 'protocol' && e.status === 502 && e.reason === null);
  const down = (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
  const gd2 = new GaiaDesk({ apiKey: 'sk_live_k', fetch: down });
  await assert.rejects(gd2.support.alerts.get(), (e: GaiaDeskError) => e.kind === 'unreachable' && e.reason === 'network' && e.status === 0);
});
