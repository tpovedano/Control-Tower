import { route } from "@/lib/api";
import { OBJECT_TYPES, type ObjectType } from "@/lib/types";
import { latestSnapshots } from "@/lib/services/engine";

export const dynamic = "force-dynamic";

/** IDs conocidos (de los últimos snapshots) para validar dependencias en vivo. */
export const GET = route(async () => {
  const snaps = await latestSnapshots({ withItems: true, okOnly: true });
  const known: Partial<Record<ObjectType, string[]>> = {};
  for (const t of OBJECT_TYPES) {
    const s = snaps.filter((x) => x.objectType === t);
    if (s.length) known[t] = Array.from(new Set(s.flatMap((x) => x.items.map((i) => i.key).filter(Boolean) as string[])));
  }
  const fieldSetClasses = Array.from(
    new Set(snaps.filter((s) => s.objectType === "field_sets").flatMap((s) => s.items.map((i) => String(i.attrs.class_name ?? "")).filter(Boolean))),
  ).sort();
  return { known, fieldSetClasses };
});
