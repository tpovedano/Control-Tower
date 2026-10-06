import { z } from "zod";
import { route } from "@/lib/api";
import { OBJECT_TYPES } from "@/lib/types";
import { latestSnapshots, syncInstanceType } from "@/lib/services/engine";
import { getInstance } from "@/lib/services/instances";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Metadatos de la última sincronización por instancia/tipo. */
export const GET = route(async () => ({ snapshots: (await latestSnapshots({})).map(({ items: _i, ...m }) => m) }));

const body = z.object({ instanceId: z.string().uuid(), objectType: z.enum(OBJECT_TYPES) });

/** Sincroniza UN tipo de UNA instancia (llamada corta; el cliente orquesta el resto). */
export const POST = route(async (req, { user }) => {
  const { instanceId, objectType } = body.parse(await req.json());
  const inst = await getInstance(instanceId);
  return syncInstanceType(inst, objectType, user);
});
