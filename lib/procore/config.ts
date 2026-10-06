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

export function redirectUri(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/api/auth/procore/callback`;
}
