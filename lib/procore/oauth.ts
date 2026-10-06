import { PROCORE_ENDPOINTS } from "./endpoints";
import { ProcoreError, extractProcoreMessage } from "./errors";

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms en que expira el token. */
  expiresAt: number;
}

export type TokenGrant =
  | { grant_type: "client_credentials"; client_id: string; client_secret: string }
  | { grant_type: "refresh_token"; client_id: string; client_secret: string; refresh_token: string; redirect_uri?: string }
  | { grant_type: "authorization_code"; client_id: string; client_secret: string; code: string; redirect_uri: string };

/** Margen de seguridad antes de la expiración. */
export const TOKEN_EXPIRY_MARGIN_MS = 60_000;

export function isTokenFresh(expiresAt: number | null | undefined, now = Date.now()): boolean {
  return !!expiresAt && expiresAt - TOKEN_EXPIRY_MARGIN_MS > now;
}

export async function requestToken(loginUrl: string, grant: TokenGrant, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<TokenResponse> {
  const url = new URL(PROCORE_ENDPOINTS.oauth.token, loginUrl).toString();
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(grant as Record<string, string>).toString(),
      cache: "no-store",
    });
  } catch (e) {
    throw new ProcoreError("network", `No se pudo contactar el servidor de login de Procore: ${(e as Error).message}`);
  }
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    /* respuesta no JSON */
  }
  if (!res.ok || typeof body.access_token !== "string") {
    const original = extractProcoreMessage(body) ?? text.slice(0, 200);
    const code = typeof body.error === "string" ? body.error : "";
    const msg =
      code === "invalid_client"
        ? "Procore no reconoce el client_id/secret. Comprueba que usas las credenciales del mismo entorno que la instancia (Sandbox y Producción tienen credenciales distintas en el Developer Portal) y que no tienen espacios."
        : code === "invalid_grant"
          ? "El código de autorización o el refresh token no es válido o caducó (o el Redirect URI no coincide). Vuelve a autorizar la instancia."
          : res.status === 401 || res.status === 400
            ? "Procore rechazó la credencial (client_id/secret o refresh token inválidos o revocados)."
            : `Error obteniendo token de Procore (${res.status}).`;
    // Nunca incluimos los parámetros de la petición en el error.
    throw new ProcoreError("unauthorized", msg, res.status, original);
  }
  const expiresIn = Number(body.expires_in ?? 5400);
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
    expiresAt: now + expiresIn * 1000,
  };
}

export function authorizeUrl(loginUrl: string, clientId: string, redirectUri: string, state: string): string {
  const url = new URL(PROCORE_ENDPOINTS.oauth.authorize, loginUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}
