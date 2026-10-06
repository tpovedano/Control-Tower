import { parseName } from "@/lib/ids";
import { PROCORE_ENDPOINTS as E } from "@/lib/procore/endpoints";
import { extractObject } from "@/lib/procore/client";
import { mapLimit } from "@/lib/procore/semaphore";
import { planItem } from "@/lib/diff/plan";
import type { NormalizedItem } from "@/lib/types";
import { fieldSetsSpec, type SectionSpec } from "../specs/field-sets";
import { idOf, runWrite } from "./run-apply";
import { listCustomFields } from "./custom-fields";
import { memo, str, type AdapterContext, type ApplyResult, type ServerAdapter } from "./types";

interface RawSection {
  id?: string | number;
  name?: string;
  custom_field_definition_ids?: (string | number)[];
  custom_field_definitions?: { id?: string | number }[];
  custom_field_metadata?: { custom_field_definition_id?: string | number }[];
  fields?: unknown;
}

export interface SectionInfo {
  id: string | null;
  name: string;
  remoteIds: string[];
  ids: string[];
}

/** Extrae (de forma defensiva) las secciones y los IDs numéricos de custom fields de un field set. */
export function extractSections(raw: Record<string, unknown>): { id: string | null; name: string; remoteIds: string[] }[] {
  const sectionsRaw = (raw.custom_field_sections ?? raw.sections ?? []) as RawSection[];
  const out: { id: string | null; name: string; remoteIds: string[] }[] = [];
  if (Array.isArray(sectionsRaw)) {
    for (const s of sectionsRaw) {
      const ids = new Set<string>();
      (s.custom_field_definition_ids ?? []).forEach((x) => ids.add(String(x)));
      (s.custom_field_definitions ?? []).forEach((x) => x?.id !== undefined && ids.add(String(x.id)));
      (s.custom_field_metadata ?? []).forEach((x) => x?.custom_field_definition_id !== undefined && ids.add(String(x.custom_field_definition_id)));
      if (s.fields && typeof s.fields === "object") collectCustomFieldIds(s.fields, ids);
      out.push({ id: s.id !== undefined ? String(s.id) : null, name: String(s.name ?? ""), remoteIds: [...ids] });
    }
  }
  // Algunas versiones listan los custom fields dentro de "fields" con claves "custom_field_<id>".
  if (!out.some((s) => s.remoteIds.length) && raw.fields && typeof raw.fields === "object") {
    const ids = new Set<string>();
    collectCustomFieldIds(raw.fields, ids);
    if (ids.size) out.push({ id: null, name: "", remoteIds: [...ids] });
  }
  return out;
}

function collectCustomFieldIds(fields: unknown, into: Set<string>) {
  if (Array.isArray(fields)) {
    for (const f of fields) {
      if (f && typeof f === "object") {
        const o = f as Record<string, unknown>;
        if (o.custom_field_definition_id !== undefined) into.add(String(o.custom_field_definition_id));
        else if (typeof o.name === "string") matchKey(o.name, into);
      }
    }
    return;
  }
  for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
    if (!matchKey(k, into) && v && typeof v === "object" && (v as Record<string, unknown>).custom_field_definition_id !== undefined) {
      into.add(String((v as Record<string, unknown>).custom_field_definition_id));
    }
  }
}

function matchKey(k: string, into: Set<string>): boolean {
  const m = /^custom_field_(\d+)$/.exec(k);
  if (m) into.add(m[1]);
  return !!m;
}

function normalize(raw: Record<string, unknown>, cfByRemote: Map<string, NormalizedItem> = new Map()): NormalizedItem {
  const name = String(raw.name ?? "");
  const p = parseName(name);
  const sections: SectionInfo[] = extractSections(raw).map((s) => ({
    ...s,
    ids: s.remoteIds.map((r) => cfByRemote.get(r)?.key ?? `#${r}`),
  }));
  const allIds = Array.from(new Set(sections.flatMap((s) => s.ids))).sort();
  return {
    key: p.id,
    stdId: p.id,
    name,
    text: p.text,
    remoteId: String(raw.id),
    attrs: {
      class_name: str(raw.class_name ?? raw.type ?? raw.klass),
      custom_fields: allIds,
    },
    extra: {
      sections,
      fields: raw.fields ?? null,
      company_default: raw.company_default ?? null,
      category: raw.category ?? null,
    },
  };
}

async function listRaw(ctx: AdapterContext) {
  return memo(ctx, "field_sets_raw", async () => {
    const list = await ctx.client.paginate<Record<string, unknown>>(E.fieldSets.list(ctx.companyId), { resource: "Field Sets" });
    // El detalle trae las secciones/campos completos; se pide solo para los gobernados (con [ID]) y los default.
    return mapLimit(list, 3, async (fs) => {
      const governed = !!parseName(String(fs.name ?? "")).id || fs.company_default === true;
      if (!governed || fs.custom_field_sections) return fs;
      try {
        const res = await ctx.client.get(E.fieldSets.show(ctx.companyId, String(fs.id)), { resource: "Field Sets" });
        return { ...fs, ...extractObject<Record<string, unknown>>(res.data) };
      } catch {
        return fs;
      }
    });
  });
}

async function listFieldSets(ctx: AdapterContext): Promise<NormalizedItem[]> {
  return memo(ctx, "field_sets", async () => {
    const [raw, cfs] = await Promise.all([listRaw(ctx), listCustomFields(ctx)]);
    const byRemote = new Map(cfs.map((c) => [c.remoteId, c]));
    return raw.map((r) => normalize(r, byRemote));
  });
}

