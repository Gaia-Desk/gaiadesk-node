// A webhook receiver with nothing but node:http. Run it behind HTTPS.
import { createServer } from 'node:http';

import { GaiaDesk, WebhookVerificationError } from '@gaiadesk/node';

const secret = process.env.GAIADESK_WEBHOOK_SECRET ?? '';
const seen = new Set<string>(); // use your database in production

createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    let event;
    try {
      event = GaiaDesk.webhooks.verify(secret, req.headers['gaiadesk-signature'] as string | undefined, Buffer.concat(chunks));
    } catch (e) {
      res.writeHead(400).end(e instanceof WebhookVerificationError ? e.reason : 'bad request');
      return;
    }
    if (!seen.has(event.id)) {
      seen.add(event.id);
      if (event.type === 'support.session.ended') {
        const s = event.data.support_session;
        console.log(s.id, s.end_reason, s.duration_seconds, s.outcome, s.notes, s.csat?.rating);
      }
    }
    res.writeHead(204).end();
  });
}).listen(8080);
