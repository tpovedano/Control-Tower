import { parseName } from "@/lib/ids";
import { PROCORE_ENDPOINTS as E } from "@/lib/procore/endpoints";
import { extractObject } from "@/lib/procore/client";
import { mapLimit } from "@/lib/procore/semaphore";
import { planItem } from "@/lib/diff/plan";
import type { NormalizedItem } from "@/lib/types";
import { fieldSetsSpec, normalizeClassName, normalizeObservationCategory, type SectionSpec } from "../specs/field-sets";
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

/** Claves de ámbito que Procore exige según la herramienta (se copian de la plantilla al crear). */
const SCOPE_KEYS = ["observations_category_id", "inspection_type_id", "incident_type_id", "generic_tool_id", "action_plan_type_id", "category", "schema_id"] as const;

export interface FieldSetScope {
  kind: string;
  id: string | null;
  name: string | null;
}

/** Ámbito del field set dentro de su herramienta (categoría de observación, tipo de inspección…). */
export function extractScope(raw: Record<string, unknown>): FieldSetScope | null {
  const obj = (k: string) => (raw[k] && typeof raw[k] === "object" ? (raw[k] as Record<string, unknown>) : null);
  const nameOf = (o: Record<string, unknown> | null) => (o ? str(o.name ?? o.title ?? o.label) : null);
  const pairs: [string, string, string[]][] = [
    ["observations_category", "observations_category_id", ["observations_category", "observation_category"]],
    ["inspection_type", "inspection_type_id", ["inspection_type"]],
    ["incident_type", "incident_type_id", ["incident_type"]],
    ["generic_tool", "generic_tool_id", ["generic_tool"]],
    ["action_plan_type", "action_plan_type_id", ["action_plan_type"]],
  ];
  for (const [kind, idKey, objKeys] of pairs) {
    const o = objKeys.map(obj).find(Boolean) ?? null;
    const id = str(raw[idKey] ?? o?.id);
    const name = nameOf(o);
    if (id || name) return { kind, id, name };
  }
  const category = str(typeof raw.category === "string" ? raw.category : nameOf(obj("category")));
  return category ? { kind: "category", id: null, name: category } : null;
}

/** Texto con el que se identifica el ámbito entre instancias (el nombre; si no hay, el id local). */
export function scopeLabel(scope: FieldSetScope | null): string | null {
  return scope ? scope.name ?? (scope.id ? `#${scope.id}` : null) : null;
}

/** Valor del desplegable "Clase/Herramienta": "class_name" o "class_name | ámbito". */
export function templateValue(className: string | null, scope: string | null): string {
  return scope ? `${className ?? ""} | ${scope}` : className ?? "";
}

function normalize(raw: Record<string, unknown>, cfByRemote: Map<string, NormalizedItem> = new Map()): NormalizedItem {
  const name = String(raw.name ?? "");
  const p = parseName(name);
  const sections: SectionInfo[] = extractSections(raw).map((s) => ({
    ...s,
    ids: s.remoteIds.map((r) => cfByRemote.get(r)?.key ?? `#${r}`),
  }));
  const allIds = Array.from(new Set(sections.flatMap((s) => s.ids))).sort();
  const scope = extractScope(raw);
  const className = normalizeClassName(str(raw.class_name ?? raw.type ?? raw.klass)) || null;
  // En Observaciones el ámbito es la categoría ("quality", "safety"…), que Procore guarda en `category`.
  const obsCategory = className === "Observations::Item" ? normalizeObservationCategory(typeof raw.category === "string" ? raw.category : null) : null;
  return {
    key: p.id,
    stdId: p.id,
    name,
    text: p.text,
    remoteId: String(raw.id),
    attrs: {
      class_name: className,
      scope: obsCategory ?? scopeLabel(scope),
      custom_fields: allIds,
    },
    extra: {
      sections,
      fields: raw.fields ?? null,
      company_default: raw.company_default ?? null,
      scopeInfo: scope,
    },
  };
}

