import { z } from "zod";
import { route } from "@/lib/api";
import { validateBatch } from "@/lib/adapters/validate";
import { OBJECT_TYPES } from "@/lib/types";
import { createRun } from "@/lib/services/engine";
import { buildRemediation } from "@/lib/services/governance";
import { listInstances } from "@/lib/services/instances";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const maxRows = () => Number(process.env.MAX_ROWS_PER_BATCH ?? 500);

const fromPaste = z.object({
  source: z.literal("cargar"),
  objectType: z.enum(OBJECT_TYPES),
  rows: z.array(z.array(z.string().max(5000)).max(20)).min(1),
  instanceIds: z.array(z.string().uuid()).min(1),
  includeTexts: z.boolean().default(false),
});

const fromGovernance = z.object({
  source: z.literal("gobierno"),
  objectType: z.enum(OBJECT_TYPES),
  keys: z.array(z.string().min(1).max(200)).min(1).max(2000),
  mode: z.enum(["create_missing", "align"]),
  instanceIds: z.array(z.string().uuid()).optional(),
});

/**
 * Crea una ejecución en estado "planning". El servidor vuelve a validar/construir las filas deseadas
 * (no confía en el cliente). Después el cliente pide el dry-run por instancia en /api/plan/[runId].
 */
export const POST = route(async (req, { user }) => {
  const json = await req.json();
  const known = new Set((await listInstances()).map((i) => i.id));

  if (json?.source === "gobierno") {
    const input = fromGovernance.parse(json);
    const r = await buildRemediation(input.objectType, input.keys, input.mode, input.instanceIds);
    const instanceIds = r.instanceIds.filter((id) => known.has(id));
    if (!r.desired.length || !instanceIds.length) {
      return { runId: null, problems: r.problems.length ? r.problems : ["No hay instancias donde aplicar esta acción."] };
    }
    const run = await createRun({
      user,
      source: "gobierno",
      objectType: input.objectType,
      desired: r.desired,
      instanceIds,
      options: { includeTexts: false, onlyActions: input.mode === "create_missing" ? ["CREATE"] : ["UPDATE"] },
    });
    return { runId: run.id, instanceIds, count: r.desired.length, problems: r.problems };
  }

  const input = fromPaste.parse(json);
  if (input.rows.length > maxRows()) throw new Error(`Máximo ${maxRows()} filas por lote.`);
  const unknown = input.instanceIds.filter((id) => !known.has(id));
  if (unknown.length) throw new Error("Hay instancias destino inexistentes o dadas de baja.");
  const parsed = validateBatch(input.objectType, input.rows, {}, maxRows());
  const invalid = parsed.filter((p) => p.status === "error");
  if (invalid.length) {
    return { runId: null, problems: invalid.map((p) => `Fila ${p.index + 1}: ${p.messages[0]}`) };
  }
  const run = await createRun({
    user,
    source: "cargar",
    objectType: input.objectType,
    desired: parsed.map((p) => p.desired!),
    instanceIds: input.instanceIds,
    options: { includeTexts: input.includeTexts },
  });
  return { runId: run.id, instanceIds: input.instanceIds, count: parsed.length, problems: [] };
});
