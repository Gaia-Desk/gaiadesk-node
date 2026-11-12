import { createHmac, timingSafeEqual } from 'node:crypto';

import { WebhookVerificationError } from './errors.js';
import type {
  ApiDeskHealthEvent,
  ApiJobFinishedEvent,
  ApiSupportRequestEvent,
  ApiSupportSessionEvent,
  ApiWebhookEvent,
  ApiWebhookTestEvent,
} from './types.generated.js';

/** `desk.online`, `desk.offline`, `desk.woke` (the spec's `ApiWebhookEvent`, its `type` narrowed). */
export type DeskReachEvent = Omit<ApiWebhookEvent, 'type'> & { type: 'desk.online' | 'desk.offline' | 'desk.woke' };

/** Every event GaiaDesk delivers to a webhook. Branch on `type`. */
export type WebhookEvent =
  | ApiSupportSessionEvent
  | ApiSupportRequestEvent
  | DeskReachEvent
  | ApiJobFinishedEvent
  | ApiDeskHealthEvent
  | ApiWebhookTestEvent;

export interface VerifyOptions {
  /** Seconds `t` may be from now (default 300, five minutes). */
  toleranceSeconds?: number;
  /** Now, in Unix seconds (tests). */
  now?: number;
}

/**
 * Check one delivery and return its event. `signatureHeader` is the
 * `GaiaDesk-Signature` header (`t=<unix seconds>,v1=<hex HMAC-SHA256>`),
 * `rawBody` the request body exactly as received (not re-serialised JSON).
 * Throws {@link WebhookVerificationError} unless the HMAC-SHA256 of
 * `"<t>.<raw body>"` keyed with `secret` matches (constant time) and `t` is
 * within the tolerance. Delivery is at least once: de-duplicate by the
 * event's `id` (also the `GaiaDesk-Event-Id` header).
 */
export function verify(
  secret: string,
  signatureHeader: string | null | undefined,
  rawBody: string | Uint8Array,
  opts: VerifyOptions = {},
): WebhookEvent {
  const parts = new Map<string, string>();
  for (const p of String(signatureHeader ?? '').split(',')) {
    const i = p.indexOf('=');
    if (i > 0) parts.set(p.slice(0, i).trim(), p.slice(i + 1).trim());
  }
  const t = Number(parts.get('t'));
  const v1 = parts.get('v1') ?? '';
  if (!Number.isSafeInteger(t) || !/^[0-9a-f]{64}$/i.test(v1)) {
    throw new WebhookVerificationError('bad_header', 'The GaiaDesk-Signature header is missing or malformed.');
  }
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > (opts.toleranceSeconds ?? 300)) {
    throw new WebhookVerificationError('stale', 'The delivery is older (or newer) than the tolerance allows.');
  }
  const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : Buffer.from(rawBody);
  const want = createHmac('sha256', secret).update(`${t}.`).update(body).digest();
  if (!timingSafeEqual(want, Buffer.from(v1, 'hex'))) {
    throw new WebhookVerificationError('bad_signature', 'The signature does not match: wrong secret, or the body was changed.');
  }
  try {
    return JSON.parse(body.toString('utf8')) as WebhookEvent;
  } catch {
    throw new WebhookVerificationError('bad_body', 'The body is not JSON.');
  }
}

/** A `GaiaDesk-Signature` value for `rawBody` (tests of your own receiver). */
export function sign(secret: string, rawBody: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')}`;
}
