import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import type { InstanceRow } from "@/lib/db/schema";
import { decryptOptional, encrypt, encryptOptional } from "@/lib/crypto";
import { ProcoreClient, type TokenProvider } from "@/lib/procore/client";
import { envCredentials, procoreUrls, type ProcoreEnvironment } from "@/lib/procore/config";
import { isTokenFresh, requestToken } from "@/lib/procore/oauth";
import { ProcoreError } from "@/lib/procore/errors";

/** Vista pública (sin secretos) que puede enviarse al navegador. */
export interface PublicInstance {
  id: string;
  label: string;
  companyId: string;
  companyName: string | null;
  language: string;
  environment: ProcoreEnvironment;
  authMethod: "client_credentials" | "authorization_code";
  hasCustomCredentials: boolean;
  isAuthorized: boolean;
  isGolden: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
}

export const instanceInputSchema = z.object({
  label: z.string().trim().min(1, "La etiqueta es obligatoria").max(100),
  companyId: z.string().trim().regex(/^\d+$/, "El company_id debe ser numérico"),
  language: z.string().trim().min(2).max(10).default("es"),
  environment: z.enum(["production", "sandbox"]).default("production"),
  authMethod: z.enum(["client_credentials", "authorization_code"]).default("client_credentials"),
  /** Opcionales: si se omiten se usan PROCORE_CLIENT_ID / PROCORE_CLIENT_SECRET. Cadena vacía = no cambiar. */
  clientId: z.string().trim().max(200).optional(),
  clientSecret: z.string().trim().max(500).optional(),
  clearCustomCredentials: z.boolean().optional(),
  isGolden: z.boolean().optional(),
});
export type InstanceInput = z.infer<typeof instanceInputSchema>;

export function toPublic(row: InstanceRow): PublicInstance {
  return {
    id: row.id,
    label: row.label,
    companyId: row.companyId,
    companyName: row.companyName,
    language: row.language,
    environment: row.environment as ProcoreEnvironment,
    authMethod: row.authMethod as PublicInstance["authMethod"],
    hasCustomCredentials: !!row.clientIdEnc,
    isAuthorized: row.authMethod === "client_credentials" || !!row.refreshTokenEnc,
    isGolden: row.isGolden,
    lastTestAt: row.lastTestAt?.toISOString() ?? null,
    lastTestOk: row.lastTestOk,
    lastTestMessage: row.lastTestMessage,
  };
}

export async function listInstances(): Promise<InstanceRow[]> {
  return db().select().from(schema.instances).where(isNull(schema.instances.deletedAt)).orderBy(schema.instances.label);
}

export async function getInstance(id: string): Promise<InstanceRow> {
  const [row] = await db()
    .select()
    .from(schema.instances)
    .where(and(eq(schema.instances.id, id), isNull(schema.instances.deletedAt)));
  if (!row) throw new ProcoreError("not_found", "Instancia no encontrada");
  return row;
}

export async function createInstance(input: InstanceInput): Promise<InstanceRow> {
  const [row] = await db()
    .insert(schema.instances)
    .values({
      label: input.label,
      companyId: input.companyId,
      language: input.language,
      environment: input.environment,
      authMethod: input.authMethod,
      clientIdEnc: encryptOptional(input.clientId),
      clientSecretEnc: encryptOptional(input.clientSecret),
      isGolden: false,
    })
    .returning();
  if (input.isGolden) {
    await setGolden(row.id);
    return getInstance(row.id);
  }
  return row;
}

export async function updateInstance(id: string, input: InstanceInput): Promise<InstanceRow> {
  const current = await getInstance(id);
  const credentialsChanged =
    !!input.clientId ||
    !!input.clientSecret ||
    !!input.clearCustomCredentials ||
    current.authMethod !== input.authMethod ||
    current.environment !== input.environment ||
    current.companyId !== input.companyId;
  const patch: Partial<typeof schema.instances.$inferInsert> = {
    label: input.label,
    companyId: input.companyId,
    language: input.language,
    environment: input.environment,
    authMethod: input.authMethod,
    updatedAt: new Date(),
  };
  if (input.clearCustomCredentials) {
    patch.clientIdEnc = null;
    patch.clientSecretEnc = null;
  }
  if (input.clientId) patch.clientIdEnc = encrypt(input.clientId);
  if (input.clientSecret) patch.clientSecretEnc = encrypt(input.clientSecret);
  if (credentialsChanged) {
    patch.accessTokenEnc = null;
    patch.accessTokenExpiresAt = null;
    tokenCache.delete(id);
  }
  if (current.authMethod !== input.authMethod || current.environment !== input.environment) patch.refreshTokenEnc = null;
  const [row] = await db().update(schema.instances).set(patch).where(eq(schema.instances.id, id)).returning();
  if (input.isGolden !== undefined && input.isGolden !== current.isGolden) {
    if (input.isGolden) await setGolden(id);
    else await db().update(schema.instances).set({ isGolden: false }).where(eq(schema.instances.id, id));
    return getInstance(id);
  }
  return row;
}

