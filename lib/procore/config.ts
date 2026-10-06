export type ProcoreEnvironment = "production" | "sandbox";

export function procoreUrls(env: ProcoreEnvironment): { baseUrl: string; loginUrl: string } {
  if (env === "sandbox") {
    return {
      baseUrl: process.env.PROCORE_SANDBOX_BASE_URL || "https://sandbox.procore.com",
      loginUrl: process.env.PROCORE_SANDBOX_LOGIN_URL || "https://login-sandbox.procore.com",
    };
  }
  return {
    baseUrl: process.env.PROCORE_BASE_URL || "https://api.procore.com",
    loginUrl: process.env.PROCORE_LOGIN_URL || "https://login.procore.com",
  };
}

/**
 * Credenciales globales de la app según el entorno. El Developer Portal de Procore emite un par distinto
 * para Sandbox y para Producción: el de producción no existe en login-sandbox y viceversa.
 */
export function envCredentials(env: ProcoreEnvironment): { clientId?: string; clientSecret?: string; idVar: string; secretVar: string } {
  const clean = (v: string | undefined) => v?.trim() || undefined;
  if (env === "sandbox") {
    return {
      clientId: clean(process.env.PROCORE_SANDBOX_CLIENT_ID),
      clientSecret: clean(process.env.PROCORE_SANDBOX_CLIENT_SECRET),
      idVar: "PROCORE_SANDBOX_CLIENT_ID",
      secretVar: "PROCORE_SANDBOX_CLIENT_SECRET",
    };
  }
  return { clientId: clean(process.env.PROCORE_CLIENT_ID), clientSecret: clean(process.env.PROCORE_CLIENT_SECRET), idVar: "PROCORE_CLIENT_ID", secretVar: "PROCORE_CLIENT_SECRET" };
}

export function redirectUri(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").trim().replace(/\/+$/, "");
  return `${base}/api/auth/procore/callback`;
}
