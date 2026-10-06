import "server-only";
import { db, schema } from "@/lib/db";

export interface AuditEntry {
  user: string;
  instanceId?: string | null;
  instanceLabel?: string | null;
  companyId?: string | null;
  objectType?: string | null;
  key?: string | null;
  action: string;
  result: "success" | "error" | "info";
  httpStatus?: number | null;
  message?: string | null;
  requestPayload?: unknown;
  responseBody?: unknown;
  runId?: string | null;
}

const SECRET_KEYS = /token|secret|password|authorization|client_id|refresh/i;

/** Elimina cualquier clave sospechosa de contener secretos antes de persistir. */
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.slice(0, 500).map((v) => scrub(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? "[redactado]" : scrub(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 5000) return value.slice(0, 5000) + "…";
  return value;
}

export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await db()
      .insert(schema.auditLog)
      .values({
        ...entry,
        requestPayload: scrub(entry.requestPayload ?? null),
        responseBody: scrub(entry.responseBody ?? null),
      });
  } catch (e) {
    // El audit nunca debe tumbar la operación, pero sí dejar rastro (sin datos sensibles).
    console.error("[audit] no se pudo registrar:", e instanceof Error ? e.message : "error");
  }
}
