import { type NextRequest } from "next/server";
import { verifyOAuthState } from "@/lib/auth/session";
import { envCredentials, procoreUrls, redirectUri, type ProcoreEnvironment } from "@/lib/procore/config";
import { requestToken } from "@/lib/procore/oauth";
import { toErrorInfo } from "@/lib/procore/errors";
import { audit } from "@/lib/services/audit";
import { getInstance, oauthCredentialsFor, saveAuthorizationTokens } from "@/lib/services/instances";

export const dynamic = "force-dynamic";

/**
 * Callback OAuth (Redirect URI registrado en el Developer Portal: /api/auth/procore/callback).
 * Es una ruta pública: se abre en una pestaña nueva, donde la cookie de sesión del iframe de Procore
 * no está disponible. La autenticidad la garantiza el `state` firmado y de corta duración.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const code = q.get("code");
  const state = await verifyOAuthState(q.get("state"));
  const inst = state ? await getInstance(state.i).catch(() => null) : null;
  const details = inst ? diagnostics(inst) : [];

  // Procore devolvió un error en la redirección: falló el paso de autorización (antes de canjear el código).
  const procoreError = q.get("error");
  if (procoreError) {
    const desc = q.get("error_description") ?? "";
    if (inst && state) {
      await audit({ user: state.u, instanceId: inst.id, instanceLabel: inst.label, companyId: inst.companyId, action: "OAUTH_AUTHORIZE", result: "error", message: `${procoreError}: ${desc}` });
    }
    return page(false, explainAuthorizeError(procoreError, desc), [["Etapa", "Autorización en Procore (antes de volver a la app)"], ["Error de Procore", `${procoreError}${desc ? ` — ${desc}` : ""}`], ...details]);
  }

  if (!code || !state) return page(false, "Estado OAuth inválido o caducado. Vuelve a pulsar “Autorizar con Procore”.", details);
  if (!inst) return page(false, "La instancia ya no existe.");

  try {
    const { loginUrl } = procoreUrls(inst.environment as ProcoreEnvironment);
    const { clientId, clientSecret } = oauthCredentialsFor(inst);
    const token = await requestToken(loginUrl, { grant_type: "authorization_code", client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri() });
    await saveAuthorizationTokens(inst.id, token);
    await audit({ user: state.u, instanceId: inst.id, instanceLabel: inst.label, companyId: inst.companyId, action: "OAUTH_AUTHORIZE", result: "success" });
    return page(true, `La instancia “${inst.label}” quedó autorizada.`);
  } catch (e) {
    const info = toErrorInfo(e);
    await audit({ user: state.u, instanceId: inst.id, instanceLabel: inst.label, companyId: inst.companyId, action: "OAUTH_AUTHORIZE", result: "error", message: info.message });
    return page(false, info.message, [["Etapa", "Canje del código por un token (servidor de la app → Procore)"], ...(info.procoreMessage ? [["Respuesta de Procore", info.procoreMessage] as [string, string]] : []), ...details]);
  }
}

function explainAuthorizeError(code: string, desc: string): string {
  if (code === "invalid_client" || /unknown client/i.test(desc)) {
    return "El servidor de login de Procore no reconoce el client_id enviado. Comprueba que el client_id de abajo es el de las credenciales del mismo entorno que la instancia (Sandbox → “Sandbox OAuth Credentials”) y que ese entorno de la app tiene registrado el Redirect URI de abajo.";
  }
  if (code === "access_denied") return "Se canceló o denegó la autorización en Procore.";
  if (code === "invalid_redirect_uri" || /redirect/i.test(desc)) return "El Redirect URI no coincide con el registrado en el Developer Portal para este entorno.";
  return "Procore rechazó la autorización.";
}

/** Datos no secretos para comparar con el Developer Portal (el client_id se muestra parcialmente). */
function diagnostics(inst: Awaited<ReturnType<typeof getInstance>>): [string, string][] {
  const env = inst.environment as ProcoreEnvironment;
  const { loginUrl } = procoreUrls(env);
  let clientId = "(no configurado)";
  let source = envCredentials(env).idVar;
  try {
    clientId = oauthCredentialsFor(inst).clientId;
    if (inst.clientIdEnc) source = "credencial propia de la instancia";
  } catch {
    /* sin credenciales */
  }
  const masked = clientId.length > 12 ? `${clientId.slice(0, 6)}…${clientId.slice(-4)}` : clientId;
  return [
    ["Instancia", `${inst.label} (company ${inst.companyId})`],
    ["Entorno de la instancia", env === "sandbox" ? "Sandbox" : "Producción"],
    ["Servidor de login usado", loginUrl],
    ["client_id enviado", `${masked} (de ${source})`],
    ["Redirect URI enviado", redirectUri()],
  ];
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Página mínima: avisa a la ventana que abrió la autorización y se cierra. */
function page(ok: boolean, message: string, details: [string, string][] = []) {
  const rows = details.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("");
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Procore Control Tower</title>
<style>body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#f8fafc;color:#0f172a}
main{max-width:640px;padding:24px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;text-align:center}
h1{font-size:18px;margin:0 0 8px}p{color:#475569}table{margin:12px 0;text-align:left;font-size:13px;border-collapse:collapse;width:100%}th,td{border-top:1px solid #e2e8f0;padding:6px;vertical-align:top}th{white-space:nowrap;color:#475569;font-weight:600}td{word-break:break-all}</style></head>
<body><main><h1>${ok ? "✅ Autorización completada" : "❌ No se pudo autorizar"}</h1><p>${escapeHtml(message)}</p>${rows ? `<table>${rows}</table>` : ""}
<p>Puedes cerrar esta pestaña y volver a Control Tower${ok ? " (pulsa “Probar conexión”)" : ""}.</p></main>
<script>try{window.opener&&window.opener.postMessage({type:"ct-oauth",ok:${ok}},"*");}catch(e){}${ok ? "setTimeout(function(){window.close()},1500);" : ""}</script>
</body></html>`;
  return new Response(html, { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
