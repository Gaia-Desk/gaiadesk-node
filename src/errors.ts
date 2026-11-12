import type { ErrorKind } from './types.generated.js';

/**
 * A call that did not succeed. `kind` is one of the API's six kinds
 * (`usage`, `refused`, `unreachable`, `connection_lost`, `failed`,
 * `protocol`); `reason` is the finer cause the API gives (`bad_body`,
 * `no_such_session`, `rate_limited`, …), which is what to branch on.
 */
export class GaiaDeskError extends Error {
  readonly kind: ErrorKind;
  readonly reason: string | null;
  /** The HTTP status, or 0 when no answer arrived. */
  readonly status: number;
  /** `req_…`: quote it to GaiaDesk support. */
  readonly requestId: string | null;
  /** Seconds to wait before trying again (429, 503), when the API said. */
  readonly retryAfter: number | null;

  constructor(
    message: string,
    o: { kind: ErrorKind; reason?: string | null; status?: number; requestId?: string | null; retryAfter?: number | null },
  ) {
    super(message);
    this.name = 'GaiaDeskError';
    this.kind = o.kind;
    this.reason = o.reason ?? null;
    this.status = o.status ?? 0;
    this.requestId = o.requestId ?? null;
    this.retryAfter = o.retryAfter ?? null;
  }
}

/** A webhook delivery that failed verification (`reason` says why). */
export class WebhookVerificationError extends Error {
  readonly reason: 'bad_header' | 'stale' | 'bad_signature' | 'bad_body';
  constructor(reason: WebhookVerificationError['reason'], message: string) {
    super(message);
    this.name = 'WebhookVerificationError';
    this.reason = reason;
  }
}
