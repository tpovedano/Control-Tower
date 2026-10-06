import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decrypt, encrypt } from "@/lib/crypto";
import { createSessionToken, safeEqual, verifySessionToken } from "@/lib/auth/session";

const key = randomBytes(32).toString("base64");

describe("crypto AES-256-GCM", () => {
  it("cifra y descifra", () => {
    const c = encrypt("secreto-123", key);
    expect(c).not.toContain("secreto");
    expect(decrypt(c, key)).toBe("secreto-123");
  });
  it("IV aleatorio", () => {
    expect(encrypt("x", key)).not.toBe(encrypt("x", key));
  });
  it("detecta manipulación", () => {
    const c = encrypt("x", key).split(":");
    c[3] = Buffer.from("y").toString("base64");
    expect(() => decrypt(c.join(":"), key)).toThrow();
  });
  it("rechaza claves de tamaño incorrecto", () => {
    expect(() => encrypt("x", "corta")).toThrow(/32 bytes/);
  });
});

describe("sesión", () => {
  it("firma y verifica", async () => {
    const tok = await createSessionToken("ana@x.com", "s3cret");
    expect((await verifySessionToken(tok, "s3cret"))?.user).toBe("ana@x.com");
    expect(await verifySessionToken(tok, "otro")).toBeNull();
    for (const swap of ["A", "B", "Q", "w"]) {
      const forged = tok.slice(0, -1) + swap;
      if (forged !== tok) expect(await verifySessionToken(forged, "s3cret")).toBeNull();
    }
    const [body, sig] = tok.split(".");
    const otherBody = btoa(JSON.stringify({ user: "admin", exp: 9e9 })).replace(/=+$/, "");
    expect(await verifySessionToken(`${otherBody}.${sig}`, "s3cret")).toBeNull();
    expect(body).toBeTruthy();
  });
  it("expira", async () => {
    const tok = await createSessionToken("u", "s", Date.now() - 13 * 3600 * 1000);
    expect(await verifySessionToken(tok, "s")).toBeNull();
  });
  it("safeEqual", async () => {
    expect(await safeEqual("abc", "abc")).toBe(true);
    expect(await safeEqual("abc", "abd")).toBe(false);
  });
});
