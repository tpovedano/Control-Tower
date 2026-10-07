import { describe, expect, it } from "vitest";
import { formatName, isValidIdFormat, lovKey, parseIdList, parseName } from "@/lib/ids";
import { disciplineOf, disciplinesIn, parseGovernedName } from "@/lib/naming";

describe("parseName (ID al final)", () => {
  it("extrae y normaliza el ID del final", () => {
    expect(parseName("Fecha de inspección [qe-cf-001]")).toEqual({ id: "QE-CF-001", text: "Fecha de inspección", raw: "Fecha de inspección [qe-cf-001]", position: "end" });
  });
  it("tolera espacios y toma el último grupo entre corchetes", () => {
    expect(parseName("  Inspection date   [ QE-CF-001 ]  ")).toMatchObject({ id: "QE-CF-001", text: "Inspection date" });
    expect(parseName("Revisión [semanal] [HS-IT-002]")).toMatchObject({ id: "HS-IT-002", text: "Revisión [semanal]" });
  });
  it("reconoce el formato antiguo (ID al principio) para no perder lo existente", () => {
    expect(parseName("[CF-001] Fecha")).toMatchObject({ id: "CF-001", text: "Fecha", position: "start" });
  });
  it("sin corchetes → sin ID", () => {
    expect(parseName("Fecha").id).toBeNull();
    expect(parseName("Fecha [] ").id).toBeNull();
    expect(parseName(undefined).id).toBeNull();
  });
  it("mismo ID en idiomas distintos", () => {
    expect(parseName("Fecha [QE-CF-001]").id).toBe(parseName("Date [qe-cf-001]").id);
  });
});

describe("helpers", () => {
  it("formato de ID", () => {
    expect(isValidIdFormat("QE-CF-001")).toBe(true);
    expect(isValidIdFormat("CF 001")).toBe(false);
    expect(isValidIdFormat("-X")).toBe(false);
  });
  it("lista de IDs con ; o , y con nombre delante", () => {
    expect(parseIdList("[QE-CF-001]; qe-cf-002 , Fecha [QE-CF-003]")).toEqual(["QE-CF-001", "QE-CF-002", "QE-CF-003"]);
    expect(parseIdList("")).toEqual([]);
  });
  it("formatName pone el ID al final; lovKey", () => {
    expect(formatName("QE-CF-1", "Hola")).toBe("Hola [QE-CF-1]");
    expect(lovKey("qe-cf-1", "opt-1")).toBe("QE-CF-1/OPT-1");
  });
});

describe("naming convention (disciplinas)", () => {
  it("la disciplina se deduce del código que lleva el [ID], esté donde esté", () => {
    expect(disciplineOf("QE-CF-001")).toBe("QE");
    expect(disciplineOf("CF-HS-001")).toBe("HS");
    expect(disciplineOf("it.de.7")).toBe("DE");
    expect(disciplineOf("CF-001")).toBeNull();
    expect(disciplineOf("QEX-001")).toBeNull(); // solo códigos completos, no fragmentos
    expect(disciplinesIn("QE-HS-001")).toEqual(["QE", "HS"]);
    expect(disciplineOf("QE-HS-001")).toBeNull();
  });
  it("válido si el ID incluye una disciplina; no se añade ni cambia nada", () => {
    expect(parseGovernedName("Fecha [QE-CF-001]")).toMatchObject({ id: "QE-CF-001", name: "Fecha [QE-CF-001]", discipline: "QE", errors: [], warnings: [] });
    expect(parseGovernedName("Casco [CF-HS-002]")).toMatchObject({ id: "CF-HS-002", name: "Casco [CF-HS-002]", discipline: "HS" });
  });
  it("errores: sin código de disciplina, varias disciplinas, ID al principio, sin ID", () => {
    expect(parseGovernedName("Fecha [CF-001]").errors[0]).toMatch(/no cumple la naming convention/);
    expect(parseGovernedName("Fecha [CF-001]").id).toBeNull();
    expect(parseGovernedName("Fecha [QE-HS-001]").errors[0]).toMatch(/varias disciplinas/);
    expect(parseGovernedName("[QE-CF-001] Fecha").errors[0]).toMatch(/debe ir al final/);
    expect(parseGovernedName("Fecha").errors[0]).toMatch(/al final/);
  });
});
