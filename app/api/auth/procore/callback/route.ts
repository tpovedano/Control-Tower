import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { signValue } from "@/lib/auth/session";
import { procoreUrls, redirectUri, type ProcoreEnvironment } from "@/lib/procore/config";
import { requestToken } from "@/lib/procore/oauth";
import { toErrorInfo } from "@/lib/procore/errors";
import { audit } from "@/lib/services/audit";
import { getInstance, oauthCredentialsFor, saveAuthorizationTokens } from "@/lib/services/instances";

export const dynamic = "force-dynamic";

/** Callback OAuth (Redirect URI registrado en el Developer Portal: /api/auth/procore/callback). */
export const GET = route(async (req, { user }) => {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, "");
  const back = (q: string) => {
    const res = NextResponse.redirect(`${appUrl}/instancias?${q}`);
    res.cookies.set("ct_oauth_state", "", { path: "/", maxAge: 0 });
    return res;
  };
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state") ?? "";
  const cookieState = req.cookies.get("ct_oauth_state")?.value;
  const [instanceId, nonce, sig] = state.split(".");
  if (!code || !cookieState || cookieState !== state || !instanceId || !nonce || sig !== (await signValue(`${instanceId}.${nonce}`))) {
    return back("oauth=error&msg=" + encodeURIComponent("Estado OAuth inválido o caducado. Vuelve a intentarlo."));
  }
  const inst = await getInstance(instanceId);
  try {
    const { loginUrl } = procoreUrls(inst.environment as ProcoreEnvironment);
    const { clientId, clientSecret } = oauthCredentialsFor(inst);
    const token = await requestToken(loginUrl, { grant_type: "authorization_code", client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri() });
    await saveAuthorizationTokens(inst.id, token);
    await audit({ user, instanceId: inst.id, instanceLabel: inst.label, companyId: inst.companyId, action: "OAUTH_AUTHORIZE", result: "success" });
    return back("oauth=ok");
  } catch (e) {
    const info = toErrorInfo(e);
    await audit({ user, instanceId: inst.id, instanceLabel: inst.label, companyId: inst.companyId, action: "OAUTH_AUTHORIZE", result: "error", message: info.message });
    return back("oauth=error&msg=" + encodeURIComponent(info.message));
  }
});
