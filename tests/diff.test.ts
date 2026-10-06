import { describe, expect, it } from "vitest";
import { SPECS } from "@/lib/adapters/specs";
import { buildMatrix, crossTypeConflicts, enrichCustomFieldsWithLov, matrixStats } from "@/lib/diff/matrix";
import { planItem } from "@/lib/diff/plan";
import type { DesiredItem, NormalizedItem } from "@/lib/types";

const cf = (key: string | null, name: string, attrs: Partial<NormalizedItem["attrs"]> = {}, remoteId = Math.random().toString()): NormalizedItem => ({
  key,
  stdId: key,
  name,
  text: name,
  remoteId,
  attrs: { data_type: "date", variant: null, active: true, ...attrs },
});

const want = (key: string, attrs: Partial<DesiredItem["attrs"]> = {}, name = `[${key}] Fecha`): DesiredItem => ({
  key,
  stdId: key,
  name,
  attrs: { data_type: "date", variant: null, active: true, ...attrs },
});

describe("planItem", () => {
  const spec = SPECS.custom_fields;

  it("CREAR si no existe el [ID]", () => {
    expect(planItem(spec, want("CF-1"), []).action).toBe("CREATE");
  });

  it("SIN CAMBIOS aunque el nombre esté en otro idioma", () => {
    const p = planItem(spec, want("CF-1"), [cf("CF-1", "[CF-1] Inspection date", {}, "99")]);
    expect(p.action).toBe("NOCHANGE");
    expect(p.remoteId).toBe("99");
  });

  it("ACTUALIZAR si cambia un atributo estructural", () => {
    const p = planItem(spec, want("CF-1", { active: false }), [cf("CF-1", "[CF-1] Date")]);
    expect(p.action).toBe("UPDATE");
    expect(p.diffs).toEqual([{ attr: "active", current: true, desired: false }]);
  });

  it("los textos solo se comparan si se pide", () => {
    const existing = [cf("CF-1", "[CF-1] Date")];
    expect(planItem(spec, want("CF-1"), existing, { includeTexts: false }).action).toBe("NOCHANGE");
    expect(planItem(spec, want("CF-1"), existing, { includeTexts: true }).action).toBe("UPDATE");
  });

  it("variante vacía en la fila = no comparar", () => {
    expect(planItem(spec, want("CF-1"), [cf("CF-1", "x", { variant: "currency" })]).action).toBe("NOCHANGE");
  });

  it("tipo de dato distinto → OMITIR con conflicto", () => {
    const p = planItem(spec, want("CF-1", { data_type: "string" }), [cf("CF-1", "x")]);
    expect(p.action).toBe("SKIP");
    expect(p.message).toMatch(/Conflicto/);
  });

  it("[ID] duplicado en la instancia → OMITIR", () => {
    const p = planItem(spec, want("CF-1"), [cf("CF-1", "a"), cf("CF-1", "b")]);
    expect(p.action).toBe("SKIP");
    expect(p.message).toMatch(/repetido 2 veces/);
  });

  it("dependencia faltante → bloqueado", () => {
    const p = planItem(SPECS.field_sets, { key: "FS-1", stdId: "FS-1", name: "[FS-1] x", attrs: { class_name: "Observation", custom_fields: ["CF-9"] } }, [], undefined, { missing: ["CF-9"] });
    expect(p.action).toBe("SKIP");
    expect(p.missingDependencies).toEqual(["CF-9"]);
    expect(p.message).toMatch(/Bloqueado por dependencia/);
  });

  it("field sets: compara el conjunto de custom fields sin importar el orden", () => {
    const fs: NormalizedItem = { key: "FS-1", stdId: "FS-1", name: "[FS-1] x", text: "x", remoteId: "1", attrs: { class_name: "Observation", custom_fields: ["CF-2", "CF-1"] } };
    const d: DesiredItem = { key: "FS-1", stdId: "FS-1", name: "[FS-1] y", attrs: { class_name: "Observation", custom_fields: ["CF-1", "CF-2"] } };
    expect(planItem(SPECS.field_sets, d, [fs]).action).toBe("NOCHANGE");
    expect(planItem(SPECS.field_sets, { ...d, attrs: { ...d.attrs, custom_fields: ["CF-1", "CF-3"] } }, [fs]).action).toBe("UPDATE");
  });

  it("solo lectura → OMITIR", () => {
    const p = planItem(SPECS.observation_types, { key: "OT-1", stdId: "OT-1", name: "[OT-1] x", attrs: { category: null, active: true } }, []);
    expect(p.action).toBe("SKIP");
  });

  it("idempotencia: re-ejecutar tras crear da SIN CAMBIOS", () => {
    const d = want("CF-1");
    expect(planItem(spec, d, []).action).toBe("CREATE");
    const after = [cf("CF-1", d.name)];
    expect(planItem(spec, d, after).action).toBe("NOCHANGE");
  });
});

