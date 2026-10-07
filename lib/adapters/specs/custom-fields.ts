import { formatName, isValidIdFormat, parseName } from "@/lib/ids";
import { parseBoolean } from "@/lib/paste/parse";
import type { ObjectSpec, ValidationContext } from "../spec-types";

/**
 * Valores permitidos según el contrato de Procore (POST/PATCH custom_field_definitions → data_type).
 * Se usan como respaldo si no se pueden leer los metadatos de la company y para filtrar respuestas ambiguas.
 */
export const KNOWN_DATA_TYPES = [
  "string",
  "decimal",
  "boolean",
  "lov_entry",
  "lov_entries",
  "datetime",
  "rich_text",
  "login_information",
  "login_informations",
  "vendor",
  "location",
  "prostore_files",
];

/** Variantes permitidas por el contrato (cuáles aplican depende del data_type). */
export const KNOWN_VARIANTS = ["currency", "project_directory", "radio_button", "read_only"];

/** Alias amigables (español y nombres habituales) → data_type de Procore. */
const DATA_TYPE_ALIASES: Record<string, string> = {
  texto: "string",
  "texto corto": "string",
  text: "rich_text",
  "texto largo": "rich_text",
  "texto enriquecido": "rich_text",
  parrafo: "rich_text",
  párrafo: "rich_text",
  numero: "decimal",
  número: "decimal",
  number: "decimal",
  moneda: "decimal",
  "si/no": "boolean",
  "sí/no": "boolean",
  booleano: "boolean",
  casilla: "boolean",
  checkbox: "boolean",
  fecha: "datetime",
  date: "datetime",
  "fecha y hora": "datetime",
  lista: "lov_entry",
  "lista desplegable": "lov_entry",
  "seleccion unica": "lov_entry",
  "selección única": "lov_entry",
  "seleccion multiple": "lov_entries",
  "selección múltiple": "lov_entries",
  "lista multiple": "lov_entries",
  "lista múltiple": "lov_entries",
  usuario: "login_information",
  usuarios: "login_informations",
  empresa: "vendor",
  proveedor: "vendor",
  company: "vendor",
  ubicacion: "location",
  ubicación: "location",
  archivos: "prostore_files",
  adjuntos: "prostore_files",
  files: "prostore_files",
};

/** Alias de variantes → valor de Procore. */
const VARIANT_ALIASES: Record<string, string> = {
  moneda: "currency",
  "directorio del proyecto": "project_directory",
  directorio: "project_directory",
  "botones de opcion": "radio_button",
  "botones de opción": "radio_button",
  radio: "radio_button",
  "solo lectura": "read_only",
  "sólo lectura": "read_only",
};

export function normalizeVariant(raw: string): string {
  const v = raw.trim().toLowerCase();
  return VARIANT_ALIASES[v] ?? v.replace(/\s+/g, "_");
}

export function normalizeDataType(raw: string): string {
  const v = raw.trim().toLowerCase();
  return DATA_TYPE_ALIASES[v] ?? v.replace(/\s+/g, "_");
}

export const LOV_DATA_TYPES = ["lov_entry", "lov_entries"];

function validateDataType(dataType: string, variant: string | null, ctx: ValidationContext, errors: string[], warnings: string[]) {
  const meta = ctx.dataTypes?.length ? ctx.dataTypes : null;
  const allowed = meta ? meta.map((d) => d.dataType) : KNOWN_DATA_TYPES;
  if (!allowed.includes(dataType)) {
    errors.push(`Tipo de dato “${dataType}” no válido. Permitidos: ${allowed.join(", ")}`);
    return;
  }
  if (!variant) return;
  const specific = meta?.find((d) => d.dataType === dataType)?.variants ?? [];
  if (specific.length) {
    if (!specific.includes(variant)) errors.push(`Variante “${variant}” no válida para ${dataType}. Permitidas: ${specific.join(", ")}`);
  } else if (!KNOWN_VARIANTS.includes(variant)) {
    errors.push(`Variante “${variant}” no válida. Permitidas: ${KNOWN_VARIANTS.join(", ")} (según el tipo de dato).`);
  } else if (!meta) {
    warnings.push(`No se pudo comprobar si la variante “${variant}” aplica a ${dataType}; Procore lo validará al crear.`);
  }
}

export const customFieldsSpec: ObjectSpec = {
  type: "custom_fields",
  label: "Custom Fields",
  singular: "Custom Field",
  idPrefixExample: "CF-001",
  writable: true,
  dependsOn: [],
  columns: [
    { id: "name", label: "Nombre con [ID]", required: true, example: "[CF-001] Fecha de inspección" },
    { id: "data_type", label: "Tipo de dato", required: true, example: "datetime", hint: "string, decimal, boolean, datetime, rich_text, lov_entry, lov_entries, login_information, vendor, location…" },
    { id: "variant", label: "Variante", example: "", hint: "Opcional: currency, project_directory, radio_button, read_only" },
    { id: "description", label: "Descripción", example: "Fecha en que se realizó la inspección" },
    { id: "default_value", label: "Valor por defecto", example: "" },
    { id: "active", label: "Activo", example: "Sí", hint: "Sí/No (vacío = Sí)" },
  ],
  compareAttrs: ["data_type", "variant", "active"],
  natureAttr: "data_type",
  attrLabels: { data_type: "Tipo de dato", variant: "Variante", active: "Activo", lov_count: "Nº opciones LOV", description: "Descripción", default_value: "Valor por defecto", name: "Nombre" },
  parseRow(cells, ctx) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const parsed = parseName(cells.name);
    if (!cells.name?.trim()) errors.push("Falta el nombre.");
    else if (!parsed.id) errors.push("El nombre no incluye un [ID] entre corchetes al inicio.");
    else if (!isValidIdFormat(parsed.id)) errors.push(`ID “${parsed.id}” con formato inválido (use letras, números, “-”, “_” o “.”).`);
    if (parsed.id && !parsed.text) warnings.push("El nombre solo contiene el [ID], sin texto descriptivo.");
    const rawType = cells.data_type?.trim() ?? "";
    const dataType = rawType ? normalizeDataType(rawType) : "";
    const variant = cells.variant?.trim() ? normalizeVariant(cells.variant) : null;
    if (!dataType) errors.push("Falta el tipo de dato.");
    else validateDataType(dataType, variant, ctx, errors, warnings);
    const active = parseBoolean(cells.active, true);
    if (active === null) errors.push(`Valor de “Activo” no reconocido: “${cells.active}” (use Sí/No).`);
    if (errors.length || !parsed.id) return { errors, warnings };
    return {
      errors,
      warnings,
      desired: {
        key: parsed.id,
        stdId: parsed.id,
        name: formatName(parsed.id, parsed.text),
        attrs: { data_type: dataType, variant, active: active ?? true },
        extra: { description: cells.description?.trim() || null, default_value: cells.default_value?.trim() || null },
      },
    };
  },
};
