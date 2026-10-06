import { route } from "@/lib/api";
import { audit } from "@/lib/services/audit";
import { createInstance, instanceInputSchema, listInstances, toPublic } from "@/lib/services/instances";

export const dynamic = "force-dynamic";

export const GET = route(async () => ({ instances: (await listInstances()).map(toPublic) }));

export const POST = route(async (req, { user }) => {
  const input = instanceInputSchema.parse(await req.json());
  const row = await createInstance(input);
  await audit({ user, instanceId: row.id, instanceLabel: row.label, companyId: row.companyId, action: "INSTANCE_CREATE", result: "info", requestPayload: { ...input, clientSecret: undefined } });
  return { instance: toPublic(row) };
});