async function listRaw(ctx: AdapterContext) {
  return memo(ctx, "field_sets_raw", async () => {
    const list = await ctx.client.paginate<Record<string, unknown>>(E.fieldSets.list(ctx.companyId), { resource: "Field Sets" });
    // El listado no trae "fields" ni las secciones (y a veces ni la clase): se pide el detalle de cada uno.
    return mapLimit(list, 3, async (fs) => {
      if (fs.custom_field_sections && fs.fields && fs.class_name) return fs;
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

/**
 * Plantilla en la instancia destino: un field set de la misma herramienta (class_name), del que se copia la
 * configuración de campos. Se prefiere el de la misma categoría/tipo y el company default.
 */
async function findTemplate(className: string, scope: string | null, ctx: AdapterContext): Promise<{ template: NormalizedItem; sameScope: boolean } | null> {
  const all = await listFieldSets(ctx);
  const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
  const cls = normalizeClassName(className);
  const sameClass = all.filter((f) => f.attrs.class_name === cls);
  if (!sameClass.length) return null;
  const sameScope = scope ? sameClass.filter((f) => norm(f.attrs.scope) === norm(scope)) : [];
  const pick = (list: NormalizedItem[]) => list.find((c) => c.extra?.company_default === true) ?? list.find((c) => !c.key) ?? list[0];
  return sameScope.length ? { template: pick(sameScope), sameScope: true } : { template: pick(sameClass), sameScope: false };
}

async function templateRaw(template: NormalizedItem, ctx: AdapterContext): Promise<Record<string, unknown>> {
  const raws = await listRaw(ctx);
  const listed = raws.find((r) => String(r.id) === template.remoteId) ?? {};
  if (listed.fields && Object.keys(listed.fields as object).length) return listed;
  const res = await ctx.client.get(E.fieldSets.show(ctx.companyId, template.remoteId), { resource: "Field Sets" });
  return { ...listed, ...extractObject<Record<string, unknown>>(res.data) };
}

function hasFields(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length > 0;
}

function templateMissingMessage(className: string) {
  return `No hay ningún field set de “${className}” (ni en esta instancia ni en las sincronizadas) del que copiar la configuración de campos que exige Procore. Crea uno de esa herramienta en Procore (basta el predeterminado), sincroniza en Gobierno y vuelve a intentarlo.`;
}

/** Configuración de campos para crear: de la plantilla local o, si no hay, de otra instancia sincronizada. */
async function resolveFields(className: string, scope: string | null, ctx: AdapterContext) {
  const local = await findTemplate(className, scope, ctx);
  if (local) {
    const raw = await templateRaw(local.template, ctx);
    if (hasFields(raw.fields)) return { fields: raw.fields, raw, sameScope: local.sameScope, source: `plantilla “${local.template.name}”` };
  }
  const remote = ctx.fieldSetFieldsFallback ? await ctx.fieldSetFieldsFallback(normalizeClassName(className)) : null;
  if (hasFields(remote)) return { fields: remote, raw: null, sameScope: false, source: "otra instancia sincronizada" };
  return null;
}

export const fieldSetsAdapter: ServerAdapter = {
  spec: fieldSetsSpec,
  normalize,
  list: listFieldSets,
  async dependencies(desired, ctx) {
    const ids = (desired.attrs.custom_fields as string[]) ?? [];
    const { missing, ambiguous } = await resolveIds(ids, ctx);
    if (ambiguous.length) return { missing, message: `Conflicto: custom fields con ID repetido en esta instancia: ${ambiguous.join(", ")}.` };
    if (missing.length) return { missing };
    const exists = (await listFieldSets(ctx)).some((f) => f.key === desired.key);
    if (!exists) {
      const cls = String(desired.attrs.class_name);
      const local = await findTemplate(cls, (desired.attrs.scope as string) ?? null, ctx);
      const remote = !local && ctx.fieldSetFieldsFallback ? await ctx.fieldSetFieldsFallback(normalizeClassName(cls)) : null;
      if (!local && !hasFields(remote)) return { missing: [], message: templateMissingMessage(cls) };
    }
    return { missing: [] };
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
        const className = normalizeClassName(String(desired.attrs.class_name));
        const scope = (desired.attrs.scope as string) ?? null;
        let resolved;
        try {
          resolved = await resolveFields(className, scope, ctx);
        } catch (e) {
          results.push({ ok: false, message: `No se pudo leer la plantilla: ${(e as Error).message}`, request: null, response: null });
          continue;
        }
        if (!resolved) {
          results.push({ ok: false, message: templateMissingMessage(className), request: null, response: null });
          continue;
        }
        // Cuerpo según el contrato de POST /rest/v2.1/companies/{id}/configurable_field_sets.
        const set: Record<string, unknown> = { name: desired.name, class_name: className, fields: resolved.fields };
        if (className === "Observations::Item" && scope) set.category = scope;
        const tmpl = resolved.raw;
        if (tmpl) {
          // El ámbito local (ids de categoría/tipo) solo se copia si la plantilla es de la misma categoría/tipo.
          if (resolved.sameScope) {
            for (const k of SCOPE_KEYS) if (k !== "schema_id" && k !== "category" && tmpl[k] !== null && tmpl[k] !== undefined && tmpl[k] !== "") set[k] = tmpl[k];
          }
          if (tmpl.schema_id !== null && tmpl.schema_id !== undefined && tmpl.schema_id !== "") set.schema_id = tmpl.schema_id;
          if (className !== "Observations::Item" && resolved.sameScope && typeof tmpl.category === "string") set.category = tmpl.category;
        }
        const body = { configurable_field_set: set, custom_field_sections: desiredSections(desired.extra, ids).map(toSection) };
        results.push(await runWrite(body, () => ctx.client.post(E.fieldSets.create(ctx.companyId), body, { resource: "Field Sets" }), idOf, `Creado (campos de ${resolved.source})`));
      } else {
        const existingSections = (current?.extra?.sections as SectionInfo[]) ?? [];
        let currentRaw = raws.find((r) => String(r.id) === plan.remoteId);
        if (!currentRaw?.fields && plan.remoteId) {
          try {
            const res = await ctx.client.get(E.fieldSets.show(ctx.companyId, plan.remoteId), { resource: "Field Sets" });
            currentRaw = { ...currentRaw, ...extractObject<Record<string, unknown>>(res.data) };
          } catch {
            /* se intenta con lo que hay */
          }
        }
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
      attrs: {
        class_name: item.attrs.class_name ?? null,
        scope: item.attrs.scope ?? null,
        custom_fields: (item.attrs.custom_fields as string[]) ?? [],
      },
      extra: { sections, sectionsExplicit: true },
    };
  },
};
