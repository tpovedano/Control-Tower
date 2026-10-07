import { formatName, isValidIdFormat, normalizeId, parseName } from "@/lib/ids";
import type { SelectOption } from "@/lib/types";

/**
 * Naming convention: el [ID] (al final del nombre) empieza por el código de la disciplina.
 *   Calidad y Medioambiente → QE   ·   Seguridad y Salud → HS   ·   Oficina Técnica → DE
 * Ejemplo: "Fecha de inspección [QE-CF-001]". Para añadir una disciplina basta con añadirla aquí.
 */
export const DISCIPLINES = [
  { code: "QE", label: "Calidad y Medioambiente" },
  { code: "HS", label: "Seguridad y Salud" },
  { code: "DE", label: "Oficina Técnica" },
] as const;

export type DisciplineCode = (typeof DISCIPLINES)[number]["code"];

export const DISCIPLINE_OPTIONS: SelectOption[] = DISCIPLINES.map((d) => ({ value: d.code, label: `${d.code} — ${d.label}` }));

/** Disciplina de un ID por su prefijo ("QE-CF-001" → "QE"), o null. */
export function disciplineOf(id: string | null | undefined): DisciplineCode | null {
  if (!id) return null;
  const head = normalizeId(id).split(/[-_.]/)[0];
  return (DISCIPLINES.find((d) => d.code === head)?.code as DisciplineCode) ?? null;
}

export function disciplineLabel(code: string | null | undefined): string {
  return DISCIPLINES.find((d) => d.code === code)?.label ?? "";
}

/** Acepta el código ("QE") o el nombre ("Calidad y Medioambiente", "seguridad"…). */
export function parseDiscipline(raw: string | null | undefined): DisciplineCode | null | "invalid" {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const up = v.toUpperCase();
  const byCode = DISCIPLINES.find((d) => up === d.code || up.startsWith(`${d.code} `) || up.startsWith(`${d.code}—`) || up.startsWith(`${d.code} —`));
  if (byCode) return byCode.code;
  const low = v.toLowerCase();
  if (low.startsWith("calidad") || low.includes("medioambiente") || low.includes("medio ambiente")) return "QE";
  if (low.startsWith("seguridad") || low.includes("salud")) return "HS";
  if (low.startsWith("oficina")) return "DE";
  return "invalid";
}

export interface GovernedName {
  id: string | null;
  text: string;
  /** Nombre final que se escribirá en Procore: "Texto [ID]". */
  name: string | null;
  discipline: DisciplineCode | null;
  errors: string[];
  warnings: string[];
}

/**
 * Valida el nombre de una fila nueva según las reglas: [ID] al final y con el código de disciplina.
 * Si se elige la disciplina y el ID no la lleva, se antepone automáticamente (aviso).
 */
export function parseGovernedName(rawName: string | undefined, rawDiscipline: string | undefined): GovernedName {
  const errors: string[] = [];
  const warnings: string[] = [];
  const p = parseName(rawName);
  const out: GovernedName = { id: null, text: p.text, name: null, discipline: null, errors, warnings };

  if (!rawName?.trim()) {
    errors.push("Falta el nombre.");
    return out;
  }
  if (!p.id) {
    errors.push("El nombre no incluye un [ID] entre corchetes al final, p. ej. “Fecha de inspección [QE-CF-001]”.");
    return out;
  }
  if (p.position === "start") {
    errors.push(`El [ID] debe ir al final del nombre: “${p.text || "Nombre"} [${p.id}]”.`);
    return out;
  }
  if (!p.text) warnings.push("El nombre solo contiene el [ID], sin texto descriptivo.");

  const chosen = parseDiscipline(rawDiscipline);
  if (chosen === "invalid") {
    errors.push(`Disciplina “${rawDiscipline}” no válida. Usa: ${DISCIPLINES.map((d) => `${d.code} (${d.label})`).join(", ")}.`);
    return out;
  }
  const inId = disciplineOf(p.id);
  let id = p.id;
  if (chosen && inId && chosen !== inId) {
    errors.push(`El [ID] ${p.id} es de ${inId} (${disciplineLabel(inId)}) pero la disciplina elegida es ${chosen} (${disciplineLabel(chosen)}).`);
    return out;
  }
  if (chosen && !inId) {
    id = `${chosen}-${p.id}`;
    warnings.push(`Se añadirá la disciplina al [ID]: se creará como “${formatName(id, p.text)}”.`);
  }
  const discipline = chosen || inId;
  if (!discipline) {
    errors.push(`Falta la disciplina: elígela en la columna “Disciplina” o empieza el [ID] por ${DISCIPLINES.map((d) => d.code).join(", ")} (p. ej. [QE-${p.id}]).`);
    return out;
  }
  if (!isValidIdFormat(id)) {
    errors.push(`ID “${id}” con formato inválido (use letras, números, “-”, “_” o “.”).`);
    return out;
  }
  return { id, text: p.text, name: formatName(id, p.text), discipline, errors, warnings };
}
