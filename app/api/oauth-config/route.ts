import { route } from "@/lib/api";
import { appUrl, procoreUrls, redirectUri } from "@/lib/procore/config";

export const dynamic = "force-dynamic";

/** Datos (no secretos) para registrar el Redirect URI en el Developer Portal. */
export const GET = route(async () => ({
  appUrl: appUrl(),
  redirectUri: redirectUri(),
  loginUrls: { production: procoreUrls("production").loginUrl, sandbox: procoreUrls("sandbox").loginUrl },
}));
