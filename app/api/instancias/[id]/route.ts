import { route } from "@/lib/api";
import { audit } from "@/lib/services/audit";
import { getInstance, instanceInputSchema, softDeleteInstance, toPublic, updateInstance } from "@/lib/services/instances";

export const dynamic = "force-dynamic";

export const PATCH = route<{ id: string }>(async (req, { user, params }) => {
  const input = instanceInputSchema.parse(await req.json());
  const row = await updateInstance(params.id, input);
  await audit({ user, instanceId: row.id, instanceLabel: row.label, companyId: row.companyId, action: "INSTANCE_UPDATE", result: "info", requestPayload: { ...input, clientSecret: undefined } });
  return { instance: toPublic(row) };
});

/** Baja lógica (no borra datos en Procore). */
export const DELETE = route<{ id: string }>(async (_req, { user, params }) => {
  const row = await getInstance(params.id);
  await softDeleteInstance(params.id);
  await audit({ user, instanceId: row.id, instanceLabel: row.label, companyId: row.companyId, action: "INSTANCE_DISABLE", result: "info" });
  return { ok: true };
});
