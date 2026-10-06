/**
 * Sesión mínima firmada con HMAC-SHA256 (Web Crypto: funciona en middleware edge y en Node).
 * Cookie: base64url(payload).base64url(firma)
 */
export const SESSION_COOKIE = "ct_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export interface SessionPayload {
  user: string;
  exp: number; // epoch segundos
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

export function sessionSecret(): string {
  const s = process.env.SESSION_SECRET || (process.env.ENCRYPTION_KEY ? `session:${process.env.ENCRYPTION_KEY}` : "");
  if (!s) throw new Error("SESSION_SECRET o ENCRYPTION_KEY deben estar configurados");
  return s;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signValue(value: string, secret = sessionSecret()): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(value));
  return b64url(new Uint8Array(sig));
}

export async function createSessionToken(user: string, secret = sessionSecret(), now = Date.now()): Promise<string> {
  const payload: SessionPayload = { user, exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${body}.${await signValue(body, secret)}`;
}

export async function verifySessionToken(token: string | undefined, secret = sessionSecret(), now = Date.now()): Promise<SessionPayload | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    // Se compara la firma canónica re-codificada: rechaza también codificaciones base64 no canónicas.
    if (!(await safeEqual(sig, await signValue(body, secret)))) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as SessionPayload;
    if (typeof payload.user !== "string" || payload.exp * 1000 < now) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Comparación en tiempo constante de dos strings (vía HMAC para igualar longitudes). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const key = await hmacKey("compare");
  const [ha, hb] = await Promise.all([crypto.subtle.sign("HMAC", key, enc.encode(a)), crypto.subtle.sign("HMAC", key, enc.encode(b))]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
