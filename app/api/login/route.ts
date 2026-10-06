import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSessionToken, safeEqual, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/session";

const schema = z.object({ user: z.string().trim().max(200).optional(), password: z.string().min(1).max(500) });

export async function POST(req: NextRequest) {
  const expected = process.env.APP_ACCESS_PASSWORD;
  if (!expected) return NextResponse.json({ error: "APP_ACCESS_PASSWORD no está configurada: el acceso está bloqueado." }, { status: 503 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  const allowed = (process.env.APP_ALLOWED_USERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const user = (parsed.data.user ?? "").toLowerCase();
  const passOk = await safeEqual(parsed.data.password, expected);
  const userOk = allowed.length ? allowed.includes(user) : true;
  if (!passOk || !userOk) {
    await new Promise((r) => setTimeout(r, 500)); // frena fuerza bruta
    return NextResponse.json({ error: "Credenciales incorrectas" }, { status: 401 });
  }
  const token = await createSessionToken(user || "admin");
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}
