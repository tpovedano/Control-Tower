import { isValidIdFormat, parseIdList } from "@/lib/ids";
import { parseGovernedName } from "@/lib/naming";
import type { ObjectSpec } from "../spec-types";

export interface SectionSpec {
  name: string;
  ids: string[];
}

/**
 * Columna “Secciones”: vacía → una sección “General” con todos los custom fields;
 * “Nombre” → una sección con ese nombre; “Sección A: [CF-1],[CF-2] | Sección B: [CF-3]” → varias secciones.
 */
export function parseSections(raw: string | undefined, allIds: string[]): { sections: SectionSpec[]; errors: string[] } {
  const value = raw?.trim() ?? "";
  if (!value) return { sections: allIds.length ? [{ name: "General", ids: allIds }] : [], errors: [] };
  if (!value.includes(":")) return { sections: [{ name: value, ids: allIds }], errors: [] };
  const errors: string[] = [];
  const sections: SectionSpec[] = [];
  for (const part of value.split("|")) {
    const idx = part.indexOf(":");
    if (idx < 0) {
      errors.push(`Sección mal formada: “${part.trim()}” (use “Nombre: [ID],[ID]”).`);
      continue;
    }
    const name = part.slice(0, idx).trim();
    const ids = parseIdList(part.slice(idx + 1));
    if (!name) errors.push("Hay una sección sin nombre.");
    sections.push({ name, ids });
  }
  return { sections, errors };
}

/** Valores permitidos de configurable_field_set.class_name según el contrato de Procore. */
export const FIELD_SET_CLASSES = [
  { value: "Observations::Item", label: "Observaciones", requiresScope: true },
  { value: "PunchItem", label: "Punch List", requiresScope: false },
  { value: "Rfi::Header", label: "RFI", requiresScope: false },
] as const;

/** Convierte alias habituales ("Observation", "Observaciones", "Punch", "RFI"…) al class_name oficial. */
export function normalizeClassName(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  const exact = FIELD_SET_CLASSES.find((c) => c.value.toLowerCase() === v.toLowerCase());
  if (exact) return exact.value;
  const k = v.toLowerCase().replace(/[^a-z]/g, "");
  if (k.startsWith("observ")) return "Observations::Item";
  if (k.startsWith("punch")) return "PunchItem";
  if (k.startsWith("rfi")) return "Rfi::Header";
  return v;
}

/**
 * Categorías de Observaciones (configurable_field_set.category). Coinciden con las columnas de field set por
 * defecto de la company ("<categoría>_configurable_field_set").
 */
export const OBSERVATION_CATEGORIES = [
  { value: "quality", label: "Calidad" },
  { value: "safety", label: "Seguridad" },
  { value: "commissioning", label: "Puesta en marcha" },
  { value: "warranty", label: "Garantía" },
  { value: "work_to_complete", label: "Trabajo pendiente" },
] as const;

/** "Quality", "Calidad", "work to complete"… → valor de Procore ("quality", "work_to_complete"…). */
export function normalizeObservationCategory(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const k = v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\s-]+/g, "_");
  const byValue = OBSERVATION_CATEGORIES.find((c) => c.value === k);
  if (byValue) return byValue.value;
  const byLabel = OBSERVATION_CATEGORIES.find((c) => c.label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\s-]+/g, "_") === k);
  if (byLabel) return byLabel.value;
  if (k.startsWith("calidad")) return "quality";
  if (k.startsWith("seguridad")) return "safety";
  if (k.startsWith("puesta") || k.startsWith("commission")) return "commissioning";
  if (k.startsWith("garant")) return "warranty";
  if (k.startsWith("trabajo") || k.startsWith("work")) return "work_to_complete";
  return k;
}

