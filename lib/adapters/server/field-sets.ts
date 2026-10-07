import { parseName } from "@/lib/ids";
import { PROCORE_ENDPOINTS as E } from "@/lib/procore/endpoints";
import { extractList, extractObject } from "@/lib/procore/client";
import { mapLimit } from "@/lib/procore/semaphore";
import { planItem } from "@/lib/diff/plan";
import type { NormalizedItem } from "@/lib/types";
import { FIELD_SET_CLASSES, fieldSetsSpec, normalizeClassName, normalizeObservationCategory, type SectionSpec } from "../specs/field-sets";
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
/** Entrada de custom field dentro de "fields" (formato v2.1: clave "custom_field_<n>" con custom_field_definition_id). */
export function isCustomFieldEntry(key: string, value: unknown): boolean {
  return /^custom_field_/.test(key) || (!!value && typeof value === "object" && (value as Record<string, unknown>).custom_field_definition_id !== undefined);
}

/**
 * Secciones y custom fields (IDs locales de custom_field_definition) de un field set.
 * Formato v2.1 (detalle): los custom fields están en "fields" como "custom_field_<n>": { custom_field_definition_id,
 * custom_fields_section_id, … } y las secciones en "sections" (sin lista de custom fields). OJO: el <n> de la clave
 * NO es el ID del custom field; se usa custom_field_definition_id. También se aceptan formatos con la lista de IDs
 * dentro de cada sección.
 */
