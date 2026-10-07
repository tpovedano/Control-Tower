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
  it("custom fields: válido, sin ID, ID al principio, tipo inválido, duplicados", () => {
    const rows = [
      ["Fecha [QE-CF-001]", "date", "", "", "", "Sí"],
      ["Sin corchetes", "date"],
      ["Otro [QE-CF-002]", "foo"],
      ["Uno [QE-CF-003]", "Texto"],
      ["Dos [qe-cf-003]", "string"],
      ["[QE-CF-004] Antiguo", "string"],
    ];
    const r = validateBatch("custom_fields", rows, { dataTypes: [{ dataType: "datetime", variants: [] }, { dataType: "string", variants: [] }] });
    expect(r[0].status).toBe("valid");
    expect(r[0].desired).toMatchObject({ key: "QE-CF-001", name: "Fecha [QE-CF-001]", attrs: { data_type: "datetime", variant: null, active: true } });
    expect(r[1].status).toBe("error");
    expect(r[1].messages[0]).toMatch(/\[ID\]/);
    expect(r[2].status).toBe("error");
    expect(r[3].status).toBe("error");
    expect(r[3].messages[0]).toMatch(/duplicado/);
    expect(r[4].status).toBe("error");
    expect(r[5].messages[0]).toMatch(/debe ir al final/);
  });
  it("disciplina: se deduce del [ID] (columna automática), nunca se añade al ID", () => {
    const r = validateBatch("custom_fields", [
      ["Fecha [QE-CF-010]", "datetime", "", "", "", "", "HS"], // lo pegado en Disciplina se ignora
      ["Casco [CF-HS-011]", "boolean"],
      ["Sin disciplina [CF-013]", "string", "", "", "", "", "QE"],
      ["Dos disciplinas [QE-DE-014]", "string"],
    ]);
    expect(r[0]).toMatchObject({ status: "valid", desired: { key: "QE-CF-010", name: "Fecha [QE-CF-010]" }, derived: { discipline: "QE — Calidad y Medioambiente" } });
    expect(r[1]).toMatchObject({ status: "valid", desired: { key: "CF-HS-011" }, derived: { discipline: "HS — Seguridad y Salud" } });
    expect(r[2].status).toBe("error");
    expect(r[2].messages[0]).toMatch(/naming convention/);
    expect(r[2].derived?.discipline).toBe("");
    expect(r[3].status).toBe("error");
  });
  it("alias de tipo de dato y lista oficial de respaldo sin metadatos", () => {
    const r = validateBatch("custom_fields", [
      ["Lista [QE-CF-9]", "Lista desplegable"],
      ["Raro [QE-CF-8]", "rarito"],
      ["Grupo [QE-CF-7]", "all"],
      ["Fecha [QE-CF-6]", "fecha"],
      ["Notas [QE-CF-5]", "texto largo"],
      ["Importe [QE-CF-4]", "número", "moneda"],
      ["Mal [QE-CF-3]", "decimal", "inventada"],
    ]);
    expect(r[0].desired?.attrs.data_type).toBe("lov_entry");
    expect(r[1].status).toBe("error");
    expect(r[2].status).toBe("error");
    expect(r[2].messages[0]).toMatch(/Permitidos: string, decimal/);
    expect(r[3].desired?.attrs.data_type).toBe("datetime");
    expect(r[4].desired?.attrs.data_type).toBe("rich_text");
    expect(r[5].desired?.attrs).toMatchObject({ data_type: "decimal", variant: "currency" });
    expect(r[6].status).toBe("error");
  });
  it("variante específica del tipo según metadatos", () => {
    const ctx = { dataTypes: [{ dataType: "decimal", variants: ["currency"] }, { dataType: "string", variants: [] }] };
    expect(validateBatch("custom_fields", [["A [QE-CF-1]", "decimal", "currency"]], ctx)[0].status).toBe("valid");
    expect(validateBatch("custom_fields", [["A [QE-CF-1]", "decimal", "radio_button"]], ctx)[0].status).toBe("error");
    expect(validateBatch("custom_fields", [["A [QE-CF-1]", "string", "read_only"]], ctx)[0].status).toBe("valid");
  });
  it("LOV: ID al final, llave compuesta y dependencia desconocida como advertencia", () => {
    const r = validateBatch("lov_entries", [["[QE-CF-010]", "Conforme [OPT-01]"], ["QE-CF-010", "No conforme [OPT-02]"], ["[QE-CF-010]", "[OPT-03] Antiguo"]], {
      known: { custom_fields: ["QE-CF-001"] },
    });
    expect(r[0].desired).toMatchObject({ key: "QE-CF-010/OPT-01", name: "Conforme [OPT-01]" });
    expect(r[1].desired?.parentKey).toBe("QE-CF-010");
    expect(r[0].status).toBe("warning");
    expect(r[2].status).toBe("error");
  });
  it("LOV: mismo ID de opción en distintos padres no es duplicado", () => {
    const r = validateBatch("lov_entries", [["[QE-CF-1]", "Sí [SI]"], ["[QE-CF-2]", "Sí [SI]"]]);
    expect(r.every((x) => x.status === "valid")).toBe(true);
  });
  it("field sets: lista de custom fields y secciones", () => {
    const r = validateBatch("field_sets", [["Calidad [QE-FS-1]", "Observation | Quality", "[QE-CF-001];[QE-CF-002]", "A: [QE-CF-001] | B: [QE-CF-002]"]]);
    expect(r[0].desired?.attrs).toMatchObject({ class_name: "Observations::Item", scope: "quality", custom_fields: ["QE-CF-001", "QE-CF-002"] });
    expect(r[0].desired?.extra?.sections).toEqual([
      { name: "A", ids: ["QE-CF-001"] },
      { name: "B", ids: ["QE-CF-002"] },
    ]);
    const bad = validateBatch("field_sets", [["X [QE-FS-2]", "", ""]]);
    expect(bad[0].status).toBe("error");
    // Clases oficiales: Observations::Item (exige categoría), PunchItem, Rfi::Header
    const cls = validateBatch("field_sets", [
      ["A [QE-FS-3]", "Observations::Item", "[QE-CF-1]"],
      ["B [QE-FS-4]", "PunchItem", "[QE-CF-1]"],
      ["C [DE-FS-5]", "RFI", "[QE-CF-1]"],
      ["D [QE-FS-6]", "Inspection", "[QE-CF-1]"],
    ]);
    expect(cls[0].status).toBe("error");
    expect(cls[0].messages.join()).toMatch(/categoría/);
    expect(cls[1].status).toBe("valid");
    expect(cls[2].desired?.attrs.class_name).toBe("Rfi::Header");
    expect(cls[3].messages.join()).toMatch(/no válida/);
    const cat = validateBatch("field_sets", [["E [QE-FS-7]", "Observaciones | Inventada", "[QE-CF-1]"], ["F [QE-FS-8]", "Observaciones | Calidad", "[QE-CF-1]"]]);
    expect(cat[0].messages.join()).toMatch(/Categoría de observación/);
    expect(cat[1].desired?.attrs).toMatchObject({ class_name: "Observations::Item", scope: "quality" });
  });
  it("inspection types: el ID se respeta tal cual", () => {
    const r = validateBatch("inspection_types", [["Seguridad [HS-IT-001]", "HSE"]]);
    expect(r[0].desired).toMatchObject({ key: "HS-IT-001", name: "Seguridad [HS-IT-001]", attrs: { grouping: "HSE" } });
    expect(r[0].derived?.discipline).toMatch(/^HS/);
  });
  it("límite de filas", () => {
    const rows = Array.from({ length: 3 }, (_, i) => [`X [HS-IT-${i}]`]);
    const r = validateBatch("inspection_types", rows, {}, 2);
    expect(r[2].status).toBe("error");
  });
});
