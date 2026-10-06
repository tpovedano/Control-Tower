import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken, type SessionPayload } from "./session";

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

/** Para Route Handlers: devuelve el usuario o una respuesta 401. */
export async function requireUser(): Promise<{ user: string } | NextResponse> {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  return { user: s.user };
}
