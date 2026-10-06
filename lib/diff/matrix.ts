import { attrEquals, type ObjectSpec } from "@/lib/adapters/spec-types";
import type { AttrDiff, AttrValue, NormalizedItem, ObjectType } from "@/lib/types";

export type CellStatus = "aligned" | "missing" | "differs" | "conflict" | "orphan";

export interface MatrixCell {
  status: CellStatus;
  names: string[];
  remoteIds: string[];
  attrs?: Record<string, AttrValue>;
  diffs: AttrDiff[];
  note?: string;
}

export interface MatrixRow {
  /** key del [ID] (o "~orphan:<instancia>:<remoteId>" para huérfanos). */
  rowId: string;
  key: string | null;
  objectType: ObjectType;
  parentKey?: string | null;
  orphan: boolean;
  referenceAttrs: Record<string, AttrValue> | null;
  referenceSource: "catalog" | "golden" | "consensus" | null;
  displayName: string;
  cells: Record<string, MatrixCell | undefined>;
  alerts: string[];
}

export interface InstanceSnapshotInput {
  instanceId: string;
  items: NormalizedItem[];
  /** false si no hay snapshot para este tipo (celdas sin datos). */
  available: boolean;
}

export interface MatrixInput {
  spec: ObjectSpec;
  instances: InstanceSnapshotInput[];
  goldenInstanceId?: string | null;
  catalog?: Map<string, NormalizedItem>;
  /** Atributos extra a comparar (p. ej. lov_options en custom fields). */
  extraAttrs?: string[];
}

export interface MatrixStats {
  totalIds: number;
  alignedCells: number;
  totalCells: number;
  alignmentPct: number;
  perInstance: Record<string, { aligned: number; total: number; pct: number; missing: number; differs: number; conflict: number; orphan: number }>;
  orphans: number;
  conflicts: number;
}

function signature(attrs: Record<string, AttrValue>, keys: string[]): string {
  return JSON.stringify(
    keys.map((k) => {
      const v = attrs[k];
      if (Array.isArray(v)) return [...v].map(String).sort();
      if (v === undefined || v === "") return null;
      return v;
    }),
  );
}

/** Construye la matriz de alineación. Compara por [ID], ignorando nombre/idioma. */
export function buildMatrix(input: MatrixInput): MatrixRow[] {
  const { spec, instances, goldenInstanceId, catalog } = input;
  const compare = [...spec.compareAttrs, ...(input.extraAttrs ?? [])];
  const rows = new Map<string, MatrixRow>();
  const orphanRows: MatrixRow[] = [];

  // Agrupar por key.
  const byKey = new Map<string, Map<string, NormalizedItem[]>>();
  for (const inst of instances) {
    for (const item of inst.items) {
      if (!item.key) {
        orphanRows.push({
          rowId: `~orphan:${inst.instanceId}:${item.remoteId}`,
          key: null,
          objectType: spec.type,
          parentKey: item.parentKey ?? null,
          orphan: true,
          referenceAttrs: null,
          referenceSource: null,
          displayName: item.name,
          cells: {
            [inst.instanceId]: { status: "orphan", names: [item.name], remoteIds: [item.remoteId], attrs: item.attrs, diffs: [], note: "Sin [ID]: no gobernado" },
          },
          alerts: [],
        });
        continue;
      }
      let m = byKey.get(item.key);
      if (!m) byKey.set(item.key, (m = new Map()));
      m.set(inst.instanceId, [...(m.get(inst.instanceId) ?? []), item]);
    }
  }
  if (catalog) for (const k of catalog.keys()) if (!byKey.has(k)) byKey.set(k, new Map());

  for (const [key, perInst] of byKey) {
    // Referencia: catálogo > instancia golden > consenso (atributos más frecuentes).
    let referenceAttrs: Record<string, AttrValue> | null = null;
    let referenceSource: MatrixRow["referenceSource"] = null;
    const cat = catalog?.get(key);
    const golden = goldenInstanceId ? perInst.get(goldenInstanceId) : undefined;
    if (cat) {
      referenceAttrs = cat.attrs;
      referenceSource = "catalog";
    } else if (golden && golden.length === 1) {
      referenceAttrs = golden[0].attrs;
      referenceSource = "golden";
    } else {
      const counts = new Map<string, { n: number; attrs: Record<string, AttrValue> }>();
      for (const list of perInst.values()) {
        if (list.length !== 1) continue;
        const sig = signature(list[0].attrs, compare);
        const c = counts.get(sig);
        if (c) c.n++;
        else counts.set(sig, { n: 1, attrs: list[0].attrs });
      }
      const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
      if (best) {
        referenceAttrs = best.attrs;
        referenceSource = "consensus";
      }
    }

    const alerts: string[] = [];
    const cells: Record<string, MatrixCell | undefined> = {};
    let displayName = cat?.name ?? "";
    const natures = new Set<string>();

    for (const inst of instances) {
      if (!inst.available) {
        cells[inst.instanceId] = undefined;
        continue;
      }
      const list = perInst.get(inst.instanceId) ?? [];
      if (!displayName && list[0]) displayName = list[0].name;
      if (list.length === 0) {
        cells[inst.instanceId] = { status: "missing", names: [], remoteIds: [], diffs: [] };
        continue;
      }
      if (spec.natureAttr) list.forEach((i) => natures.add(String(i.attrs[spec.natureAttr!] ?? "")));
      if (list.length > 1) {
        cells[inst.instanceId] = {
          status: "conflict",
          names: list.map((i) => i.name),
          remoteIds: list.map((i) => i.remoteId),
          attrs: list[0].attrs,
          diffs: [],
          note: `ID repetido ${list.length} veces en esta instancia`,
        };
        continue;
      }
      const item = list[0];
      const diffs: AttrDiff[] = [];
      if (referenceAttrs) {
        for (const a of compare) {
          if (!attrEquals(item.attrs[a], referenceAttrs[a])) diffs.push({ attr: a, current: item.attrs[a], desired: referenceAttrs[a] });
        }
      }
      cells[inst.instanceId] = {
        status: diffs.length ? "differs" : "aligned",
        names: [item.name],
        remoteIds: [item.remoteId],
        attrs: item.attrs,
        diffs,
      };
    }

    if (Object.values(cells).some((c) => c?.status === "conflict")) alerts.push("ID repetido dentro de una misma instancia");
    if (natures.size > 1 && spec.natureAttr) {
      alerts.push(`Mismo ID con distinta naturaleza (${spec.attrLabels[spec.natureAttr] ?? spec.natureAttr}: ${[...natures].join(" / ")})`);
    }

    const firstParent = [...perInst.values()].flat()[0]?.parentKey ?? cat?.parentKey ?? null;
    rows.set(key, {
      rowId: key,
      key,
      objectType: spec.type,
      parentKey: firstParent,
      orphan: false,
      referenceAttrs,
      referenceSource,
      displayName: displayName || `[${key}]`,
      cells,
      alerts,
    });
  }

  const sorted = [...rows.values()].sort((a, b) => (a.key! < b.key! ? -1 : a.key! > b.key! ? 1 : 0));
  return [...sorted, ...orphanRows];
}