/** Baja lógica: se conserva para el audit log; se borran tokens. */
export async function softDeleteInstance(id: string): Promise<void> {
  tokenCache.delete(id);
  await db()
    .update(schema.instances)
    .set({ deletedAt: new Date(), isGolden: false, accessTokenEnc: null, refreshTokenEnc: null, clientSecretEnc: null, updatedAt: new Date() })
    .where(eq(schema.instances.id, id));
}

export async function setGolden(id: string): Promise<void> {
  await db().update(schema.instances).set({ isGolden: false }).where(eq(schema.instances.isGolden, true));
  await db().update(schema.instances).set({ isGolden: true }).where(eq(schema.instances.id, id));
}

// ---------- Tokens ----------

/** Caché en memoria por instancia (se complementa con el token cifrado en BD entre invocaciones serverless). */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const inflight = new Map<string, Promise<string>>();

function credentialsFor(row: InstanceRow): { clientId: string; clientSecret: string } {
  const env = envCredentials(row.environment as ProcoreEnvironment);
  const clientId = decryptOptional(row.clientIdEnc)?.trim() || env.clientId;
  const clientSecret = decryptOptional(row.clientSecretEnc)?.trim() || env.clientSecret;
  if (!clientId || !clientSecret) {
    throw new ProcoreError(
      "config",
      `Faltan ${env.idVar} / ${env.secretVar} para instancias de ${row.environment === "sandbox" ? "Sandbox" : "Producción"} (o una credencial propia en la instancia).`,
    );
  }
  return { clientId, clientSecret };
}

async function fetchNewToken(row: InstanceRow): Promise<string> {
  const { loginUrl } = procoreUrls(row.environment as ProcoreEnvironment);
  const { clientId, clientSecret } = credentialsFor(row);
  let token;
  if (row.authMethod === "authorization_code") {
    // Re-leer el refresh token más reciente (Procore lo rota en cada uso).
    const fresh = await getInstance(row.id);
    const refreshToken = decryptOptional(fresh.refreshTokenEnc);
    if (!refreshToken) {
      throw new ProcoreError("unauthorized", "La instancia aún no está autorizada. Usa “Autorizar con Procore” en la pestaña Instancias.");
    }
    token = await requestToken(loginUrl, { grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken });
  } else {
    token = await requestToken(loginUrl, { grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret });
  }
  await db()
    .update(schema.instances)
    .set({
      accessTokenEnc: encrypt(token.accessToken),
      accessTokenExpiresAt: new Date(token.expiresAt),
      ...(token.refreshToken ? { refreshTokenEnc: encrypt(token.refreshToken) } : {}),
    })
    .where(eq(schema.instances.id, row.id));
  tokenCache.set(row.id, { token: token.accessToken, expiresAt: token.expiresAt });
  return token.accessToken;
}

export function tokenProviderFor(row: InstanceRow): TokenProvider {
  return {
    async getToken(force = false) {
      if (!force) {
        const cached = tokenCache.get(row.id);
        if (cached && isTokenFresh(cached.expiresAt)) return cached.token;
        const fresh = await getInstance(row.id);
        const exp = fresh.accessTokenExpiresAt?.getTime();
        if (fresh.accessTokenEnc && isTokenFresh(exp)) {
          const token = decryptOptional(fresh.accessTokenEnc)!;
          tokenCache.set(row.id, { token, expiresAt: exp! });
          return token;
        }
      }
      // Evita pedir varios tokens a la vez para la misma instancia.
      let p = inflight.get(row.id);
      if (!p) {
        p = fetchNewToken(row).finally(() => inflight.delete(row.id));
        inflight.set(row.id, p);
      }
      return p;
    },
  };
}

export function clientFor(row: InstanceRow): ProcoreClient {
  const { baseUrl } = procoreUrls(row.environment as ProcoreEnvironment);
  return new ProcoreClient({
    baseUrl,
    companyId: row.companyId,
    tokenProvider: tokenProviderFor(row),
    concurrencyKey: row.id,
  });
}

export async function saveAuthorizationTokens(id: string, t: { accessToken: string; refreshToken?: string; expiresAt: number }) {
  tokenCache.set(id, { token: t.accessToken, expiresAt: t.expiresAt });
  await db()
    .update(schema.instances)
    .set({
      accessTokenEnc: encrypt(t.accessToken),
      accessTokenExpiresAt: new Date(t.expiresAt),
      refreshTokenEnc: t.refreshToken ? encrypt(t.refreshToken) : null,
      updatedAt: new Date(),
    })
    .where(eq(schema.instances.id, id));
}

export function oauthCredentialsFor(row: InstanceRow) {
  return credentialsFor(row);
}

export async function recordTest(id: string, ok: boolean, message: string, companyName?: string | null) {
  await db()
    .update(schema.instances)
    .set({ lastTestAt: new Date(), lastTestOk: ok, lastTestMessage: message, ...(companyName ? { companyName } : {}) })
    .where(eq(schema.instances.id, id));
}