export function observationCategoryLabel(value: string): string {
  return OBSERVATION_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

export function classLabel(className: string): string {
  return FIELD_SET_CLASSES.find((c) => c.value === className)?.label ?? className;
}

/** Celda "Clase/Herramienta": "class_name" o "class_name | categoría/tipo". */
export function parseClassCell(raw: string | undefined): { className: string; scope: string | null } {
  const v = (raw ?? "").trim();
  const i = v.indexOf(" | ");
  if (i < 0) return { className: normalizeClassName(v), scope: null };
  const className = normalizeClassName(v.slice(0, i));
  const rawScope = v.slice(i + 3).trim() || null;
  // En Observaciones el ámbito es la categoría (category): se normaliza al valor de Procore.
  return { className, scope: className === "Observations::Item" ? normalizeObservationCategory(rawScope) : rawScope };
}

export function templateCell(className: string, scope: string | null): string {
  return scope ? `${className} | ${scope}` : className;
}

export const fieldSetsSpec: ObjectSpec = {
  type: "field_sets",
  label: "Field Sets",
  singular: "Field Set",
  idPrefixExample: "QE-FS-001",
  writable: true,
  dependsOn: ["custom_fields"],
  columns: [
    { id: "name", label: "Nombre con [ID]", required: true, example: "Inspección de calidad [QE-FS-001]" },
    {
      id: "class_name",
      label: "Clase/Herramienta",
      required: true,
      example: "Observations::Item | quality",
      hint: "Observations::Item | <categoría> (quality, safety, commissioning, warranty, work_to_complete), PunchItem o Rfi::Header.",
      input: "select",
      optionsKey: "fieldSetTemplates",
    },
    { id: "custom_fields", label: "Custom fields incluidos", required: true, example: "[QE-CF-001];[QE-CF-002]", input: "multiselect", optionsKey: "customFields" },
    { id: "sections", label: "Secciones", example: "General", hint: "Opcional. “Nombre” o “Sección A: [QE-CF-001] | Sección B: [QE-CF-002]”" },
    { id: "discipline", label: "Disciplina", example: "QE", hint: "QE Calidad y Medioambiente · HS Seguridad y Salud · DE Oficina Técnica. Opcional si el [ID] ya empieza por el código.", input: "select", optionsKey: "disciplines" },
  ],
  compareAttrs: ["class_name", "scope", "custom_fields"],
  natureAttr: "class_name",
  attrLabels: { class_name: "Clase/Herramienta", scope: "Categoría / tipo", custom_fields: "Custom fields", name: "Nombre" },
  parseRow(cells, ctx) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const parsed = parseGovernedName(cells.name, cells.discipline);
    errors.push(...parsed.errors);
    warnings.push(...parsed.warnings);
    const { className, scope } = parseClassCell(cells.class_name);
    const allowed = FIELD_SET_CLASSES.find((c) => c.value === className);
    if (!className) errors.push("Falta la clase/herramienta.");
    else if (!allowed) errors.push(`Clase “${className}” no válida. Permitidas: ${FIELD_SET_CLASSES.map((c) => `${c.value} (${c.label})`).join(", ")}.`);
    else if (allowed.requiresScope && !scope) {
      errors.push(`Para ${allowed.label} hay que indicar la categoría: “${className} | <categoría>” (elígela en el desplegable).`);
    } else if (className === "Observations::Item" && scope && !OBSERVATION_CATEGORIES.some((c) => c.value === scope)) {
      errors.push(`Categoría de observación “${scope}” no válida. Permitidas: ${OBSERVATION_CATEGORIES.map((c) => `${c.value} (${c.label})`).join(", ")}.`);
    }
    let ids = parseIdList(cells.custom_fields);
    const { sections, errors: secErrors } = parseSections(cells.sections, ids);
    errors.push(...secErrors);
    if (cells.sections?.includes(":")) {
      const fromSections = sections.flatMap((s) => s.ids);
      ids = Array.from(new Set([...ids, ...fromSections]));
      const notInList = fromSections.filter((id) => !parseIdList(cells.custom_fields).includes(id));
      if (notInList.length && cells.custom_fields?.trim()) warnings.push(`Las secciones incluyen IDs no listados en “Custom fields”: ${notInList.join(", ")}.`);
    }
    if (!ids.length) errors.push("Indica al menos un custom field ([ID] separados por “;” o “,”).");
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dup.length) warnings.push(`Custom fields repetidos: ${Array.from(new Set(dup)).join(", ")}.`);
    const invalid = ids.filter((id) => !isValidIdFormat(id));
    if (invalid.length) errors.push(`IDs con formato inválido: ${invalid.join(", ")}.`);
    const known = ctx.known?.custom_fields;
    if (known) {
      const missing = ids.filter((id) => !known.includes(id));
      if (missing.length) warnings.push(`Custom fields no encontrados en las instancias sincronizadas: ${missing.join(", ")}. Se comprobará por instancia.`);
    }
    if (errors.length || !parsed.id || !parsed.name) return { errors, warnings };
    const uniq = Array.from(new Set(ids));
    return {
      errors,
      warnings,
      desired: {
        key: parsed.id,
        stdId: parsed.id,
        name: parsed.name,
        attrs: { class_name: className, scope, custom_fields: uniq },
        extra: { sections, sectionsExplicit: !!cells.sections?.trim() },
      },
    };
  },
};
