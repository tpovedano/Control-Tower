import { z } from "zod";
import { route } from "@/lib/api";
import { executeItems, finishRunIfDone } from "@/lib/services/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const body = z.object({
  runId: z.string().uuid(),
  instanceId: z.string().uuid(),
  itemIds: z.array(z.string().uuid()).min(1).max(100),
});

/** Ejecuta una tanda corta (≤100 elementos de una instancia) de una ejecución ya confirmada. */
export const POST = route(async (req, { user }) => {
  const { runId, instanceId, itemIds } = body.parse(await req.json());
  const items = await executeItems(runId, instanceId, itemIds, user);
  await finishRunIfDone(runId);
  return { items };
});