export function extractSections(raw: Record<string, unknown>): { id: string | null; name: string; remoteIds: string[] }[] {
  const sectionsRaw = (raw.custom_field_sections ?? raw.sections ?? []) as RawSection[];
  const out: { id: string | null; name: string; remoteIds: string[] }[] = [];
  const byId = new Map<string, { id: string | null; name: string; remoteIds: string[] }>();
  if (Array.isArray(sectionsRaw)) {
    for (const s of sectionsRaw) {
      const ids = new Set<string>();
      (s.custom_field_definition_ids ?? []).forEach((x) => ids.add(String(x)));
      (s.custom_field_definitions ?? []).forEach((x) => x?.id !== undefined && ids.add(String(x.id)));
      (s.custom_field_metadata ?? []).forEach((x) => x?.custom_field_definition_id !== undefined && ids.add(String(x.custom_field_definition_id)));
      if (s.fields && typeof s.fields === "object") collectCustomFieldIds(s.fields, ids);
      const sec = { id: s.id !== undefined && s.id !== null ? String(s.id) : null, name: String(s.name ?? ""), remoteIds: [...ids] };
      out.push(sec);
      if (sec.id) byId.set(sec.id, sec);
    }
  }
  // Custom fields dentro de "fields": se reparten en su sección por custom_fields_section_id.
  if (raw.fields && typeof raw.fields === "object" && !Array.isArray(raw.fields)) {
    const entries = Object.entries(raw.fields as Record<string, unknown>)
      .filter(([k, v]) => isCustomFieldEntry(k, v))
      .map(([k, v]) => ({ key: k, v: (v && typeof v === "object" ? v : {}) as Record<string, unknown> }))
      .sort((a, b) => Number(a.v.position ?? 0) - Number(b.v.position ?? 0));
    for (const { key, v } of entries) {
      const defId = v.custom_field_definition_id !== undefined && v.custom_field_definition_id !== null ? String(v.custom_field_definition_id) : /^custom_field_(\d+)$/.exec(key)?.[1];
      if (!defId) continue;
      const secId = v.custom_fields_section_id !== undefined && v.custom_fields_section_id !== null ? String(v.custom_fields_section_id) : null;
      let sec = secId ? byId.get(secId) : out.find((x) => x.id === null);
      if (!sec) {
        sec = { id: secId, name: "", remoteIds: [] };
        out.push(sec);
        if (secId) byId.set(secId, sec);
      }
      if (!sec.remoteIds.includes(defId)) sec.remoteIds.push(defId);
    }
  } else if (Array.isArray(raw.fields)) {
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
    // Primero el ID real (custom_field_definition_id); el número de la clave solo como último recurso.
    if (v && typeof v === "object" && (v as Record<string, unknown>).custom_field_definition_id !== undefined) {
      into.add(String((v as Record<string, unknown>).custom_field_definition_id));
    } else {
      matchKey(k, into);
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

/**
 * Copia de "fields" apta para crear: sin los custom fields de la plantilla y solo con las propiedades básicas de
 * cada campo (como en el ejemplo del contrato:
 * { name, visible, required }). Se descartan objetos/arrays anidados (condiciones, reglas…): si no, el field set
 * nuevo hereda campos condicionales y después Procore no deja actualizarlo ("conditional fields").
 */
export function sanitizeFields(fields: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [key, val] of Object.entries(fields)) {
    if (!val || typeof val !== "object" || Array.isArray(val)) continue;
    // Los custom fields de la plantilla NO se copian (pertenecen a ella y a sus secciones).
    if (isCustomFieldEntry(key, val)) continue;
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (/condition/i.test(k)) continue;
      if (v === null || ["string", "number", "boolean"].includes(typeof v)) clean[k] = v;
    }
    if (clean.name === undefined) clean.name = key;
    out[key] = clean;
  }
  return out;
}

/** Entrada de custom field para "fields", con la forma que devuelve Procore (custom_field_<n> → custom_field_definition_id). */
export function customFieldEntries(
  defIds: string[],
  opts: { sectionId?: string | null; startPosition?: number } = {},
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  defIds.forEach((id, i) => {
    const key = `custom_field_${id}`;
    out[key] = {
      name: key,
      custom_field_definition_id: Number(id),
      ...(opts.sectionId ? { custom_fields_section_id: Number(opts.sectionId) } : {}),
      visible: true,
      required: false,
      position: (opts.startPosition ?? 0) + i + 1,
    };
  });
  return out;
}

/** Custom fields ya presentes en "fields" de un field set, reducidos a lo necesario para reenviarlos en un PATCH. */
function currentCustomFieldEntries(fields: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const keep = ["name", "custom_field_definition_id", "custom_fields_section_id", "visible", "required", "position", "row", "column", "column_width"];
  const out: Record<string, Record<string, unknown>> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!isCustomFieldEntry(k, v) || !v || typeof v !== "object") continue;
    const e: Record<string, unknown> = {};
    for (const p of keep) if ((v as Record<string, unknown>)[p] !== undefined) e[p] = (v as Record<string, unknown>)[p];
    out[k] = e;
  }
  return out;
}

interface MetadataShape {
  host_type: string;
  source_type: string;
  learned: boolean;
}

/**
 * host_type / source_type de custom_field_metadata: se aprenden de metadatos existentes en la company
 * (de field sets a los que ya se añadieron custom fields desde Procore). Si no hay ninguno, se usa
 * host_type = class_name del field set y source_type = "ConfigurableFieldSet".
 */
async function metadataShape(className: string, ctx: AdapterContext): Promise<MetadataShape> {
  const learned = await memo(ctx, "cf_metadata_sample", async () => {
    try {
      const res = await ctx.client.get(E.customFields.metadata(ctx.companyId), { query: { page: 1, per_page: 100 }, resource: "Custom Fields (metadatos)" });
      return extractList<Record<string, unknown>>(res.data).filter((m) => typeof m.host_type === "string" && typeof m.source_type === "string");
    } catch {
      return [];
    }
  });
  const match = learned.find((m) => normalizeClassName(String(m.host_type)) === className) ?? learned.find((m) => /fieldset|field_set/i.test(String(m.source_type)));
  if (match) {
    const host = normalizeClassName(String(match.host_type)) === className || !FIELD_SET_CLASSES.some((c) => c.value === normalizeClassName(String(match.host_type))) ? String(match.host_type) : className;
    return { host_type: host, source_type: String(match.source_type), learned: true };
  }
  return { host_type: className, source_type: "ConfigurableFieldSet", learned: false };
}

