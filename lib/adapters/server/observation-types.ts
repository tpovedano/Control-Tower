import { parseName } from "@/lib/ids";
import { PROCORE_ENDPOINTS as E } from "@/lib/procore/endpoints";
import { planItem } from "@/lib/diff/plan";
import type { NormalizedItem } from "@/lib/types";
import { observationTypesSpec } from "../specs/observation-types";
import { memo, pickAttrs, str, type ServerAdapter } from "./types";

function normalize(raw: Record<string, unknown>): NormalizedItem {
  const name = String(raw.name ?? "");
  const p = parseName(name);
  return {
    key: p.id,
    stdId: p.id,
    name,
    text: p.text,
    remoteId: String(raw.id),
    attrs: { category: str(raw.category), active: raw.active === undefined ? true : Boolean(raw.active) },
    extra: { observations_category_id: raw.observations_category_id ?? null },
  };
}

/** Solo lectura: Procore no publica POST/PATCH de Observation Types a nivel company. */
export const observationTypesAdapter: ServerAdapter = {
  spec: observationTypesSpec,
  normalize,
  list(ctx) {
    return memo(ctx, "observation_types", async () =>
      (await ctx.client.paginate<Record<string, unknown>>(E.observationTypes.listCompany(ctx.companyId), { resource: "Observation Types" })).map(normalize),
    );
  },
  async plan(desired, existing, _ctx, options) {
    return planItem(observationTypesSpec, desired, existing, options);
  },
  async apply(inputs) {
    return inputs.map(() => ({ ok: false, message: observationTypesSpec.readOnlyReason!, request: null, response: null }));
  },
  toDesired(item) {
    return { key: item.key!, stdId: item.stdId!, name: item.name, attrs: pickAttrs(item, observationTypesSpec.compareAttrs) };
  },
};
