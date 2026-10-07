import { parseName } from "@/lib/ids";
import { PROCORE_ENDPOINTS as E } from "@/lib/procore/endpoints";
import { planItem } from "@/lib/diff/plan";
import type { NormalizedItem } from "@/lib/types";
import { KNOWN_DATA_TYPES, customFieldsSpec } from "../specs/custom-fields";
import type { DataTypeInfo } from "../spec-types";
import { idOf, runWrite } from "./run-apply";
import { memo, pickAttrs, str, type AdapterContext, type ServerAdapter } from "./types";

function normalize(raw: Record<string, unknown>): NormalizedItem {
  const name = String(raw.label ?? raw.name ?? "");
  const p = parseName(name);
  return {
    key: p.id,
    stdId: p.id,
    name,
    text: p.text,
    remoteId: String(raw.id),
    attrs: {
      data_type: str(raw.data_type),
      variant: str(raw.variant),
      active: raw.active === undefined ? true : Boolean(raw.active),
    },
    extra: { description: str(raw.description), default_value: str(raw.default_value) },
  };
}

export function listCustomFields(ctx: AdapterContext): Promise<NormalizedItem[]> {
  return memo(ctx, "custom_fields", async () => {
    const raw = await ctx.client.paginate<Record<string, unknown>>(E.customFields.list(ctx.companyId), { resource: "Custom Fields" });
    return raw.map(normalize);
  });
}

/** Lee los tipos de dato/variantes habilitados (para los selectores y la validación). Formato defensivo. */
export async function listDataTypes(ctx: AdapterContext): Promise<DataTypeInfo[]> {
  const res = await ctx.client.get<unknown>(E.customFields.dataTypes(ctx.companyId), { resource: "Custom Fields (tipos de dato)" });
  return parseDataTypes(res.data);
}

/**
 * Interpreta la respuesta de /custom_field/data_types sin depender de su forma exacta.
 * Solo se aceptan como tipos los valores reconocibles (campo data_type, cadenas sueltas o claves que sean
 * un tipo conocido); los nombres de agrupación ("all", "enabled"…) nunca se toman como tipos.
 * Si no se reconoce ningún tipo conocido, devuelve [] y la validación usa la lista oficial de respaldo.
 */
export function parseDataTypes(body: unknown): DataTypeInfo[] {
  const found = new Map<string, DataTypeInfo>();
  const variantsOf = (v: unknown): string[] =>
    Array.isArray(v)
      ? v
          .map((x) => (typeof x === "string" ? x : String((x as Record<string, unknown>)?.variant ?? (x as Record<string, unknown>)?.name ?? (x as Record<string, unknown>)?.key ?? "")))
          .filter(Boolean)
      : [];
  const add = (dataType: string, variants: string[] = [], label?: string) => {
    if (!/^[a-z][a-z0-9_]*$/.test(dataType)) return;
    const prev = found.get(dataType);
    found.set(dataType, { dataType, label: label ?? prev?.label, variants: Array.from(new Set([...(prev?.variants ?? []), ...variants])) });
  };
  const walk = (node: unknown, depth: number) => {
    if (depth > 6 || node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const x of node) {
        if (typeof x === "string") add(x);
        else walk(x, depth + 1);
      }
      return;
    }
    if (typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (typeof o.data_type === "string") {
      add(o.data_type, variantsOf(o.variants), typeof o.label === "string" ? o.label : undefined);
      return;
    }
    for (const [k, v] of Object.entries(o)) {
      if (KNOWN_DATA_TYPES.includes(k)) {
        add(k, Array.isArray(v) ? variantsOf(v) : variantsOf((v as Record<string, unknown>)?.variants));
      } else {
        walk(v, depth + 1); // clave contenedora ("data", "all"…): se explora su contenido
      }
    }
  };
  walk(body, 0);
  const list = [...found.values()];
  // Respuesta irreconocible (ningún tipo conocido): mejor usar la lista oficial que validar contra basura.
  return list.some((d) => KNOWN_DATA_TYPES.includes(d.dataType)) ? list : [];
}

export const customFieldsAdapter: ServerAdapter = {
  spec: customFieldsSpec,
  normalize,
  list: listCustomFields,
  async plan(desired, existing, _ctx, options) {
    return planItem(customFieldsSpec, desired, existing, options);
  },
  async apply(inputs, ctx, options) {
    const results = [];
    for (const { desired, plan, current } of inputs) {
      const description = (desired.extra?.description as string | null) ?? undefined;
      const defaultValue = (desired.extra?.default_value as string | null) ?? undefined;
      if (plan.action === "CREATE") {
        const body = {
          custom_field_definition: {
            label: desired.name,
            data_type: desired.attrs.data_type,
            ...(desired.attrs.variant ? { variant: desired.attrs.variant } : {}),
            active: desired.attrs.active ?? true,
            ...(description ? { description } : {}),
            ...(defaultValue ? { default_value: defaultValue } : {}),
          },
        };
        results.push(await runWrite(body, () => ctx.client.post(E.customFields.create(ctx.companyId), body, { resource: "Custom Fields" }), idOf, "Creado"));
      } else {
        const body = {
          custom_field_definition: {
            // label es obligatorio en el PATCH: se conserva el nombre local (idioma) salvo que se pidan textos.
            label: options.includeTexts ? desired.name : current?.name ?? desired.name,
            ...(desired.attrs.variant ? { variant: desired.attrs.variant } : {}),
            ...(desired.attrs.active !== null && desired.attrs.active !== undefined ? { active: desired.attrs.active } : {}),
            ...(options.includeTexts && description ? { description } : {}),
            ...(options.includeTexts && defaultValue ? { default_value: defaultValue } : {}),
          },
        };
        results.push(
          await runWrite(body, () => ctx.client.patch(E.customFields.update(ctx.companyId, plan.remoteId!), body, { resource: "Custom Fields" }), idOf, "Actualizado"),
        );
      }
    }
    return results;
  },
  toDesired(item) {
    return {
      key: item.key!,
      stdId: item.stdId!,
      name: item.name,
      attrs: pickAttrs(item, customFieldsSpec.compareAttrs),
      extra: { description: item.extra?.description ?? null, default_value: item.extra?.default_value ?? null },
    };
  },
};
