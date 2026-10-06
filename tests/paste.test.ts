import { describe, expect, it } from "vitest";
import { looksLikeHeader, parseBoolean, parseClipboard, toCsv } from "@/lib/paste/parse";
import { validateBatch } from "@/lib/adapters/validate";

describe("parseClipboard", () => {
  it("divide por \\n y \\t (formato Excel)", () => {
    const text = "[CF-001] Fecha\tdate\t\tDesc\t\tSí\r\n[CF-002] Estado\tlov_entry\t\t\t\tNo\r\n";
    expect(parseClipboard(text)).toEqual([
      ["[CF-001] Fecha", "date", "", "Desc", "", "Sí"],
      ["[CF-002] Estado", "lov_entry", "", "", "", "No"],
    ]);
  });
  it("una sola columna", () => {
    expect(parseClipboard("[IT-1] A\n[IT-2] B\n")).toEqual([["[IT-1] A"], ["[IT-2] B"]]);
  });
  it("celdas entrecomilladas con saltos de línea", () => {
    expect(parseClipboard('"[CF-1] Multi\nlínea"\tstring\n')).toEqual([["[CF-1] Multi\nlínea", "string"]]);
  });
  it("ignora filas vacías", () => {
    expect(parseClipboard("\n\nA\tB\n\t\n")).toEqual([["A", "B"]]);
  });
  it("detecta cabecera", () => {
    expect(looksLikeHeader(["Nombre con [ID]", "Tipo de dato"], ["Nombre con [ID]", "Tipo de dato", "Activo"])).toBe(true);
    expect(looksLikeHeader(["[CF-1] X", "date"], ["Nombre con [ID]", "Tipo de dato"])).toBe(false);
  });
  it("booleanos", () => {
    expect(parseBoolean("Sí")).toBe(true);
    expect(parseBoolean("no")).toBe(false);
    expect(parseBoolean("")).toBe(true);
    expect(parseBoolean("quizás")).toBeNull();
  });
  it("CSV escapa comillas y separadores", () => {
    expect(toCsv([["a", 'b"c', "d,e"]])).toBe('﻿a,"b""c","d,e"');
  });
});

describe("validateBatch", () => {
  it("custom fields: válido, sin ID, tipo inválido, duplicados", () => {
    const rows = [
      ["[CF-001] Fecha", "date", "", "", "", "Sí"],
      ["Sin corchetes", "date"],
      ["[CF-002] Otro", "foo"],
      ["[CF-003] Uno", "Texto"],
      ["[cf-003] Dos", "string"],
    ];
    const r = validateBatch("custom_fields", rows, { dataTypes: [{ dataType: "date", variants: [] }, { dataType: "string", variants: [] }] });
    expect(r[0].status).toBe("valid");
    expect(r[0].desired?.attrs).toEqual({ data_type: "date", variant: null, active: true });
    expect(r[1].status).toBe("error");
    expect(r[1].messages[0]).toMatch(/\[ID\]/);
    expect(r[2].status).toBe("error");
    expect(r[3].status).toBe("error");
    expect(r[3].messages[0]).toMatch(/duplicado/);
    expect(r[4].status).toBe("error");
  });
  it("alias de tipo de dato y advertencia sin metadatos", () => {
    const r = validateBatch("custom_fields", [["[CF-9] Lista", "Lista desplegable"], ["[CF-8] Raro", "rarito"]]);
    expect(r[0].desired?.attrs.data_type).toBe("lov_entry");
    expect(r[1].status).toBe("warning");
  });
  it("LOV: llave compuesta y dependencia desconocida como advertencia", () => {
    const r = validateBatch("lov_entries", [["[CF-010]", "[OPT-01] Conforme"], ["CF-010", "[OPT-02] No conforme"]], { known: { custom_fields: ["CF-001"] } });
    expect(r[0].desired?.key).toBe("CF-010/OPT-01");
    expect(r[1].desired?.parentKey).toBe("CF-010");
    expect(r[0].status).toBe("warning");
  });
  it("LOV: mismo ID de opción en distintos padres no es duplicado", () => {
    const r = validateBatch("lov_entries", [["[CF-1]", "[SI] Sí"], ["[CF-2]", "[SI] Sí"]]);
    expect(r.every((x) => x.status === "valid")).toBe(true);
  });
  it("field sets: lista de custom fields y secciones", () => {
    const r = validateBatch("field_sets", [["[FS-1] Calidad", "Observation", "[CF-001];[CF-002]", "A: [CF-001] | B: [CF-002]"]]);
    expect(r[0].desired?.attrs.custom_fields).toEqual(["CF-001", "CF-002"]);
    expect(r[0].desired?.extra?.sections).toEqual([
      { name: "A", ids: ["CF-001"] },
      { name: "B", ids: ["CF-002"] },
    ]);
    const bad = validateBatch("field_sets", [["[FS-2] X", "", ""]]);
    expect(bad[0].status).toBe("error");
  });
  it("límite de filas", () => {
    const rows = Array.from({ length: 3 }, (_, i) => [`[IT-${i}] X`]);
    const r = validateBatch("inspection_types", rows, {}, 2);
    expect(r[2].status).toBe("error");
  });
});
