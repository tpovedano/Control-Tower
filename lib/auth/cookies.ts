import { SESSION_COOKIE, SESSION_TTL_SECONDS } from "./session";

/**
 * Atributos de la cookie de sesión.
 * En producción la app se puede mostrar incrustada (iframe) en Procore: eso exige SameSite=None; Secure,
 * y Partitioned (CHIPS) para que Chrome/Edge/Firefox la acepten como cookie de terceros particionada.
 */
export function sessionCookieOptions(maxAge = SESSION_TTL_SECONDS) {
  const embedded = process.env.NODE_ENV === "production";
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    secure: embedded,
    sameSite: embedded ? ("none" as const) : ("lax" as const),
    partitioned: embedded,
    path: "/",
    maxAge,
  };
}
