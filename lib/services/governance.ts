import "server-only";
import { getAdapter } from "@/lib/adapters/server";
import { getSpec } from "@/lib/adapters/specs";
import { attrEquals } from "@/lib/adapters/spec-types";
import { buildMatrix, crossTypeConflicts, enrichCustomFieldsWithLov, matrixStats, type MatrixRow } from "@/lib/diff/matrix";
import type { DesiredItem, NormalizedItem, ObjectType } from "@/lib/types";
import { OBJECT_TYPES } from "@/lib/types";
import { catalogMap, latestSnapshots, type LatestSnapshot } from "./engine";
import { listInstances, toPublic } from "./instances";

export async function buildGovernance(objectType: ObjectType) {
  const spec = getSpec(objectType);
  const [instances, snaps, catalog] = await Promise.all([
    listInstances(),
    latestSnapshots({ objectType, withItems: true }),
    catalogMap(objectType),
  ]);
  let lovSnaps: LatestSnapshot[] = [];
  if (objectType === "custom_fields") lovSnaps = await latestSnapshots({ objectType: "lov_entries", withItems: true, okOnly: true });

  const golden = instances.find((i) => i.isGolden);
  const inputs = instances.map((inst) => {
    const snap = snaps.find((s) => s.instanceId === inst.id && s.ok);
    let items = snap?.items ?? [];
    if (objectType === "custom_fields") {
      const lov = lovSnaps.find((s) => s.instanceId === inst.id);
      if (lov) items = enrichCustomFieldsWithLov(items, lov.items);
    }
    return { instanceId: inst.id, items, available: !!snap };
  });
  const extraAttrs = objectType === "custom_fields" && lovSnaps.length ? ["lov_options"] : [];
  const rows = buildMatrix({ spec, instances: inputs, goldenInstanceId: golden?.id ?? null, catalog: catalog.size ? catalog : undefined, extraAttrs });
  const stats = matrixStats(
    rows,
    inputs.filter((i) => i.available).map((i) => i.instanceId),
  );

  // Conflictos entre tipos: mismo [ID] usado en objetos de naturaleza distinta.
  const allMeta = await latestSnapshots({ withItems: true, okOnly: true });
  const idsByType: Partial<Record<ObjectType, string[]>> = {};
  for (const t of OBJECT_TYPES) {
    idsByType[t] = Array.from(new Set(allMeta.filter((s) => s.objectType === t).flatMap((s) => s.items.map((i) => i.stdId).filter(Boolean) as string[])));
  }
  const cross = crossTypeConflicts(idsByType).filter((c) => c.types.includes(objectType));

  const snapshotsMeta = (await latestSnapshots({})).map(({ items: _items, ...m }) => m);

  return {
    objectType,
    instances: instances.map(toPublic),
    rows,
    stats,
    crossConflicts: cross,
    snapshots: snapshotsMeta,
    referenceMode: catalog.size ? "catalog" : golden ? "golden" : "consensus",
    catalogSize: catalog.size,
  };
}

/** Busca el elemento fuente (referencia) para un [ID]: catálogo > golden > consenso. */
function sourceItemFor(row: MatrixRow, snapsByInstance: Map<string, NormalizedItem[]>, catalog: Map<string, NormalizedItem>, goldenId?: string): NormalizedItem | null {
  if (!row.key) return null;
  const cat = catalog.get(row.key);
  if (cat) return cat;
  if (goldenId) {
    const g = (snapsByInstance.get(goldenId) ?? []).filter((i) => i.key === row.key);
    if (g.length === 1) return g[0];
  }
  for (const [instId, cell] of Object.entries(row.cells)) {
    if (cell?.status !== "aligned") continue;
    const item = (snapsByInstance.get(instId) ?? []).find((i) => i.key === row.key);
    if (item) return item;
  }
  // Sin consenso: el primero que no esté en conflicto y coincida con la referencia.
  for (const items of snapsByInstance.values()) {
    const m = items.filter((i) => i.key === row.key);
    if (m.length === 1 && row.referenceAttrs && Object.keys(row.referenceAttrs).every((k) => attrEquals(m[0].attrs[k], row.referenceAttrs![k]))) return m[0];
  }
  return null;
}

/** Construye los elementos deseados para remediar desde la matriz (no confía en datos enviados por el cliente). */
export async function buildRemediation(objectType: ObjectType, keys: string[], mode: "create_missing" | "align", instanceIds?: string[]) {
  const gov = await buildGovernance(objectType);
  const adapter = getAdapter(objectType);
  const [snaps, catalog] = await Promise.all([latestSnapshots({ objectType, withItems: true, okOnly: true }), catalogMap(objectType)]);
  const snapsByInstance = new Map(snaps.map((s) => [s.instanceId, s.items]));
  const goldenId = gov.instances.find((i) => i.isGolden)?.id;

  const desired: DesiredItem[] = [];
  const targets = new Set<string>();
  const problems: string[] = [];
  for (const key of keys) {
    const row = gov.rows.find((r) => r.key === key);
    if (!row) {
      problems.push(`[${key}] no está en la matriz`);
      continue;
    }
    const src = sourceItemFor(row, snapsByInstance, catalog, goldenId);
    if (!src) {
      problems.push(`[${key}] no tiene una definición de referencia sin conflictos`);
      continue;
    }
    desired.push(adapter.toDesired(src));
    for (const [instId, cell] of Object.entries(row.cells)) {
      if (instanceIds && !instanceIds.includes(instId)) continue;
      if (mode === "create_missing" && cell?.status === "missing") targets.add(instId);
      if (mode === "align" && cell?.status === "differs") targets.add(instId);
    }
  }
  return { desired, instanceIds: [...targets], problems };
}
