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

/**
 * URL pública de la app. Se lee en tiempo de ejecución (acceso dinámico a process.env) para que un cambio
 * de dominio en Vercel no quede "congelado" en el build. APP_URL tiene prioridad sobre NEXT_PUBLIC_APP_URL.
 */
export function appUrl(): string | null {
  const env = process.env as Record<string, string | undefined>;
  const raw = (env["APP_URL"] || env["NEXT_PUBLIC_APP_URL"] || "").trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

export function redirectUri(): string {
  return `${appUrl() ?? "http://localhost:3000"}/api/auth/procore/callback`;
}
