# GaiaDesk for Node.js

[![npm](https://img.shields.io/npm/v/@gaiadesk/node)](https://www.npmjs.com/package/@gaiadesk/node)
[![License: MIT](https://img.shields.io/github/license/Gaia-Desk/gaiadesk-node)](LICENSE)

The server SDK for [GaiaDesk in-app support](https://gaiadesk.net/docs/in-app-support): create
and follow support sessions, read the files customers send, set waiting alerts, ask a signed-in
customer's app to share, and verify webhook deliveries. Typed from GaiaDesk's
[OpenAPI document](https://api.gaiadesk.net/v1/openapi.json).

- Package: `@gaiadesk/node` (Node.js 18+, ESM, TypeScript declarations included)
- Runtime dependencies: none (the built-in `fetch` and `node:crypto`)
- For your **server** only. It refuses a publishable key (`pk_…`) and refuses to run in a
  browser: a secret key must never reach a page or an app.

To drive desks (exec, files, jobs), use [`@gaiadesk/sdk`](https://github.com/Gaia-Desk/gaiadesk-typescript).

## Install

```sh
npm install @gaiadesk/node
```

## Create a session

```ts
import { GaiaDesk } from '@gaiadesk/node';

const gd = new GaiaDesk({ apiKey: process.env.GAIADESK_API_KEY! }); // sk_live_… or sk_test_…, scope `support`

const session = await gd.support.sessions.create(
  { mode: 'cobrowse', customer: { name: 'Ada Lovelace', plan: 'pro' }, external_id: 'ticket-4411' },
  { idempotencyKey: 'ticket-4411-help' }, // a retry gets the same session back
);
// Hand only session.embed_token (gdemb_…) to your app's GaiaDesk SDK.
```

## Follow, annotate and end sessions

```ts
const waiting = await gd.support.sessions.list({ state: 'waiting' });
const s = await gd.support.sessions.get('ss_0123456789abcdef');
await gd.support.sessions.update(s.id, { notes: 'Re-sent the invoice.', outcome: 'resolved' });
await gd.support.sessions.end(s.id); // end_reason: ended_by_api

for (const a of await gd.support.sessions.attachments.list(s.id)) {
  const bytes = await gd.support.sessions.attachments.download(s.id, a.id); // Uint8Array
  console.log(a.filename, a.content_type, bytes.length);
}
```

## Waiting alerts

```ts
await gd.support.alerts.set({ wait_seconds: 45, slack_url: 'https://hooks.slack.com/services/…', emails: ['leads@acme.example'] });
console.log(await gd.support.alerts.get());
```

## Ask a customer's app to share

```ts
// At sign-in: a listen token for that user's app (shown once; up to 30 days).
const listener = await gd.support.listeners.create({ external_id: 'user-4411' });
// hand listener.listen_token to the app; the GaiaDesk SDKs listen with it

const request = await gd.support.requests.create({ external_id: 'user-4411', message: 'Can I look at your screen?' });
console.log((await gd.support.requests.get(request.id)).state);

await gd.support.listeners.revoke(listener.id); // at sign-out
```

Accepting or declining a request, the rating and file uploads are the customer's app's calls
(made with its listen or embed token by the client SDKs), not this package's.

## Webhooks

```ts
const hook = await gd.webhooks.create({ url: 'https://example.com/hooks/gaiadesk', events: ['support.session.ended'] });
// hook.secret is shown once: store it.
```

Verify every delivery over the **raw** body (before any JSON parsing):

```ts
import express from 'express';
import { GaiaDesk, WebhookVerificationError } from '@gaiadesk/node';

const app = express();
app.post('/hooks/gaiadesk', express.raw({ type: 'application/json' }), (req, res) => {
  let event;
  try {
    event = GaiaDesk.webhooks.verify(process.env.GAIADESK_WEBHOOK_SECRET!, req.header('gaiadesk-signature'), req.body);
  } catch (e) {
    if (e instanceof WebhookVerificationError) return res.status(400).send(e.reason);
    throw e;
  }
  // Delivery is at least once: skip an event.id you have already handled.
  if (event.type === 'support.session.ended') {
    const s = event.data.support_session;
    console.log(s.id, s.end_reason, s.duration_seconds, s.outcome, s.notes);
  }
  res.sendStatus(204); // any 2xx within 10 seconds; anything else is retried
});
```

`verify` checks the HMAC-SHA256 of `"<t>.<raw body>"` in constant time, refuses a `t` more than
five minutes from now (`toleranceSeconds` changes it), and returns the parsed event.

## Errors

Every failure is a `GaiaDeskError` with the API's `kind` (`usage`, `refused`, `unreachable`,
`connection_lost`, `failed`, `protocol`), its finer `reason` (`bad_body`, `no_such_session`,
`rate_limited`, …: branch on this), the HTTP `status`, the `requestId` to quote to support, and
`retryAfter` (seconds) on a 429 or 503.

```ts
import { GaiaDeskError } from '@gaiadesk/node';

try {
  await gd.support.sessions.get('ss_0000000000000000');
} catch (e) {
  if (e instanceof GaiaDeskError && e.reason === 'no_such_session') { /* … */ }
}
```

## Options

```ts
new GaiaDesk({
  apiKey: '…',
  baseUrl: 'http://127.0.0.1:9000/v1', // a local signal server (default https://api.gaiadesk.net/v1)
  timeoutMs: 30_000,                   // per request
  fetch: myFetch,                      // default the global fetch
});
```

## Regenerating the types

`src/types.generated.ts` comes from the OpenAPI document:

```sh
npm run gen                                  # from https://api.gaiadesk.net/v1/openapi.json
npm run gen -- path/to/openapi.json          # or a local copy
```

## License

MIT. GaiaDesk itself is proprietary and not covered by this license.
