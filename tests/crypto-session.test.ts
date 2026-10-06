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
    expect(await verifySessionToken(tok.replace(/.$/, "A"), "s3cret")).toBeNull();
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
