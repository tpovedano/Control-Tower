import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Cifrado simétrico AES-256-GCM para tokens y secrets por instancia. Formato: v1:iv:tag:ciphertext (base64). */

function loadKey(raw: string | undefined = process.env.ENCRYPTION_KEY): Buffer {
  if (!raw) throw new Error("ENCRYPTION_KEY no está configurada");
  const trimmed = raw.trim();
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) key = Buffer.from(trimmed, "hex");
  else key = Buffer.from(trimmed, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY debe ser de 32 bytes (base64 o 64 caracteres hex)");
  return key;
}

export function encrypt(plain: string, rawKey?: string): string {
  const key = loadKey(rawKey ?? process.env.ENCRYPTION_KEY);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

export function decrypt(payload: string, rawKey?: string): string {
  const key = loadKey(rawKey ?? process.env.ENCRYPTION_KEY);
  const [version, ivB64, tagB64, ctB64] = payload.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || ctB64 === undefined) throw new Error("Formato cifrado no reconocido");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

export function encryptOptional(v: string | null | undefined): string | null {
  return v ? encrypt(v) : null;
}

export function decryptOptional(v: string | null | undefined): string | null {
  return v ? decrypt(v) : null;
}
