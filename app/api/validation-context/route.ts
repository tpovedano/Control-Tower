import { route } from "@/lib/api";
import { LOV_DATA_TYPES } from "@/lib/adapters/specs/custom-fields";
import { FIELD_SET_CLASSES, classLabel, templateCell } from "@/lib/adapters/specs/field-sets";
import { OBJECT_TYPES, type ObjectType, type SelectOption } from "@/lib/types";
import { latestSnapshots } from "@/lib/services/engine";
import { listInstances } from "@/lib/services/instances";

export const dynamic = "force-dynamic";

/** IDs conocidos y opciones de los desplegables, a partir de los últimos snapshots (opcionalmente de unas instancias). */
export const GET = route(async (req) => {
  const only = req.nextUrl.searchParams.get("instanceIds")?.split(",").filter(Boolean);
  const active = new Set((await listInstances()).map((i) => i.id));
  const snaps = (await latestSnapshots({ withItems: true, okOnly: true })).filter((s) => active.has(s.instanceId) && (!only?.length || only.includes(s.instanceId)));

  const known: Partial<Record<ObjectType, string[]>> = {};
  for (const t of OBJECT_TYPES) {
    const s = snaps.filter((x) => x.objectType === t);
    if (s.length) known[t] = Array.from(new Set(s.flatMap((x) => x.items.map((i) => i.key).filter(Boolean) as string[])));
  }

  // Custom fields gobernados: valor "[ID]", etiqueta "[ID] nombre" (primer nombre encontrado).
  const cfs = new Map<string, { label: string; lov: boolean }>();
  for (const s of snaps.filter((x) => x.objectType === "custom_fields")) {
    for (const i of s.items) {
      if (!i.key || cfs.has(i.key)) continue;
      cfs.set(i.key, { label: `[${i.key}] ${i.text}`.trim(), lov: LOV_DATA_TYPES.includes(String(i.attrs.data_type)) });
    }
  }
  const byKey = (a: SelectOption, b: SelectOption) => a.value.localeCompare(b.value);
  const customFields: SelectOption[] = [...cfs].map(([k, v]) => ({ value: `[${k}]`, label: v.label })).sort(byKey);
  const lovCustomFields: SelectOption[] = [...cfs].filter(([, v]) => v.lov).map(([k, v]) => ({ value: `[${k}]`, label: v.label })).sort(byKey);

  // Clase/Herramienta: combinaciones class_name + categoría/tipo que existen; cuántas instancias las tienen.
  const templates = new Map<string, { instances: Set<string>; example: string }>();
  for (const s of snaps.filter((x) => x.objectType === "field_sets")) {
    for (const i of s.items) {
      const cls = i.attrs.class_name ? String(i.attrs.class_name) : "";
      if (!cls) continue;
      const value = templateCell(cls, i.attrs.scope ? String(i.attrs.scope) : null);
      const t = templates.get(value) ?? { instances: new Set<string>(), example: i.name };
      t.instances.add(s.instanceId);
      templates.set(value, t);
    }
  }
  const total = new Set(snaps.filter((x) => x.objectType === "field_sets").map((x) => x.instanceId)).size;
  const fieldSetTemplates: SelectOption[] = [...templates]
    .filter(([value]) => FIELD_SET_CLASSES.some((c) => value === c.value || value.startsWith(`${c.value} | `)))
    .map(([value, t]) => {
      const [cls, scope] = value.split(" | ");
      return { value, label: `${classLabel(cls)}${scope ? ` · ${scope}` : ""}  (${value})  —  en ${t.instances.size}/${total} instancia${total === 1 ? "" : "s"}, p. ej. “${t.example}”` };
    });
  // Las clases que no requieren categoría siempre se ofrecen, aunque no haya nada sincronizado.
  for (const c of FIELD_SET_CLASSES) {
    if (!c.requiresScope && !fieldSetTemplates.some((o) => o.value === c.value)) fieldSetTemplates.push({ value: c.value, label: `${c.label}  (${c.value})` });
  }
  fieldSetTemplates.sort(byKey);

  return { known, options: { customFields, lovCustomFields, fieldSetTemplates } };
});
