import { describe, expect, it } from "vitest";
import { formatName, isValidIdFormat, lovKey, parseIdList, parseName } from "@/lib/ids";
import { disciplineOf, parseDiscipline, parseGovernedName } from "@/lib/naming";

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
  it("disciplina del ID y alias", () => {
    expect(disciplineOf("QE-CF-001")).toBe("QE");
    expect(disciplineOf("HS.IT.1")).toBe("HS");
    expect(disciplineOf("CF-001")).toBeNull();
    expect(parseDiscipline("Calidad y Medioambiente")).toBe("QE");
    expect(parseDiscipline("seguridad")).toBe("HS");
    expect(parseDiscipline("DE — Oficina Técnica")).toBe("DE");
    expect(parseDiscipline("xx")).toBe("invalid");
    expect(parseDiscipline("")).toBeNull();
  });
  it("válido si el ID ya lleva la disciplina", () => {
    expect(parseGovernedName("Fecha [QE-CF-001]", "")).toMatchObject({ id: "QE-CF-001", name: "Fecha [QE-CF-001]", discipline: "QE", errors: [] });
  });
  it("antepone la disciplina elegida si el ID no la lleva (con aviso)", () => {
    const r = parseGovernedName("Fecha [CF-001]", "HS");
    expect(r).toMatchObject({ id: "HS-CF-001", name: "Fecha [HS-CF-001]", discipline: "HS", errors: [] });
    expect(r.warnings[0]).toMatch(/Se añadirá la disciplina/);
  });
  it("errores: sin disciplina, disciplina contradictoria, ID al principio, sin ID", () => {
    expect(parseGovernedName("Fecha [CF-001]", "").errors[0]).toMatch(/Falta la disciplina/);
    expect(parseGovernedName("Fecha [QE-CF-001]", "DE").errors[0]).toMatch(/es de QE/);
    expect(parseGovernedName("[QE-CF-001] Fecha", "").errors[0]).toMatch(/debe ir al final/);
    expect(parseGovernedName("Fecha", "QE").errors[0]).toMatch(/al final/);
    expect(parseGovernedName("Fecha [QE-CF-001]", "Marketing").errors[0]).toMatch(/no válida/);
  });
});
