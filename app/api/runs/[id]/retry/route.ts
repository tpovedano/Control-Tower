import { z } from "zod";
import { route } from "@/lib/api";
import { resetFailed, runItemsFor } from "@/lib/services/engine";

export const dynamic = "force-dynamic";

const body = z.object({ instanceId: z.string().uuid().optional() });

/** "Reintentar solo los fallidos": deja como pendientes los elementos con error. */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const { instanceId } = body.parse(await req.json().catch(() => ({})));
  const count = await resetFailed(params.id, instanceId);
  return { count, items: await runItemsFor(params.id) };
});
