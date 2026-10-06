import type { ObjectType, ParsedRow } from "@/lib/types";
import { getSpec } from "./specs";
import type { ValidationContext } from "./spec-types";

/** Convierte filas de celdas (en el orden de columnas del tipo) en filas validadas, incluyendo duplicados del lote. */
export function validateBatch(type: ObjectType, rows: string[][], ctx: ValidationContext = {}, maxRows = 500): ParsedRow[] {
  const spec = getSpec(type);
  const results: ParsedRow[] = rows.map((cells, index) => {
    const record: Record<string, string> = {};
    spec.columns.forEach((c, i) => (record[c.id] = cells[i] ?? ""));
    const r = spec.parseRow(record, ctx);
    const messages = [...r.errors, ...r.warnings];
    return {
      index,
      status: r.errors.length ? "error" : r.warnings.length ? "warning" : "valid",
      messages,
      desired: r.errors.length ? undefined : r.desired,
    };
  });

  // IDs duplicados dentro del lote → error en todas las filas implicadas.
  const byKey = new Map<string, number[]>();
  results.forEach((r) => {
    if (r.desired) byKey.set(r.desired.key, [...(byKey.get(r.desired.key) ?? []), r.index]);
  });
  for (const [key, idxs] of byKey) {
    if (idxs.length < 2) continue;
    for (const i of idxs) {
      const r = results[i];
      r.status = "error";
      r.messages.unshift(`ID duplicado en el lote: [${key}] aparece en las filas ${idxs.map((x) => x + 1).join(", ")}.`);
      r.desired = undefined;
    }
  }

  if (rows.length > maxRows) {
    for (const r of results.slice(maxRows)) {
      r.status = "error";
      r.messages.unshift(`Se supera el máximo de ${maxRows} filas por lote.`);
      r.desired = undefined;
    }
  }
  return results;
}
