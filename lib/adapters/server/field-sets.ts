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

/**
 * Copia de "fields" apta para crear: solo las propiedades básicas de cada campo (como en el ejemplo del contrato:
 * { name, visible, required }). Se descartan objetos/arrays anidados (condiciones, reglas…): si no, el field set
 * nuevo hereda campos condicionales y después Procore no deja actualizarlo ("conditional fields").
 */
export function sanitizeFields(fields: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [key, val] of Object.entries(fields)) {
    if (!val || typeof val !== "object" || Array.isArray(val)) continue;
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
async function attachMissing(fieldSetId: string, className: string, wanted: string[], ctx: AdapterContext) {
  const { ids: present, sectionId, maxPosition } = await attachedCustomFieldIds(fieldSetId, ctx);
  const missing = wanted.filter((id) => !present.has(id));
  const shape = await metadataShape(className, ctx);
  const requests: unknown[] = [];
  const errors: string[] = [];
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
    const r = await runWrite(body, () => ctx.client.post(E.customFields.metadata(ctx.companyId), body, { resource: "Custom Fields (metadatos)" }), idOf, "ok");
    if (!r.ok) errors.push(`custom field ${cfId}: ${r.message}`);
  }
  return { present: [...present], added: missing.length - errors.length, errors, requests, shape };
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
        const body = { configurable_field_set: set, custom_field_sections: desiredSections(desired.extra, ids).map(toSection) };
        const created = await runWrite(body, () => ctx.client.post(E.fieldSets.create(ctx.companyId), body, { resource: "Field Sets" }), idOf, `Creado (campos de ${resolved.source})`);
        if (!created.ok || !created.remoteId) {
          results.push(created);
          continue;
        }
        // Procore puede ignorar custom_field_sections al crear: se comprueba y se añaden los que falten.
        const att = await attachMissing(created.remoteId, className, wantedRemote, ctx);
        const note = att.errors.length
          ? ` — pero no se pudieron añadir ${att.errors.length} custom field(s): ${att.errors.join(" · ")}`
          : att.added
            ? ` — ${att.added} custom field(s) añadidos después de crear`
            : "";
        results.push({
          ...created,
          ok: att.errors.length === 0,
          message: created.message + note,
          request: att.requests.length ? { field_set: body, custom_field_metadata: att.requests } : body,
        });
      } else {
        // Actualizar = añadir los custom fields que falten mediante custom_field_metadata. No se usa el PATCH del
        // field set: Procore lo rechaza en field sets con campos condicionales y podría alterar su configuración.
        const className = normalizeClassName(String(current?.attrs.class_name ?? desired.attrs.class_name));
        const att = await attachMissing(plan.remoteId!, className, wantedRemote, ctx);
        const extra = att.present.filter((r) => !wantedRemote.includes(r));
        const parts: string[] = [];
        if (att.added) parts.push(`${att.added} custom field(s) añadidos`);
        if (!att.added && !att.errors.length) parts.push("ya tenía todos los custom fields");
        if (att.errors.length) parts.push(`errores: ${att.errors.join(" · ")}`);
        if (extra.length) parts.push(`sobran ${describe(extra)}: no se quitan (v1 no elimina nada)`);
        if (options.includeTexts && current && current.name !== desired.name) parts.push("el nombre no se cambia en field sets (hazlo en Procore)");
        results.push({ ok: att.errors.length === 0, remoteId: plan.remoteId, message: `Actualizado: ${parts.join("; ")}`, request: { custom_field_metadata: att.requests }, response: null });
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
