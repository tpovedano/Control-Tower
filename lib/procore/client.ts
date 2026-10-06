import { PER_PAGE_MAX } from "./endpoints";
import { ProcoreError, errorFromResponse } from "./errors";
import { Semaphore } from "./semaphore";

export interface TokenProvider {
  /** Devuelve un access token válido. force=true obliga a renovarlo. */
  getToken(force?: boolean): Promise<string>;
}

export interface ProcoreClientOptions {
  baseUrl: string;
  companyId: string;
  tokenProvider: TokenProvider;
  fetchImpl?: typeof fetch;
  /** Clave para compartir el límite de concurrencia (normalmente el id de la instancia). */
  concurrencyKey?: string;
  maxConcurrency?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Base del backoff exponencial en ms. */
  backoffBaseMs?: number;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | (string | number)[] | undefined>;
  body?: unknown;
  /** Por defecto se envía Procore-Company-Id. */
  companyHeader?: boolean;
  /** Nombre legible del recurso para mensajes de error. */
  resource?: string;
}

export interface ProcoreResponse<T> {
  status: number;
  data: T;
  headers: Headers;
}

const semaphores = new Map<string, Semaphore>();
function semaphoreFor(key: string, max: number): Semaphore {
  let s = semaphores.get(key);
  if (!s) {
    s = new Semaphore(max);
    semaphores.set(key, s);
  }
  return s;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function buildUrl(baseUrl: string, path: string, query?: RequestOptions["query"]): string {
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : baseUrl + "/");
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, String(x)));
      else url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

/** Parsea Retry-After (segundos o fecha HTTP) a milisegundos. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return null;
}

/** Extrae el array de una respuesta de lista (Procore v1 devuelve array; v2 suele envolver en { data }). */
export function extractList<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[];
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (Array.isArray(b.data)) return b.data as T[];
    for (const v of Object.values(b)) if (Array.isArray(v)) return v as T[];
  }
  return [];
}

/** Extrae el objeto de una respuesta individual ({ data: {...} } o {...}). */
export function extractObject<T>(body: unknown): T {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const b = body as Record<string, unknown>;
    if (b.data && typeof b.data === "object" && !Array.isArray(b.data)) return b.data as T;
  }
  return body as T;
}

export class ProcoreClient {
  readonly baseUrl: string;
  readonly companyId: string;
  private readonly tokenProvider: TokenProvider;
  private readonly fetchImpl: typeof fetch;
  private readonly semaphore: Semaphore;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly backoffBaseMs: number;

  constructor(opts: ProcoreClientOptions) {
    this.baseUrl = opts.baseUrl;
    this.companyId = opts.companyId;
    this.tokenProvider = opts.tokenProvider;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    const max = opts.maxConcurrency ?? Number(process.env.PROCORE_MAX_CONCURRENCY ?? 3);
    this.semaphore = opts.concurrencyKey ? semaphoreFor(opts.concurrencyKey, max) : new Semaphore(max);
    this.maxRetries = opts.maxRetries ?? 5;
    this.sleep = opts.sleep ?? defaultSleep;
    this.backoffBaseMs = opts.backoffBaseMs ?? 1000;
  }

  async request<T = unknown>(method: string, path: string, opts: RequestOptions = {}): Promise<ProcoreResponse<T>> {
    const url = buildUrl(this.baseUrl, path, opts.query);
    const isIdempotent = method === "GET";
    let attempt = 0;
    let refreshedToken = false;

    for (;;) {
      const token = await this.tokenProvider.getToken(false);
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      };
      if (opts.companyHeader !== false) headers["Procore-Company-Id"] = this.companyId;
      if (opts.body !== undefined) headers["Content-Type"] = "application/json";

      let res: Response;
      try {
        res = await this.semaphore.run(() =>
          this.fetchImpl(url, {
            method,
            headers,
            body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
            cache: "no-store",
          }),
        );
      } catch (e) {
        if (isIdempotent && attempt < this.maxRetries) {
          await this.sleep(this.backoff(attempt++));
          continue;
        }
        throw new ProcoreError("network", `No se pudo conectar con Procore: ${(e as Error).message}`);
      }

      if (res.status === 401 && !refreshedToken) {
        // Token caducado o revocado: renovar una vez y reintentar.
        refreshedToken = true;
        await this.tokenProvider.getToken(true);
        continue;
      }

      if (res.status === 429 && attempt < this.maxRetries) {
        const wait = parseRetryAfter(res.headers.get("Retry-After")) ?? this.backoff(attempt);
        attempt++;
        await this.sleep(wait);
        continue;
      }

      if (res.status >= 500 && isIdempotent && attempt < Math.min(this.maxRetries, 3)) {
        await this.sleep(this.backoff(attempt++));
        continue;
      }

      const text = await res.text();
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
      if (!res.ok) throw errorFromResponse(res.status, body, opts.resource);
      return { status: res.status, data: body as T, headers: res.headers };
    }
  }

  private backoff(attempt: number): number {
    const jitter = Math.random() * 0.25 + 0.875;
    return Math.min(30_000, this.backoffBaseMs * 2 ** attempt * jitter);
  }

  get<T = unknown>(path: string, opts?: RequestOptions) {
    return this.request<T>("GET", path, opts);
  }
  post<T = unknown>(path: string, body: unknown, opts?: RequestOptions) {
    return this.request<T>("POST", path, { ...opts, body });
  }
  patch<T = unknown>(path: string, body: unknown, opts?: RequestOptions) {
    return this.request<T>("PATCH", path, { ...opts, body });
  }

  /** Recorre todas las páginas (page/per_page, máx. 100). */
  async paginate<T = unknown>(path: string, opts: RequestOptions = {}, maxPages = 500): Promise<T[]> {
    const all: T[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const res = await this.get<unknown>(path, { ...opts, query: { ...opts.query, page, per_page: PER_PAGE_MAX } });
      const items = extractList<T>(res.data);
      all.push(...items);
      const total = Number(res.headers.get("Total") ?? res.headers.get("X-Total") ?? NaN);
      if (Number.isFinite(total) && all.length >= total) break;
      if (items.length < PER_PAGE_MAX) break;
    }
    return all;
  }
}