export function matrixStats(rows: MatrixRow[], instanceIds: string[]): MatrixStats {
  const perInstance: MatrixStats["perInstance"] = {};
  for (const id of instanceIds) perInstance[id] = { aligned: 0, total: 0, pct: 0, missing: 0, differs: 0, conflict: 0, orphan: 0 };
  let aligned = 0;
  let total = 0;
  let orphans = 0;
  let conflicts = 0;
  for (const row of rows) {
    if (row.orphan) {
      orphans++;
      for (const [id, c] of Object.entries(row.cells)) if (c && perInstance[id]) perInstance[id].orphan++;
      continue;
    }
    if (row.alerts.length) conflicts++;
    for (const id of instanceIds) {
      const c = row.cells[id];
      if (!c) continue;
      total++;
      perInstance[id].total++;
      if (c.status === "aligned") {
        aligned++;
        perInstance[id].aligned++;
      } else if (c.status === "missing") perInstance[id].missing++;
      else if (c.status === "differs") perInstance[id].differs++;
      else if (c.status === "conflict") perInstance[id].conflict++;
    }
  }
  for (const p of Object.values(perInstance)) p.pct = p.total ? Math.round((p.aligned / p.total) * 1000) / 10 : 100;
  return {
    totalIds: rows.filter((r) => !r.orphan).length,
    alignedCells: aligned,
    totalCells: total,
    alignmentPct: total ? Math.round((aligned / total) * 1000) / 10 : 100,
    perInstance,
    orphans,
    conflicts,
  };
}

/** Enriquecer custom fields con el conjunto de IDs de sus opciones LOV (para detectar diferencias). */
export function enrichCustomFieldsWithLov(cfs: NormalizedItem[], lovs: NormalizedItem[]): NormalizedItem[] {
  const byParent = new Map<string, string[]>();
  for (const l of lovs) {
    if (!l.parentRemoteId) continue;
    const list = byParent.get(l.parentRemoteId) ?? [];
    list.push(l.stdId ?? `#${l.remoteId}`);
    byParent.set(l.parentRemoteId, list);
  }
  return cfs.map((cf) => {
    const isLov = cf.attrs.data_type === "lov_entry" || cf.attrs.data_type === "lov_entries";
    const opts = byParent.get(cf.remoteId) ?? (isLov ? [] : null);
    if (!opts) return cf;
    return { ...cf, attrs: { ...cf.attrs, lov_options: [...opts].sort() } };
  });
}

/** Detecta IDs usados en tipos de objeto distintos (naturaleza distinta). */
export function crossTypeConflicts(byType: Partial<Record<ObjectType, string[]>>): { id: string; types: ObjectType[] }[] {
  const map = new Map<string, Set<ObjectType>>();
  for (const [type, ids] of Object.entries(byType) as [ObjectType, string[]][]) {
    if (type === "lov_entries") continue; // las opciones viven bajo su custom field
    for (const id of ids) {
      const s = map.get(id) ?? new Set();
      s.add(type);
      map.set(id, s);
    }
  }
  return [...map.entries()].filter(([, s]) => s.size > 1).map(([id, s]) => ({ id, types: [...s] }));
}
