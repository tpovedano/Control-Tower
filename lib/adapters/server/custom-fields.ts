import { parseName } from "@/lib/ids";
import { PROCORE_ENDPOINTS as E } from "@/lib/procore/endpoints";
import { planItem } from "@/lib/diff/plan";
import type { NormalizedItem } from "@/lib/types";
import { customFieldsSpec } from "../specs/custom-fields";
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

export function parseDataTypes(body: unknown): DataTypeInfo[] {
  const root = body && typeof body === "object" && !Array.isArray(body) && "data" in body ? (body as { data: unknown }).data : body;
  const out: DataTypeInfo[] = [];
  const pushVariants = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : String((x as Record<string, unknown>)?.variant ?? (x as Record<string, unknown>)?.name ?? (x as Record<string, unknown>)?.key ?? ""))).filter(Boolean) : [];
  if (Array.isArray(root)) {
    for (const d of root) {
      if (typeof d === "string") out.push({ dataType: d, variants: [] });
      else if (d && typeof d === "object") {
        const o = d as Record<string, unknown>;
        const dt = String(o.data_type ?? o.key ?? o.name ?? o.id ?? "");
        if (dt) out.push({ dataType: dt, label: typeof o.label === "string" ? o.label : undefined, variants: pushVariants(o.variants) });
      }
    }
  } else if (root && typeof root === "object") {
    for (const [k, v] of Object.entries(root as Record<string, unknown>)) {
      if (v && typeof v === "object" && !Array.isArray(v)) out.push({ dataType: k, variants: pushVariants((v as Record<string, unknown>).variants) });
      else out.push({ dataType: k, variants: pushVariants(v) });
    }
  }
  return out;
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