describe("buildMatrix", () => {
  const spec = SPECS.custom_fields;
  const A = { instanceId: "A", available: true, items: [cf("CF-1", "[CF-1] Fecha"), cf("CF-2", "[CF-2] Estado", { data_type: "lov_entry" }), cf(null, "Huérfano")] };
  const B = { instanceId: "B", available: true, items: [cf("CF-1", "[CF-1] Date"), cf("CF-2", "[CF-2] Status", { data_type: "lov_entry", active: false })] };
  const C = { instanceId: "C", available: true, items: [cf("CF-1", "[CF-1] Data"), cf("CF-1", "[CF-1] Data bis")] };

  it("alinea por [ID] aunque los nombres estén en distinto idioma", () => {
    const rows = buildMatrix({ spec, instances: [A, B] });
    const r1 = rows.find((r) => r.key === "CF-1")!;
    expect(r1.cells.A?.status).toBe("aligned");
    expect(r1.cells.B?.status).toBe("aligned");
    expect(r1.cells.B?.names).toEqual(["[CF-1] Date"]);
  });

  it("falta / difiere / huérfano / conflicto", () => {
    const rows = buildMatrix({ spec, instances: [A, B, C], goldenInstanceId: "A" });
    const r2 = rows.find((r) => r.key === "CF-2")!;
    expect(r2.referenceSource).toBe("golden");
    expect(r2.cells.B?.status).toBe("differs");
    expect(r2.cells.B?.diffs[0].attr).toBe("active");
    expect(r2.cells.C?.status).toBe("missing");
    const r1 = rows.find((r) => r.key === "CF-1")!;
    expect(r1.cells.C?.status).toBe("conflict");
    expect(r1.alerts.length).toBeGreaterThan(0);
    const orphan = rows.find((r) => r.orphan)!;
    expect(orphan.cells.A?.status).toBe("orphan");
  });

  it("consenso cuando no hay referencia", () => {
    const D = { instanceId: "D", available: true, items: [cf("CF-2", "x", { data_type: "lov_entry", active: false })] };
    const rows = buildMatrix({ spec, instances: [A, B, D] });
    const r2 = rows.find((r) => r.key === "CF-2")!;
    expect(r2.referenceSource).toBe("consensus");
    expect(r2.cells.A?.status).toBe("differs"); // B y D (inactivos) son mayoría
  });

  it("catálogo maestro como referencia e IDs que no existen en ninguna instancia", () => {
    const catalog = new Map([["CF-9", cf("CF-9", "[CF-9] Nuevo")]]);
    const rows = buildMatrix({ spec, instances: [A], catalog });
    expect(rows.find((r) => r.key === "CF-9")?.cells.A?.status).toBe("missing");
  });

  it("naturaleza distinta → alerta", () => {
    const X = { instanceId: "X", available: true, items: [cf("CF-1", "x", { data_type: "string" })] };
    const rows = buildMatrix({ spec, instances: [A, X] });
    expect(rows.find((r) => r.key === "CF-1")!.alerts.join()).toMatch(/naturaleza/);
  });

  it("estadísticas", () => {
    const rows = buildMatrix({ spec, instances: [A, B], goldenInstanceId: "A" });
    const s = matrixStats(rows, ["A", "B"]);
    expect(s.totalIds).toBe(2);
    expect(s.orphans).toBe(1);
    expect(s.perInstance.A.pct).toBe(100);
    expect(s.perInstance.B.pct).toBe(50);
    expect(s.alignmentPct).toBe(75);
  });

  it("instancia sin snapshot → celdas sin datos", () => {
    const rows = buildMatrix({ spec, instances: [A, { instanceId: "Z", available: false, items: [] }] });
    expect(rows.find((r) => r.key === "CF-1")!.cells.Z).toBeUndefined();
  });

  it("LOV enriquece custom fields con el conjunto de opciones", () => {
    const parent = cf("CF-2", "x", { data_type: "lov_entry" }, "10");
    const lov: NormalizedItem = { key: "CF-2/OK", stdId: "OK", parentKey: "CF-2", name: "[OK] Sí", text: "Sí", remoteId: "1", parentRemoteId: "10", attrs: { active: true } };
    const [e] = enrichCustomFieldsWithLov([parent], [lov]);
    expect(e.attrs.lov_options).toEqual(["OK"]);
    const [empty] = enrichCustomFieldsWithLov([parent], []);
    expect(empty.attrs.lov_options).toEqual([]);
  });

  it("conflictos entre tipos", () => {
    expect(crossTypeConflicts({ custom_fields: ["X-1", "A"], inspection_types: ["X-1"], lov_entries: ["A"] })).toEqual([{ id: "X-1", types: ["custom_fields", "inspection_types"] }]);
  });
});
