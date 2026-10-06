import { and, desc, eq, gte, ilike, lte, or, type SQL } from "drizzle-orm";
import { csvResponse, route } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { toCsv } from "@/lib/paste/parse";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const p = req.nextUrl.searchParams;
  const conds: SQL[] = [];
  const t = schema.auditLog;
  if (p.get("instanceId")) conds.push(eq(t.instanceId, p.get("instanceId")!));
  if (p.get("objectType")) conds.push(eq(t.objectType, p.get("objectType")!));
  if (p.get("result")) conds.push(eq(t.result, p.get("result")!));
  if (p.get("action")) conds.push(eq(t.action, p.get("action")!));
  if (p.get("from")) conds.push(gte(t.at, new Date(p.get("from")!)));
  if (p.get("to")) conds.push(lte(t.at, new Date(p.get("to")! + "T23:59:59")));
  const q = p.get("q")?.trim();
  if (q) conds.push(or(ilike(t.key, `%${q}%`), ilike(t.user, `%${q}%`), ilike(t.message, `%${q}%`), ilike(t.instanceLabel, `%${q}%`))!);
  const format = p.get("format");
  const limit = format === "csv" ? 10000 : Math.min(Number(p.get("limit") ?? 200), 1000);
  const rows = await db()
    .select()
    .from(t)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(t.at))
    .limit(limit);

  if (format === "csv") {
    return csvResponse(
      toCsv([
        ["Fecha", "Usuario", "Instancia", "Company ID", "Tipo", "ID", "Acción", "Resultado", "HTTP", "Mensaje", "Payload enviado", "Respuesta Procore", "Ejecución"],
        ...rows.map((r) => [
          r.at.toISOString(),
          r.user,
          r.instanceLabel,
          r.companyId,
          r.objectType,
          r.key,
          r.action,
          r.result,
          r.httpStatus,
          r.message,
          r.requestPayload ? JSON.stringify(r.requestPayload) : "",
          r.responseBody ? JSON.stringify(r.responseBody) : "",
          r.runId,
        ]),
      ]),
      `historial-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  }
  return { entries: rows };
});
