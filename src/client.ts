import { GaiaDeskError } from './errors.js';
import type { ErrorKind } from './types.generated.js';

export interface ClientOptions {
  /** A SECRET key: `sk_live_…`, `sk_test_…` (or an older `ak_…`). */
  apiKey: string;
  /** Default `https://api.gaiadesk.net/v1`. */
  baseUrl?: string;
  /** Default the global `fetch` (Node 18+). */
  fetch?: typeof fetch;
  /** Per request, milliseconds (default 30000). */
  timeoutMs?: number;
}

/** Options every create (POST) takes. */
export interface RequestOptions {
  /**
   * Up to 255 printable ASCII characters. A retry with the same key and the
   * same request within 24 hours gets the first answer again.
   */
  idempotencyKey?: string;
}

const KINDS: ErrorKind[] = ['usage', 'refused', 'unreachable', 'connection_lost', 'failed', 'protocol'];

/** Why a key can't be used here, or null. Pure. */
export function keyProblem(apiKey: unknown): string | null {
  if (typeof apiKey !== 'string' || !apiKey.trim()) return 'GaiaDesk: pass `apiKey`, a secret API key (sk_live_… or sk_test_…).';
  if (/^pk_/.test(apiKey))
    return (
      'GaiaDesk: that is a publishable key (pk_…). It can only create support sessions from your page or app. ' +
      'This server SDK needs a SECRET key (sk_live_… or sk_test_…) from your account page, kept on your server.'
    );
  return null;
}

/** Running in a web page (a bundler polyfilling Node, or a browser). */
export function inBrowser(): boolean {
  const g = globalThis as { window?: { document?: unknown } };
  return typeof g.window === 'object' && g.window !== null && typeof g.window.document !== 'undefined';
}

export class Http {
  private readonly key: string;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(o: ClientOptions) {
    const problem = keyProblem(o?.apiKey);
    if (problem) throw new TypeError(problem);
    if (inBrowser())
      throw new Error(
        'GaiaDesk: @gaiadesk/node is for your server. A secret key must never reach a browser or app: ' +
          'create sessions on your server and hand the page only the session\'s embed_token.',
      );
    const f = o.fetch ?? globalThis.fetch;
    if (typeof f !== 'function') throw new Error('GaiaDesk: no fetch available (Node 18 or later, or pass `fetch`).');
    this.key = o.apiKey;
    this.base = (o.baseUrl ?? 'https://api.gaiadesk.net/v1').replace(/\/+$/, '');
    this.fetchImpl = f;
    this.timeoutMs = o.timeoutMs ?? 30_000;
  }

  /** The answer's body: parsed JSON, or the bytes when `raw`. */
  async call<T>(
    method: string,
    path: string,
    o: { body?: unknown; query?: object; opts?: RequestOptions; raw?: boolean } = {},
  ): Promise<T> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { authorization: `Bearer ${this.key}`, accept: 'application/json', 'user-agent': 'gaiadesk-node/0.1.0' };
    if (o.body !== undefined) headers['content-type'] = 'application/json';
    if (o.opts?.idempotencyKey) headers['idempotency-key'] = o.opts.idempotencyKey;
    let resp: Response;
    try {
      resp = await this.fetchImpl(url, {
        method,
        headers,
        body: o.body === undefined ? undefined : JSON.stringify(o.body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      const timeout = (e as Error)?.name === 'TimeoutError';
      throw new GaiaDeskError(timeout ? 'GaiaDesk did not answer in time.' : `Could not reach GaiaDesk: ${(e as Error)?.message ?? e}`, {
        kind: 'unreachable',
        reason: timeout ? 'timeout' : 'network',
      });
    }
    const requestId = resp.headers.get('x-request-id');
    if (resp.ok) {
      if (o.raw) return new Uint8Array(await resp.arrayBuffer()) as T;
      return (await resp.json()) as T;
    }
    const text = await resp.text().catch(() => '');
    let err: { kind?: string; message?: string; reason?: string | null; request_id?: string } | undefined;
    try {
      err = JSON.parse(text)?.error;
    } catch {
      /* not the envelope */
    }
    const retry = Number(resp.headers.get('retry-after'));
    throw new GaiaDeskError(err?.message ?? `GaiaDesk answered ${resp.status}.`, {
      kind: KINDS.includes(err?.kind as ErrorKind) ? (err!.kind as ErrorKind) : 'protocol',
      reason: err?.reason ?? null,
      status: resp.status,
      requestId: err?.request_id ?? requestId,
      retryAfter: Number.isFinite(retry) && retry > 0 ? retry : null,
    });
  }
}

export const seg = (s: string): string => encodeURIComponent(s);
