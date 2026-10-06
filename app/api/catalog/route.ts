import { eq } from "drizzle-orm";
import { z } from "zod";
import { route } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { OBJECT_TYPES } from "@/lib/types";
import { audit } from "@/lib/services/audit";
import { latestSnapshots } from "@/lib/services/engine";
import { getInstance } from "@/lib/services/instances";

export const dynamic = "force-dynamic";

const body = z.object({ instanceId: z.string().uuid(), objectType: z.enum(OBJECT_TYPES) });

/** Guarda el catálogo maestro de un tipo a partir del último snapshot de una instancia (reemplaza el anterior). */
export const POST = route(async (req, { user }) => {
  const { instanceId, objectType } = body.parse(await req.json());
  const inst = await getInstance(instanceId);
  const [snap] = await latestSnapshots({ objectType, withItems: true, okOnly: true }).then((s) => s.filter((x) => x.instanceId === instanceId));
  if (!snap) throw new Error("La instancia no tiene una sincronización válida de este tipo. Sincroniza primero.");
  const counts = new Map<string, number>();
  snap.items.forEach((i) => i.key && counts.set(i.key, (counts.get(i.key) ?? 0) + 1));
  const items = snap.items.filter((i) => i.key && counts.get(i.key) === 1);
  await db().delete(schema.catalogItems).where(eq(schema.catalogItems.objectType, objectType));
  for (let i = 0; i < items.length; i += 200) {
    await db()
      .insert(schema.catalogItems)
      .values(items.slice(i, i + 200).map((it) => ({ objectType, key: it.key!, item: it, sourceInstanceId: instanceId, updatedBy: user })));
  }
  await audit({ user, instanceId, instanceLabel: inst.label, companyId: inst.companyId, objectType, action: "CATALOG_SET", result: "info", message: `${items.length} elementos` });
  return { ok: true, count: items.length };
});

/** Vacía el catálogo de un tipo (solo datos de la app; nunca toca Procore). */
export const DELETE = route(async (req, { user }) => {
  const objectType = z.enum(OBJECT_TYPES).parse(req.nextUrl.searchParams.get("type"));
  await db().delete(schema.catalogItems).where(eq(schema.catalogItems.objectType, objectType));
  await audit({ user, objectType, action: "CATALOG_CLEAR", result: "info" });
  return { ok: true };
});
