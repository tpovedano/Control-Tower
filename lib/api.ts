import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { getSession } from "@/lib/auth/server";
import { ProcoreError } from "@/lib/procore/errors";

type Handler<P> = (req: NextRequest, ctx: { user: string; params: P }) => Promise<Response | unknown>;

/** Envoltorio para Route Handlers: exige sesión, captura errores y nunca filtra secretos. */
export function route<P = Record<string, string>>(fn: Handler<P>) {
  return async (req: NextRequest, ctx: { params: Promise<P> }) => {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    try {
      const params = ctx?.params ? await ctx.params : ({} as P);
      const out = await fn(req, { user: session.user, params });
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true });
    } catch (e) {
      if (e instanceof ZodError) {
        return NextResponse.json({ error: "Datos inválidos", issues: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
      }
      if (e instanceof ProcoreError) {
        const status = e.code === "not_found" ? 404 : e.code === "config" ? 500 : 502;
        return NextResponse.json({ error: e.message, code: e.code, procoreStatus: e.status, procoreMessage: e.procoreMessage }, { status });
      }
      const message = e instanceof Error ? e.message : "Error inesperado";
      console.error("[api]", req.nextUrl.pathname, message);
      return NextResponse.json({ error: message }, { status: 400 });
    }
  };
}

export function csvResponse(csv: string, filename: string) {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
