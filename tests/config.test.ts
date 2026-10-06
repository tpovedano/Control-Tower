import { afterEach, describe, expect, it, vi } from "vitest";
import { envCredentials, normalizeAppUrl, redirectUri } from "@/lib/procore/config";
import { requestToken } from "@/lib/procore/oauth";

afterEach(() => vi.unstubAllEnvs());

describe("credenciales por entorno", () => {
  it("producción y sandbox usan variables distintas y se recortan espacios", () => {
    vi.stubEnv("PROCORE_CLIENT_ID", " prod-id \n");
    vi.stubEnv("PROCORE_CLIENT_SECRET", "prod-secret");
    vi.stubEnv("PROCORE_SANDBOX_CLIENT_ID", "sbx-id");
    vi.stubEnv("PROCORE_SANDBOX_CLIENT_SECRET", "sbx-secret");
    expect(envCredentials("production")).toMatchObject({ clientId: "prod-id", clientSecret: "prod-secret" });
    expect(envCredentials("sandbox")).toMatchObject({ clientId: "sbx-id", clientSecret: "sbx-secret" });
  });
  it("sandbox no cae en las credenciales de producción", () => {
    vi.stubEnv("PROCORE_CLIENT_ID", "prod-id");
    vi.stubEnv("PROCORE_SANDBOX_CLIENT_ID", "");
    expect(envCredentials("sandbox").clientId).toBeUndefined();
  });
  it("redirect URI sin barra final ni espacios", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", " https://ct.vercel.app/ ");
    expect(redirectUri()).toBe("https://ct.vercel.app/api/auth/procore/callback");
  });
  it("invalid_client se explica en español", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_client", error_description: "Client authentication failed due to unknown client" }), { status: 401 }));
    await expect(requestToken("https://l", { grant_type: "client_credentials", client_id: "x", client_secret: "y" }, f as unknown as typeof fetch)).rejects.toThrow(/mismo entorno/);
  });
});

describe("URL pública de la app", () => {
  it("completa https:// y quita la barra final", () => {
    expect(normalizeAppUrl("control-tower-roan-seven.vercel.app")).toBe("https://control-tower-roan-seven.vercel.app");
    expect(normalizeAppUrl(" https://ct.vercel.app/ ")).toBe("https://ct.vercel.app");
    expect(normalizeAppUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });
  it("vacía o inválida → null (nunca lanza)", () => {
    expect(normalizeAppUrl("")).toBeNull();
    expect(normalizeAppUrl(undefined)).toBeNull();
    expect(normalizeAppUrl("https://")).toBeNull();
  });
  it("el redirect URI usa la URL normalizada", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "control-tower-roan-seven.vercel.app");
    expect(redirectUri()).toBe("https://control-tower-roan-seven.vercel.app/api/auth/procore/callback");
  });
});