/** Resuelve [ID] estándar → custom_field_definition_id local de la instancia. */
async function resolveIds(ids: string[], ctx: AdapterContext): Promise<{ map: Map<string, string>; missing: string[]; ambiguous: string[] }> {
  const cfs = await listCustomFields(ctx);
  const map = new Map<string, string>();
  const missing: string[] = [];
  const ambiguous: string[] = [];
  for (const id of ids) {
    if (id.startsWith("#")) {
      missing.push(id); // custom field no gobernado en la referencia: no se puede resolver entre instancias
      continue;
    }
    const m = cfs.filter((c) => c.key === id);
    if (m.length === 1) map.set(id, m[0].remoteId);
    else if (m.length > 1) ambiguous.push(id);
    else missing.push(id);
  }
  return { map, missing, ambiguous };
}

function desiredSections(extra: Record<string, unknown> | undefined, allIds: string[]): SectionSpec[] {
  const s = (extra?.sections as SectionSpec[] | undefined) ?? [];
  return s.length ? s : [{ name: "General", ids: allIds }];
}

/** Para UPDATE: conserva las secciones existentes (con su id), quita lo que sobra y añade lo que falta. */
export function mergeSections(existing: SectionInfo[], desiredIds: string[], explicit: SectionSpec[] | null): (SectionSpec & { id?: string | null })[] {
  if (explicit && explicit.length) {
    return explicit.map((s) => ({ ...s, id: existing.find((e) => e.name.trim().toLowerCase() === s.name.trim().toLowerCase())?.id ?? null }));
  }
  const want = new Set(desiredIds);
  const result = existing.map((s) => ({ id: s.id, name: s.name, ids: s.ids.filter((id) => want.has(id)) }));
  const present = new Set(result.flatMap((s) => s.ids));
  const missing = desiredIds.filter((id) => !present.has(id));
  if (missing.length) {
    if (result.length) result[0].ids.push(...missing);
    else result.push({ id: null, name: "General", ids: missing });
  }
  return result;
}

export const fieldSetsAdapter: ServerAdapter = {
  spec: fieldSetsSpec,
  normalize,
  list: listFieldSets,
  async dependencies(desired, ctx) {
    const ids = (desired.attrs.custom_fields as string[]) ?? [];
    const { missing, ambiguous } = await resolveIds(ids, ctx);
    if (ambiguous.length) return { missing, message: `Conflicto: custom fields con ID repetido en esta instancia: ${ambiguous.join(", ")}.` };
    return { missing };
  },
  async plan(desired, existing, ctx, options) {
    const deps = await this.dependencies!(desired, ctx);
    return planItem(fieldSetsSpec, desired, existing, options, deps);
  },
  async apply(inputs, ctx, options) {
    const results: ApplyResult[] = [];
    const raws = await listRaw(ctx);
    for (const { desired, plan, current } of inputs) {
      const ids = (desired.attrs.custom_fields as string[]) ?? [];
      const { map, missing } = await resolveIds(ids, ctx);
      if (missing.length) {
        results.push({ ok: false, message: `Bloqueado por dependencia: faltan ${missing.join(", ")}`, request: null, response: null });
        continue;
      }
      const toSection = (s: SectionSpec & { id?: string | null }) => ({
        ...(s.id ? { id: s.id } : {}),
        name: s.name,
        custom_field_definition_ids: s.ids.filter((id) => map.has(id)).map((id) => Number(map.get(id))),
      });
      if (plan.action === "CREATE") {
        // "fields" es obligatorio: se usa la configuración de la referencia si viene, si no la del field set
        // por defecto de la misma clase en la instancia destino.
        let fields = desired.extra?.fields ?? null;
        let note = "";
        if (!fields) {
          const sameClass = raws.filter((r) => String(r.class_name ?? r.type ?? "") === String(desired.attrs.class_name));
          const def = sameClass.find((r) => r.company_default === true) ?? sameClass[0];
          fields = def?.fields ?? {};
          if (!def) note = " (sin field set por defecto de esa clase: se envió fields vacío)";
        }
        const body = {
          configurable_field_set: { name: desired.name, class_name: desired.attrs.class_name, fields },
          custom_field_sections: desiredSections(desired.extra, ids).map(toSection),
        };
        const r = await runWrite(body, () => ctx.client.post(E.fieldSets.create(ctx.companyId), body, { resource: "Field Sets" }), idOf, `Creado${note}`);
        results.push(r);
      } else {
        const existingSections = (current?.extra?.sections as SectionInfo[]) ?? [];
        const currentRaw = raws.find((r) => String(r.id) === plan.remoteId);
        const explicit = (desired.extra?.sectionsExplicit ? (desired.extra?.sections as SectionSpec[]) : null) ?? null;
        const sections = mergeSections(existingSections, ids, explicit);
        const body = {
          configurable_field_set: {
            name: options.includeTexts ? desired.name : current?.name ?? desired.name,
            fields: currentRaw?.fields ?? current?.extra?.fields ?? {},
          },
          custom_field_sections: sections.map(toSection),
        };
        results.push(
          await runWrite(body, () => ctx.client.patch(E.fieldSets.update(ctx.companyId, plan.remoteId!), body, { resource: "Field Sets" }), idOf, "Actualizado"),
        );
      }
    }
    return results;
  },
  toDesired(item) {
    const sections = ((item.extra?.sections as SectionInfo[]) ?? []).map((s) => ({ name: s.name || "General", ids: s.ids }));
    return {
      key: item.key!,
      stdId: item.stdId!,
      name: item.name,
      attrs: { class_name: item.attrs.class_name ?? null, custom_fields: (item.attrs.custom_fields as string[]) ?? [] },
      extra: { sections, sectionsExplicit: true, fields: item.extra?.fields ?? null },
    };
  },
};
