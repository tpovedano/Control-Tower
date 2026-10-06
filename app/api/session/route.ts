import { route } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Comprueba que la cookie de sesión llegó (útil dentro del iframe de Procore). */
export const GET = route(async (_req, { user }) => ({ user }));
