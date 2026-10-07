import { describe, expect, it, vi } from "vitest";
import { ProcoreClient, buildUrl, extractList, parseRetryAfter, type TokenProvider } from "@/lib/procore/client";
import { ProcoreError } from "@/lib/procore/errors";
import { isTokenFresh, requestToken } from "@/lib/procore/oauth";

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function makeClient(fetchImpl: typeof fetch, tokens: TokenProvider = { getToken: async () => "tok" }) {
  return new ProcoreClient({ baseUrl: "https://api.procore.com", companyId: "42", tokenProvider: tokens, fetchImpl, sleep: async () => {}, maxConcurrency: 3 });
}

describe("ProcoreClient", () => {
  it("envía Bearer y Procore-Company-Id", async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({ ok: 1 }));
    await makeClient(f as unknown as typeof fetch).get("/rest/v1.0/x");
    const init = f.mock.calls[0][1]!;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect((init.headers as Record<string, string>)["Procore-Company-Id"]).toBe("42");
  });

  it("recorre todas las páginas (per_page=100)", async () => {
    const pages = [Array.from({ length: 100 }, (_, i) => ({ id: i })), Array.from({ length: 100 }, (_, i) => ({ id: 100 + i })), [{ id: 200 }]];
    const f = vi.fn(async (url: string | URL | Request) => {
      const u = new URL(String(url));
      expect(u.searchParams.get("per_page")).toBe("100");
      return json(pages[Number(u.searchParams.get("page")) - 1]);
    });
    const all = await makeClient(f as unknown as typeof fetch).paginate("/rest/v1.0/x");
    expect(all).toHaveLength(201);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("acepta listas envueltas en { data }", async () => {
    const f = vi.fn(async () => json({ data: [{ id: 1 }] }));
    expect(await makeClient(f as unknown as typeof fetch).paginate("/rest/v2.0/x")).toEqual([{ id: 1 }]);
  });

  it("429: respeta Retry-After y reintenta", async () => {
    const sleeps: number[] = [];
    let n = 0;
    const f = vi.fn(async () => (n++ === 0 ? json({}, 429, { "Retry-After": "2" }) : json([{ id: 1 }])));
    const c = new ProcoreClient({ baseUrl: "https://api.procore.com", companyId: "1", tokenProvider: { getToken: async () => "t" }, fetchImpl: f as unknown as typeof fetch, sleep: async (ms) => void sleeps.push(ms) });
    const r = await c.get("/x");
    expect(r.data).toEqual([{ id: 1 }]);
    expect(sleeps).toEqual([2000]);
  });

  it("429 persistente → error rate_limited", async () => {
    const f = vi.fn(async () => json({}, 429));
    const c = new ProcoreClient({ baseUrl: "https://a", companyId: "1", tokenProvider: { getToken: async () => "t" }, fetchImpl: f as unknown as typeof fetch, sleep: async () => {}, maxRetries: 2 });
    await expect(c.get("/x")).rejects.toMatchObject({ code: "rate_limited", status: 429 });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("401: renueva el token una vez", async () => {
    const getToken = vi.fn(async (force?: boolean) => (force ? "nuevo" : "viejo"));
    let n = 0;
    const f = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => (n++ === 0 ? json({}, 401) : json({ ok: true })));
    await makeClient(f as unknown as typeof fetch, { getToken }).get("/x");
    expect(getToken).toHaveBeenCalledWith(true);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("mapea 403 / 422 con mensajes legibles y el original de Procore", async () => {
    const f403 = vi.fn(async () => json({ error: "Forbidden" }, 403));
    await expect(makeClient(f403 as unknown as typeof fetch).get("/x", { resource: "Custom Fields" })).rejects.toThrow(/403 \(prohibido\) \(Custom Fields\)/);
    const f422 = vi.fn(async () => json({ errors: { label: ["has already been taken"] } }, 422));
    try {
      await makeClient(f422 as unknown as typeof fetch).post("/x", {});
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ProcoreError);
      expect((e as ProcoreError).code).toBe("validation");
      expect((e as ProcoreError).procoreMessage).toContain("has already been taken");
    }
  });

  it("no reintenta POST ante 5xx (evita duplicados)", async () => {
    const f = vi.fn(async () => json({}, 503));
    await expect(makeClient(f as unknown as typeof fetch).post("/x", {})).rejects.toMatchObject({ code: "server" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("limita la concurrencia", async () => {
    let active = 0;
    let peak = 0;
    const f = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return json({});
    });
    const c = makeClient(f as unknown as typeof fetch);
    await Promise.all(Array.from({ length: 10 }, () => c.get("/x")));
    expect(peak).toBeLessThanOrEqual(3);
  });
});

describe("utilidades", () => {
  it("buildUrl con arrays", () => {
    expect(buildUrl("https://a.com", "/x", { "types[]": ["A", "B"], page: 1 })).toBe("https://a.com/x?types%5B%5D=A&types%5B%5D=B&page=1");
  });
  it("Retry-After en segundos y fecha", () => {
    expect(parseRetryAfter("3")).toBe(3000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter(null)).toBeNull();
  });
  it("extractList", () => {
    expect(extractList([1])).toEqual([1]);
    expect(extractList({ data: [2] })).toEqual([2]);
    expect(extractList({})).toEqual([]);
  });
});

describe("OAuth", () => {
  it("client_credentials devuelve token y expiración", async () => {
    const f = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      expect(String(init?.body)).toContain("grant_type=client_credentials");
      return json({ access_token: "abc", expires_in: 5400 });
    });
    const t = await requestToken("https://login.procore.com", { grant_type: "client_credentials", client_id: "id", client_secret: "sec" }, f as unknown as typeof fetch, 0);
    expect(t).toEqual({ accessToken: "abc", refreshToken: undefined, expiresAt: 5_400_000 });
  });
  it("error no expone el secret", async () => {
    const f = vi.fn(async () => json({ error: "invalid_client" }, 401));
    await expect(requestToken("https://l", { grant_type: "client_credentials", client_id: "id", client_secret: "SUPERSECRETO" }, f as unknown as typeof fetch)).rejects.toSatisfy(
      (e: Error) => !e.message.includes("SUPERSECRETO"),
    );
  });
  it("margen de 60 s", () => {
    expect(isTokenFresh(Date.now() + 30_000)).toBe(false);
    expect(isTokenFresh(Date.now() + 120_000)).toBe(true);
  });
});