/** IDs (locales) de custom fields asociados a un field set: detalle + metadatos. */
async function attachedCustomFieldIds(fieldSetId: string, ctx: AdapterContext): Promise<{ ids: Set<string>; sectionId: string | null; maxPosition: number }> {
  const ids = new Set<string>();
  let sectionId: string | null = null;
  let maxPosition = 0;
  try {
    const res = await ctx.client.get(E.fieldSets.show(ctx.companyId, fieldSetId), { resource: "Field Sets" });
    const raw = extractObject<Record<string, unknown>>(res.data);
    for (const sec of extractSections(raw)) {
      sec.remoteIds.forEach((r) => ids.add(r));
      sectionId ??= sec.id;
    }
  } catch {
    /* se sigue con los metadatos */
  }
  try {
    const res = await ctx.client.get(E.customFields.metadata(ctx.companyId), { query: { "filters[field_set_id][]": [fieldSetId], per_page: 100 }, resource: "Custom Fields (metadatos)" });
    for (const m of extractList<Record<string, unknown>>(res.data)) {
      if (m.custom_field_definition_id !== undefined) ids.add(String(m.custom_field_definition_id));
      if (m.custom_fields_section_id !== undefined && m.custom_fields_section_id !== null) sectionId ??= String(m.custom_fields_section_id);
      maxPosition = Math.max(maxPosition, Number(m.position ?? 0));
    }
  } catch {
    /* sin metadatos */
  }
  return { ids, sectionId, maxPosition };
}

/** Asocia al field set los custom fields que falten (POST custom_field_metadata). */
interface AttachError {
  customFieldId: string;
  httpStatus?: number;
  message: string;
  response: unknown;
}

/** Asocia al field set los custom fields que falten (POST custom_field_metadata). */
async function attachMissing(fieldSetId: string, className: string, wanted: string[], ctx: AdapterContext) {
  const { ids: present, sectionId, maxPosition } = await attachedCustomFieldIds(fieldSetId, ctx);
  const missing = wanted.filter((id) => !present.has(id));
  const shape = await metadataShape(className, ctx);
  const requests: unknown[] = [];
  const errors: AttachError[] = [];
  let position = maxPosition;
  for (const cfId of missing) {
    const body = {
      custom_field_metadatum: {
        custom_field_definition_id: Number(cfId),
        ...(sectionId ? { custom_fields_section_id: Number(sectionId) } : {}),
        host_type: shape.host_type,
        source_type: shape.source_type,
        source_id: Number(fieldSetId),
        position: ++position,
        visible: true,
        required: false,
      },
    };
    requests.push(body);
    const r = await runWrite(body, () => ctx.client.post(E.customFields.metadata(ctx.companyId), body, { resource: "custom_field_metadata (asociar custom field al field set)" }), idOf, "ok");
    if (!r.ok) errors.push({ customFieldId: cfId, httpStatus: r.httpStatus, message: r.message, response: r.response });
  }
  return { present: [...present], added: missing.length - errors.length, errors, requests, shape };
}

