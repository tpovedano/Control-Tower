import { z } from "zod";
import { route } from "@/lib/api";
import { getRun, planRunInstance } from "@/lib/services/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const body = z.object({ instanceId: z.string().uuid() });

/** Dry-run de una instancia: lee su estado actual y calcula CREAR/ACTUALIZAR/SIN CAMBIOS/OMITIR. No escribe en Procore. */
export const POST = route<{ runId: string }>(async (req, { params }) => {
  const { instanceId } = body.parse(await req.json());
  const run = await getRun(params.runId);
  const items = await planRunInstance(run, instanceId);
  return { items };
});
