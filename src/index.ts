import { Http, seg, type ClientOptions, type RequestOptions } from './client.js';
import type * as T from './types.generated.js';
import { sign, verify } from './webhooks.js';

export { GaiaDeskError, WebhookVerificationError } from './errors.js';
export { sign, verify, type DeskReachEvent, type VerifyOptions, type WebhookEvent } from './webhooks.js';
export type { ClientOptions, RequestOptions } from './client.js';
export type * from './types.generated.js';

/**
 * GaiaDesk's support API from your server.
 *
 * ```ts
 * const gd = new GaiaDesk({ apiKey: process.env.GAIADESK_API_KEY! });
 * const s = await gd.support.sessions.create({ mode: 'cobrowse', customer: { name: 'Ada' } });
 * // hand s.embed_token to your app
 * ```
 */
export class GaiaDesk {
  readonly support;
  readonly webhooks;

  constructor(options: ClientOptions) {
    const h = new Http(options);
    this.support = {
      sessions: {
        create: (body: T.ApiSupportSessionCreate, opts?: RequestOptions) =>
          h.call<T.ApiSupportSessionCreated>('POST', '/support/sessions', { body, opts }),
        list: async (query: T.ListSupportSessionsQuery = {}) =>
          (await h.call<T.ApiSupportSessionList>('GET', '/support/sessions', { query })).sessions,
        get: (id: string) => h.call<T.ApiSupportSession>('GET', `/support/sessions/${seg(id)}`),
        /** The agents' private `notes` and `outcome` (`null` clears either). */
        update: (id: string, body: T.ApiSupportSessionUpdate) =>
          h.call<T.ApiSupportSession>('PATCH', `/support/sessions/${seg(id)}`, { body }),
        /** Stops sharing now (`end_reason: ended_by_api`); ending one already over changes nothing. */
        end: (id: string, opts?: RequestOptions) => h.call<T.ApiSupportSession>('POST', `/support/sessions/${seg(id)}/end`, { opts }),
        attachments: {
          list: async (sessionId: string) =>
            (await h.call<{ attachments: T.ApiSupportAttachment[] }>('GET', `/support/sessions/${seg(sessionId)}/attachments`)).attachments,
          /** The file's bytes. */
          download: (sessionId: string, attachmentId: string) =>
            h.call<Uint8Array>('GET', `/support/sessions/${seg(sessionId)}/attachments/${seg(attachmentId)}`, { raw: true }),
        },
      },
      alerts: {
        get: () => h.call<T.ApiSupportAlerts>('GET', '/support/alerts'),
        /** Team owners and admins only. Fields left out are unchanged. */
        set: (body: T.ApiSupportAlertsUpdate) => h.call<T.ApiSupportAlerts>('PUT', '/support/alerts', { body }),
      },
      listeners: {
        /** A listen token (`gdlis_…`) for one signed-in user's app. Shown once. */
        create: (body: T.ApiSupportListenerCreate, opts?: RequestOptions) =>
          h.call<T.ApiSupportListenerCreated>('POST', '/support/listeners', { body, opts }),
        revoke: (id: string) => h.call<T.ApiSupportListener>('DELETE', `/support/listeners/${seg(id)}`),
      },
      requests: {
        /** Ask a listening user's app to start a session (pending 10 minutes). */
        create: (body: T.ApiSupportRequestCreate, opts?: RequestOptions) =>
          h.call<T.ApiSupportRequest>('POST', '/support/requests', { body, opts }),
        get: (id: string) => h.call<T.ApiSupportRequest>('GET', `/support/requests/${seg(id)}`),
      },
    };
    this.webhooks = {
      create: (body: T.ApiWebhookCreate, opts?: RequestOptions) => h.call<T.ApiWebhookCreated>('POST', '/webhooks', { body, opts }),
      list: async () => (await h.call<T.ApiWebhookList>('GET', '/webhooks')).webhooks,
      delete: (id: string) => h.call<T.ApiWebhookDeleted>('DELETE', `/webhooks/${seg(id)}`),
      verify,
      sign,
    };
  }

  /** The same as `gd.webhooks.verify`, without a client (no key needed). */
  static readonly webhooks = { verify, sign };
}

export default GaiaDesk;
