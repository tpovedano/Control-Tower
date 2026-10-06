import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { signValue } from "@/lib/auth/session";
import { procoreUrls, redirectUri, type ProcoreEnvironment } from "@/lib/procore/config";
import { authorizeUrl } from "@/lib/procore/oauth";
import { getInstance, oauthCredentialsFor } from "@/lib/services/instances";

export const dynamic = "force-dynamic";
const STATE_COOKIE = "ct_oauth_state";

/** Inicia el flujo Authorization Code para una instancia. */
export const GET = route(async (req) => {
  const instanceId = req.nextUrl.searchParams.get("instanceId") ?? "";
  const inst = await getInstance(instanceId);
  if (inst.authMethod !== "authorization_code") throw new Error("La instancia no usa Authorization Code");
  const { loginUrl } = procoreUrls(inst.environment as ProcoreEnvironment);
  const { clientId } = oauthCredentialsFor(inst);
  const nonce = crypto.randomUUID();
  const value = `${inst.id}.${nonce}`;
  const state = `${value}.${await signValue(value)}`;
  const res = NextResponse.redirect(authorizeUrl(loginUrl, clientId, redirectUri(), state));
  res.cookies.set(STATE_COOKIE, state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  return res;
});
