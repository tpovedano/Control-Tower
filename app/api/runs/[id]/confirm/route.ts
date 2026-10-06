import { z } from "zod";
import { route } from "@/lib/api";
import { confirmRun, runItemsFor } from "@/lib/services/engine";

export const dynamic = "force-dynamic";

const body = z.object({ confirm: z.literal(true), expectedWrites: z.number().int().min(0) });

/** Confirmación explícita: el número de escrituras debe coincidir con el del dry-run mostrado al usuario. */
export const POST = route<{ id: string }>(async (req, { user, params }) => {
  const { expectedWrites } = body.parse(await req.json());
  const items = await runItemsFor(params.id);
  const writes = items.filter((i) => i.status === "pending").length;
  if (writes !== expectedWrites) throw new Error(`El plan cambió (${writes} escrituras pendientes, se esperaban ${expectedWrites}). Repite el dry-run.`);
  const run = await confirmRun(params.id, user);
  return { run };
});
