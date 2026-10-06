import { route } from "@/lib/api";
import { createOAuthState } from "@/lib/auth/session";
import { procoreUrls, redirectUri, type ProcoreEnvironment } from "@/lib/procore/config";
import { authorizeUrl } from "@/lib/procore/oauth";
import { getInstance, oauthCredentialsFor } from "@/lib/services/instances";

export const dynamic = "force-dynamic";

/**
 * Devuelve la URL de autorización de Procore para una instancia (Authorization Code).
 * El navegador la abre en una pestaña nueva: el login de Procore no se puede mostrar dentro de un iframe.
 * El estado va firmado (instancia, usuario, caducidad 10 min) y no depende de cookies.
 */
export const POST = route(async (req, { user }) => {
  const { instanceId } = (await req.json().catch(() => ({}))) as { instanceId?: string };
  const inst = await getInstance(instanceId ?? "");
  if (inst.authMethod !== "authorization_code") throw new Error("La instancia no usa Authorization Code");
  const { loginUrl } = procoreUrls(inst.environment as ProcoreEnvironment);
  const { clientId } = oauthCredentialsFor(inst);
  const state = await createOAuthState(inst.id, user);
  return { url: authorizeUrl(loginUrl, clientId, redirectUri(), state) };
});
