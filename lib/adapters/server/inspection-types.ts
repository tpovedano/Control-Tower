import { parseName } from "@/lib/ids";
import { PROCORE_ENDPOINTS as E } from "@/lib/procore/endpoints";
import { planItem } from "@/lib/diff/plan";
import type { NormalizedItem } from "@/lib/types";
import { inspectionTypesSpec } from "../specs/inspection-types";
import { idOf, runWrite } from "./run-apply";
import { memo, pickAttrs, str, type ServerAdapter } from "./types";

function normalize(raw: Record<string, unknown>): NormalizedItem {
  const name = String(raw.name ?? "");
  const p = parseName(name);
  return { key: p.id, stdId: p.id, name, text: p.text, remoteId: String(raw.id), attrs: { grouping: str(raw.grouping) } };
}

export const inspectionTypesAdapter: ServerAdapter = {
  spec: inspectionTypesSpec,
  normalize,
  list(ctx) {
    return memo(ctx, "inspection_types", async () =>
      (await ctx.client.paginate<Record<string, unknown>>(E.inspectionTypes.list(ctx.companyId), { resource: "Inspection Types" })).map(normalize),
    );
  },
  async plan(desired, existing, _ctx, options) {
    return planItem(inspectionTypesSpec, desired, existing, options);
  },
  async apply(inputs, ctx, options) {
    const results = [];
    for (const { desired, plan, current } of inputs) {
      if (plan.action === "CREATE") {
        const body = { inspection_type: { name: desired.name, ...(desired.attrs.grouping ? { grouping: desired.attrs.grouping } : {}) } };
        results.push(await runWrite(body, () => ctx.client.post(E.inspectionTypes.create(ctx.companyId), body, { resource: "Inspection Types" }), idOf, "Creado"));
      } else {
        const body = {
          inspection_type: {
            name: options.includeTexts ? desired.name : current?.name ?? desired.name,
            ...(desired.attrs.grouping ? { grouping: desired.attrs.grouping } : {}),
          },
        };
        results.push(
          await runWrite(body, () => ctx.client.patch(E.inspectionTypes.update(ctx.companyId, plan.remoteId!), body, { resource: "Inspection Types" }), idOf, "Actualizado"),
        );
      }
    }
    return results;
  },
  toDesired(item) {
    return { key: item.key!, stdId: item.stdId!, name: item.name, attrs: pickAttrs(item, inspectionTypesSpec.compareAttrs) };
  },
};
