import { route } from "@/lib/api";
import { LOV_DATA_TYPES } from "@/lib/adapters/specs/custom-fields";
import { FIELD_SET_CLASSES, OBSERVATION_CATEGORIES, normalizeClassName, templateCell } from "@/lib/adapters/specs/field-sets";
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
      cfs.set(i.key, { label: `${i.text} [${i.key}]`.trim(), lov: LOV_DATA_TYPES.includes(String(i.attrs.data_type)) });
    }
  }
  const byKey = (a: SelectOption, b: SelectOption) => a.value.localeCompare(b.value);
  const customFields: SelectOption[] = [...cfs].map(([k, v]) => ({ value: `[${k}]`, label: v.label })).sort(byKey);
  const lovCustomFields: SelectOption[] = [...cfs].filter(([, v]) => v.lov).map(([k, v]) => ({ value: `[${k}]`, label: v.label })).sort(byKey);

  // Clase/Herramienta: opciones fijas del contrato de Procore (Observaciones × categoría, Punch List, RFI),
  // indicando en cuántas instancias hay un field set de esa herramienta del que copiar la configuración de campos.
  const fsSnaps = snaps.filter((x) => x.objectType === "field_sets");
  const withClass = (cls: string) => fsSnaps.filter((s) => s.items.some((i) => normalizeClassName(String(i.attrs.class_name ?? "")) === cls)).length;
  const avail = (cls: string) => (fsSnaps.length ? `  —  plantilla en ${withClass(cls)}/${fsSnaps.length} instancia${fsSnaps.length === 1 ? "" : "s"}` : "");
  const fieldSetTemplates: SelectOption[] = [];
  for (const c of FIELD_SET_CLASSES) {
    if (c.value === "Observations::Item") {
      for (const cat of OBSERVATION_CATEGORIES) {
        fieldSetTemplates.push({ value: templateCell(c.value, cat.value), label: `${c.label} · ${cat.label}  (${c.value} | ${cat.value})${avail(c.value)}` });
      }
    } else {
      fieldSetTemplates.push({ value: c.value, label: `${c.label}  (${c.value})${avail(c.value)}` });
    }
  }

  return { known, options: { customFields, lovCustomFields, fieldSetTemplates } };
});
