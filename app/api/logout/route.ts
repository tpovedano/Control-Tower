import { NextResponse } from "next/server";
import { sessionCookieOptions } from "@/lib/auth/cookies";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  // Mismos atributos (incluido Partitioned) que al crearla; si no, el navegador no la borra.
  res.cookies.set({ ...sessionCookieOptions(0), value: "" });
  return res;
}
