import { z } from "zod";
import { csvResponse, route } from "@/lib/api";
import { getSpec } from "@/lib/adapters/specs";
import { formatAttr } from "@/lib/adapters/spec-types";
import { toCsv } from "@/lib/paste/parse";
import { OBJECT_TYPES } from "@/lib/types";
import { buildGovernance } from "@/lib/services/governance";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATUS: Record<string, string> = { aligned: "Alineado", missing: "Falta", differs: "Difiere", conflict: "Conflicto", orphan: "Sin ID" };

export const GET = route(async (req) => {
  const type = z.enum(OBJECT_TYPES).parse(req.nextUrl.searchParams.get("type") ?? "custom_fields");
  const gov = await buildGovernance(type);
  const spec = getSpec(type);
  const header = ["ID", "Nombre", "Referencia", "Alertas", ...gov.instances.flatMap((i) => [`${i.label} · estado`, `${i.label} · nombre`, `${i.label} · diferencias`])];
  const rows = gov.rows.map((r) => [
    r.key ?? "(sin ID)",
    r.displayName,
    r.referenceAttrs ? Object.entries(r.referenceAttrs).map(([k, v]) => `${spec.attrLabels[k] ?? k}=${formatAttr(v)}`).join("; ") : "",
    r.alerts.join("; "),
    ...gov.instances.flatMap((i) => {
      const c = r.cells[i.id];
      if (!c) return [r.orphan ? "" : "Sin datos", "", ""];
      return [STATUS[c.status], c.names.join(" | "), c.diffs.map((d) => `${spec.attrLabels[d.attr] ?? d.attr}: ${formatAttr(d.current)} → ${formatAttr(d.desired)}`).join("; ")];
    }),
  ]);
  return csvResponse(toCsv([header, ...rows]), `gobierno-${type}-${new Date().toISOString().slice(0, 10)}.csv`);
});
