import { type NextRequest } from "next/server";
import { verifyOAuthState } from "@/lib/auth/session";
import { procoreUrls, redirectUri, type ProcoreEnvironment } from "@/lib/procore/config";
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
  const code = req.nextUrl.searchParams.get("code");
  const state = await verifyOAuthState(req.nextUrl.searchParams.get("state"));
  if (!code || !state) {
    return page(false, req.nextUrl.searchParams.get("error_description") ?? "Estado OAuth inválido o caducado. Vuelve a pulsar “Autorizar con Procore”.");
  }
  let inst;
  try {
    inst = await getInstance(state.i);
  } catch {
    return page(false, "La instancia ya no existe.");
  }
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
    return page(false, info.message);
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Página mínima: avisa a la ventana que abrió la autorización y se cierra. */
function page(ok: boolean, message: string) {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Procore Control Tower</title>
<style>body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#f8fafc;color:#0f172a}
main{max-width:420px;padding:24px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;text-align:center}
h1{font-size:18px;margin:0 0 8px}p{color:#475569}</style></head>
<body><main><h1>${ok ? "✅ Autorización completada" : "❌ No se pudo autorizar"}</h1><p>${escapeHtml(message)}</p>
<p>Puedes cerrar esta pestaña y volver a Control Tower${ok ? " (pulsa “Probar conexión”)" : ""}.</p></main>
<script>try{window.opener&&window.opener.postMessage({type:"ct-oauth",ok:${ok}},"*");}catch(e){}${ok ? "setTimeout(function(){window.close()},1500);" : ""}</script>
</body></html>`;
  return new Response(html, { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
