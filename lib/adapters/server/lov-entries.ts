import { lovKey, parseName } from "@/lib/ids";
import { PROCORE_ENDPOINTS as E } from "@/lib/procore/endpoints";
import { mapLimit } from "@/lib/procore/semaphore";
import { planItem } from "@/lib/diff/plan";
import type { NormalizedItem } from "@/lib/types";
import { LOV_DATA_TYPES } from "../specs/custom-fields";
import { lovEntriesSpec } from "../specs/lov-entries";
import { runWrite } from "./run-apply";
import { listCustomFields } from "./custom-fields";
import { invalidate, memo, type AdapterContext, type ApplyResult, type ServerAdapter } from "./types";

function normalize(raw: Record<string, unknown>, parent?: NormalizedItem): NormalizedItem {
  const name = String(raw.label ?? raw.name ?? "");
  const p = parseName(name);
  const parentKey = parent?.key ?? null;
  return {
    key: p.id && parentKey ? lovKey(parentKey, p.id) : null,
    stdId: p.id,
    parentKey,
    name,
    text: p.text,
    remoteId: String(raw.id),
    parentRemoteId: parent?.remoteId ?? (raw.custom_field_definition_id !== undefined ? String(raw.custom_field_definition_id) : null),
    attrs: { active: raw.active === undefined ? true : Boolean(raw.active) },
    extra: { position: raw.position ?? null, parentName: parent?.name ?? null },
  };
}

async function listLovFor(ctx: AdapterContext, cf: NormalizedItem): Promise<NormalizedItem[]> {
  const raw = await ctx.client.paginate<Record<string, unknown>>(E.lovEntries.list(ctx.companyId, cf.remoteId), { resource: "LOV Entries" });
  return raw.map((r) => normalize(r, cf));
}

function lovCustomFields(cfs: NormalizedItem[]) {
  return cfs.filter((c) => LOV_DATA_TYPES.includes(String(c.attrs.data_type)));
}

async function findParent(desiredParentKey: string | undefined, ctx: AdapterContext) {
  const cfs = await listCustomFields(ctx);
  const matches = cfs.filter((c) => c.key === desiredParentKey);
  return { matches, cfs };
}

export const lovEntriesAdapter: ServerAdapter = {
  spec: lovEntriesSpec,
  normalize,
  list(ctx) {
    return memo(ctx, "lov_entries", async () => {
      const cfs = lovCustomFields(await listCustomFields(ctx));
      const lists = await mapLimit(cfs, 3, (cf) => listLovFor(ctx, cf));
      return lists.flat();
    });
  },
  async dependencies(desired, ctx) {
    const { matches } = await findParent(desired.parentKey, ctx);
    if (!matches.length) return { missing: [desired.parentKey!] };
    if (matches.length > 1) return { missing: [], message: `Conflicto: el custom field padre [${desired.parentKey}] está repetido en esta instancia.` };
    if (!LOV_DATA_TYPES.includes(String(matches[0].attrs.data_type))) {
      return { missing: [], message: `El custom field [${desired.parentKey}] es de tipo “${matches[0].attrs.data_type}”, no es una lista (lov_entry/lov_entries).` };
    }
    return { missing: [] };
  },
  async plan(desired, existing, ctx, options) {
    const deps = await this.dependencies!(desired, ctx);
    return planItem(lovEntriesSpec, desired, existing, options, deps);
  },
  /**
   * Crea las opciones agrupadas por custom field padre con bulk_create.
   * Procore ordena la posición de forma descendente (la mayor queda arriba), así que se envían en orden inverso
   * y después se verifica el orden resultante.
   */
  async apply(inputs, ctx) {
    const results: ApplyResult[] = new Array(inputs.length);
    const groups = new Map<string, number[]>();
    inputs.forEach((inp, i) => groups.set(inp.desired.parentKey!, [...(groups.get(inp.desired.parentKey!) ?? []), i]));
    for (const [parentKey, idxs] of groups) {
      const { matches } = await findParent(parentKey, ctx);
      const parent = matches[0];
      if (!parent || matches.length > 1) {
        for (const i of idxs) results[i] = { ok: false, message: `No se encontró el custom field padre [${parentKey}]`, request: null, response: null };
        continue;
      }
      const ordered = idxs.map((i) => inputs[i].desired);
      const body = { custom_field_lov_entries: [...ordered].reverse().map((d) => ({ label: d.name })) };
      const r = await runWrite(body, () => ctx.client.post(E.lovEntries.bulkCreate(parent.remoteId), body, { resource: "LOV Entries", query: { company_id: ctx.companyId } }), () => undefined, "Creada");
      let verifyNote = "";
      if (r.ok) {
        invalidate(ctx, "lov_entries");
        try {
          const after = await listLovFor(ctx, parent);
          const sorted = [...after].sort((a, b) => Number(b.extra?.position ?? 0) - Number(a.extra?.position ?? 0));
          const positions = ordered.map((d) => sorted.findIndex((x) => x.key === d.key));
          const inOrder = positions.every((p, i) => p >= 0 && (i === 0 || p > positions[i - 1]));
          if (!inOrder) verifyNote = " (aviso: el orden resultante en Procore no coincide con el del lote)";
          for (const i of idxs) {
            const created = after.find((x) => x.key === inputs[i].desired.key);
            results[i] = { ...r, remoteId: created?.remoteId, message: created ? `Creada${verifyNote}` : "Procore respondió OK pero la opción no aparece al verificar" , ok: !!created };
          }
          continue;
        } catch {
          verifyNote = " (no se pudo verificar el orden)";
        }
      }
      for (const i of idxs) results[i] = { ...r, message: r.message + verifyNote };
    }
    return results;
  },
  toDesired(item) {
    return { key: item.key!, stdId: item.stdId!, parentKey: item.parentKey ?? undefined, name: item.name, attrs: { active: true } };
  },
};
