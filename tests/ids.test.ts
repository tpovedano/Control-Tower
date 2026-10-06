import { describe, expect, it } from "vitest";
import { formatName, isValidIdFormat, lovKey, parseIdList, parseName } from "@/lib/ids";

describe("parseName", () => {
  it("extrae y normaliza el ID", () => {
    expect(parseName("[cf-001] Fecha de inspección")).toEqual({ id: "CF-001", text: "Fecha de inspección", raw: "[cf-001] Fecha de inspección" });
  });
  it("tolera espacios", () => {
    expect(parseName("   [ CF-001 ]   Inspection date ").id).toBe("CF-001");
    expect(parseName("   [ CF-001 ]   Inspection date ").text).toBe("Inspection date");
  });
  it("sin corchetes → sin ID", () => {
    expect(parseName("Fecha").id).toBeNull();
    expect(parseName("Fecha [CF-1]").id).toBeNull();
    expect(parseName("[] Vacío").id).toBeNull();
    expect(parseName(undefined).id).toBeNull();
  });
  it("mismo ID en idiomas distintos", () => {
    expect(parseName("[CF-001] Fecha").id).toBe(parseName("[cf-001] Date").id);
  });
});

describe("helpers", () => {
  it("formato de ID", () => {
    expect(isValidIdFormat("CF-001")).toBe(true);
    expect(isValidIdFormat("CF 001")).toBe(false);
    expect(isValidIdFormat("-X")).toBe(false);
  });
  it("lista de IDs con ; o ,", () => {
    expect(parseIdList("[CF-001]; cf-002 ,[CF-003]")).toEqual(["CF-001", "CF-002", "CF-003"]);
    expect(parseIdList("")).toEqual([]);
  });
  it("formatName y lovKey", () => {
    expect(formatName("CF-1", "Hola")).toBe("[CF-1] Hola");
    expect(lovKey("cf-1", "opt-1")).toBe("CF-1/OPT-1");
  });
});