/** Resumen legible de los fallos al asociar custom fields (con el [ID] estándar y el HTTP de cada uno). */
function describeAttachErrors(errors: AttachError[], toStd: (remote: string) => string): string {
  const groups = new Map<string, string[]>();
  for (const e of errors) {
    const k = `HTTP ${e.httpStatus ?? "?"}: ${e.message}`;
    groups.set(k, [...(groups.get(k) ?? []), toStd(e.customFieldId)]);
  }
  return [...groups].map(([msg, ids]) => `${ids.join(", ")} → ${msg}`).join(" · ");
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
    const p = planItem(fieldSetsSpec, desired, existing, options, deps);
    // Como v1 no quita custom fields, si ya tiene todos los pedidos (aunque tenga alguno más) no hay nada que hacer.
    if (p.action === "UPDATE" && p.diffs.every((d) => d.attr === "custom_fields" || d.attr === "name")) {
      const cf = p.diffs.find((d) => d.attr === "custom_fields");
      const have = new Set((cf?.current as string[]) ?? []);
      const missing = ((cf?.desired as string[]) ?? []).filter((id) => !have.has(id));
      const onlyName = p.diffs.every((d) => d.attr === "name");
      if (!missing.length && (onlyName || cf)) {
        const extra = [...have].filter((id) => !((cf?.desired as string[]) ?? []).includes(id));
        return { ...p, action: "NOCHANGE", message: [extra.length ? `Tiene además ${extra.map((x) => `[${x}]`).join(", ")} (no se quitan).` : "", onlyName || p.diffs.some((d) => d.attr === "name") ? "El nombre de un field set no se cambia desde aquí." : ""].filter(Boolean).join(" ") || undefined };
      }
    }
    return p;
  },
  async apply(inputs, ctx, options) {
    const results: ApplyResult[] = [];
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
      const wantedRemote = ids.filter((id) => map.has(id)).map((id) => String(map.get(id)));
      const remoteToStd = new Map((await listCustomFields(ctx)).map((c) => [c.remoteId, c.key ?? `#${c.remoteId}`]));
      const describe = (list: string[]) => list.map((r) => `[${remoteToStd.get(r) ?? `#${r}`}]`).join(", ");

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
        const set: Record<string, unknown> = { name: desired.name, class_name: className, fields: sanitizeFields(resolved.fields as Record<string, unknown>) };
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
        const sections = desiredSections(desired.extra, ids).map(toSection);
        // 1º intento: los custom fields también dentro de "fields" (así los representa Procore).
        const withCf = { configurable_field_set: { ...set, fields: { ...(set.fields as object), ...customFieldEntries(wantedRemote) } }, custom_field_sections: sections };
        const ok = `Creado (campos de ${resolved.source})`;
        let body: unknown = withCf;
        let created = await runWrite(withCf, () => ctx.client.post(E.fieldSets.create(ctx.companyId), withCf, { resource: "Field Sets" }), idOf, ok);
        if (!created.ok && wantedRemote.length && (created.httpStatus === 422 || created.httpStatus === 400)) {
          // 2º intento sin ellos (los custom fields se añaden después).
          const plain = { configurable_field_set: set, custom_field_sections: sections };
          const retry = await runWrite(plain, () => ctx.client.post(E.fieldSets.create(ctx.companyId), plain, { resource: "Field Sets" }), idOf, ok);
          if (retry.ok) retry.message += ` (Procore no aceptó los custom fields dentro de "fields": ${created.message})`;
          created = retry;
          body = { intento_1: withCf, intento_2: plain };
        }
        if (!created.ok || !created.remoteId) {
          results.push({ ...created, request: body });
          continue;
        }
        // Procore puede ignorar custom_field_sections al crear: se comprueba y se añaden los que falten.
        const att = await attachMissing(created.remoteId, className, wantedRemote, ctx);
        const toStd = (r: string) => describe([r]);
        if (att.errors.length) {
          results.push({
            ok: false,
            remoteId: created.remoteId,
            httpStatus: att.errors[0].httpStatus,
            message: `El field set SÍ se creó en Procore (HTTP 201, id ${created.remoteId}), pero no se pudieron asociar ${att.errors.length} custom field(s) con custom_field_metadata: ${describeAttachErrors(att.errors, toStd)}`,
            request: { field_set: body, custom_field_metadata: att.requests },
            response: { field_set_creado: created.response, errores_custom_field_metadata: att.errors },
          });
        } else {
          results.push({
            ...created,
            message: created.message + (att.added ? ` — ${att.added} custom field(s) añadidos después de crear` : ""),
            request: att.requests.length ? { field_set: body, custom_field_metadata: att.requests } : body,
          });
        }
      } else {
        // Actualizar = añadir los custom fields que falten. 1º el PATCH documentado (con los custom fields dentro de
        // "fields"); si Procore lo rechaza (p. ej. "field set with conditional fields"), custom_field_metadata.
        const className = normalizeClassName(String(current?.attrs.class_name ?? desired.attrs.class_name));
        const fsId = plan.remoteId!;
        let detail: Record<string, unknown> = {};
        try {
          detail = extractObject<Record<string, unknown>>((await ctx.client.get(E.fieldSets.show(ctx.companyId, fsId), { resource: "Field Sets" })).data);
        } catch (e) {
          results.push({ ok: false, remoteId: fsId, message: `No se pudo leer el field set: ${(e as Error).message}`, request: null, response: null });
          continue;
        }
        const secs = extractSections(detail);
        const present = new Set(secs.flatMap((x) => x.remoteIds));
        const toAdd = wantedRemote.filter((id) => !present.has(id));
        const extra = [...present].filter((r) => !wantedRemote.includes(r));
        const parts: string[] = [];
        const requests: Record<string, unknown> = {};
        const responses: Record<string, unknown> = {};
        let ok = true;
        let httpStatus: number | undefined;
        if (toAdd.length) {
          const curFields = (detail.fields && typeof detail.fields === "object" ? detail.fields : {}) as Record<string, unknown>;
          const maxPos = Math.max(0, ...Object.values(currentCustomFieldEntries(curFields)).map((e) => Number(e.position ?? 0)));
          const firstSection = secs.find((x) => x.id)?.id ?? null;
          const patchBody = {
            configurable_field_set: {
              name: String(detail.name ?? current?.name ?? desired.name),
              fields: { ...sanitizeFields(curFields), ...currentCustomFieldEntries(curFields), ...customFieldEntries(toAdd, { sectionId: firstSection, startPosition: maxPos }) },
            },
            custom_field_sections: secs
              .filter((x) => x.id)
              .map((x, i) => ({ id: x.id, name: x.name, custom_field_definition_ids: [...x.remoteIds, ...(i === 0 ? toAdd : [])].map(Number) })),
          };
          requests.patch = patchBody;
          const patched = await runWrite(patchBody, () => ctx.client.patch(E.fieldSets.update(ctx.companyId, fsId), patchBody, { resource: "Field Sets" }), idOf, "ok");
          responses.patch = patched.response;
          let stillMissing = toAdd;
          if (patched.ok) {
            const after = await attachedCustomFieldIds(fsId, ctx);
            stillMissing = toAdd.filter((id) => !after.ids.has(id));
            if (toAdd.length > stillMissing.length) parts.push(`${toAdd.length - stillMissing.length} custom field(s) añadidos`);
          } else {
            parts.push(`el PATCH del field set no se aceptó (${patched.message})`);
          }
          if (stillMissing.length) {
            const att = await attachMissing(fsId, className, stillMissing, ctx);
            requests.custom_field_metadata = att.requests;
            if (att.added) parts.push(`${att.added} custom field(s) añadidos con custom_field_metadata`);
            if (att.errors.length) {
              ok = false;
              httpStatus = att.errors[0].httpStatus ?? patched.httpStatus;
              responses.errores_custom_field_metadata = att.errors;
              parts.push(`tampoco con custom_field_metadata: ${describeAttachErrors(att.errors, (r) => describe([r]))}`);
            }
          }
        } else {
          parts.push("ya tenía todos los custom fields");
        }
        if (extra.length) parts.push(`sobran ${describe(extra)}: no se quitan (v1 no elimina nada)`);
        if (options.includeTexts && current && current.name !== desired.name) parts.push("el nombre no se cambia en field sets (hazlo en Procore)");
        results.push({
          ok,
          remoteId: fsId,
          httpStatus,
          message: `${ok ? "Actualizado" : "No actualizado"}: ${parts.join("; ")}`,
          request: requests,
          response: Object.keys(responses).length ? responses : null,
        });
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
