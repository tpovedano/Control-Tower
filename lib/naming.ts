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

/** Códigos de disciplina que aparecen en un ID ("QE-CF-001", "CF-QE-001" o "QE.001" → ["QE"]). */
export function disciplinesIn(id: string | null | undefined): DisciplineCode[] {
  if (!id) return [];
  const tokens = normalizeId(id).split(/[-_.]/);
  return DISCIPLINES.filter((d) => tokens.includes(d.code)).map((d) => d.code);
}

/** Disciplina de un ID según el código que lleva dentro de los corchetes (null si no lleva ninguno o lleva varios). */
export function disciplineOf(id: string | null | undefined): DisciplineCode | null {
  const found = disciplinesIn(id);
  return found.length === 1 ? found[0] : null;
}

export function disciplineLabel(code: string | null | undefined): string {
  return DISCIPLINES.find((d) => d.code === code)?.label ?? "";
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
 * Valida el nombre de una fila nueva según la naming convention: [ID] al final y con el código de UNA disciplina
 * dentro de los corchetes. La app no añade ni cambia nada: la disciplina se deduce del propio [ID].
 */
export function parseGovernedName(rawName: string | undefined): GovernedName {
  const errors: string[] = [];
  const warnings: string[] = [];
  const p = parseName(rawName);
  const out: GovernedName = { id: null, text: p.text, name: null, discipline: null, errors, warnings };
  const codes = DISCIPLINES.map((d) => `${d.code} (${d.label})`).join(", ");

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
  if (!isValidIdFormat(p.id)) {
    errors.push(`ID “${p.id}” con formato inválido (use letras, números, “-”, “_” o “.”).`);
    return out;
  }
  const found = disciplinesIn(p.id);
  if (found.length === 0) {
    errors.push(`El [ID] “${p.id}” no cumple la naming convention: debe incluir el código de la disciplina: ${codes}.`);
    return out;
  }
  if (found.length > 1) {
    errors.push(`El [ID] “${p.id}” incluye varias disciplinas (${found.join(", ")}); debe llevar solo una.`);
    return out;
  }
  if (!p.text) warnings.push("El nombre solo contiene el [ID], sin texto descriptivo.");
  return { id: p.id, text: p.text, name: formatName(p.id, p.text), discipline: found[0], errors, warnings };
}
