import { formatName, isValidIdFormat, parseName } from "@/lib/ids";
import { parseBoolean } from "@/lib/paste/parse";
import type { ObjectSpec, ValidationContext } from "../spec-types";

/** Tipos de dato conocidos de Procore (fallback si no se pudieron leer los metadatos). */
export const KNOWN_DATA_TYPES = [
  "string",
  "text",
  "decimal",
  "boolean",
  "date",
  "datetime",
  "lov_entry",
  "lov_entries",
  "login_information",
  "login_informations",
  "company",
  "companies",
  "location",
];

/** Alias amigables (español) → data_type de Procore. */
const DATA_TYPE_ALIASES: Record<string, string> = {
  texto: "string",
  "texto corto": "string",
  "texto largo": "text",
  parrafo: "text",
  párrafo: "text",
  numero: "decimal",
  número: "decimal",
  "si/no": "boolean",
  "sí/no": "boolean",
  booleano: "boolean",
  casilla: "boolean",
  fecha: "date",
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
  empresa: "company",
  empresas: "companies",
  ubicacion: "location",
  ubicación: "location",
};

export function normalizeDataType(raw: string): string {
  const v = raw.trim().toLowerCase();
  return DATA_TYPE_ALIASES[v] ?? v.replace(/\s+/g, "_");
}

export const LOV_DATA_TYPES = ["lov_entry", "lov_entries"];

function validateDataType(dataType: string, variant: string | null, ctx: ValidationContext, errors: string[], warnings: string[]) {
  const meta = ctx.dataTypes?.length ? ctx.dataTypes : null;
  if (meta) {
    const found = meta.find((d) => d.dataType === dataType);
    if (!found) {
      errors.push(`Tipo de dato “${dataType}” no válido. Permitidos: ${meta.map((d) => d.dataType).join(", ")}`);
      return;
    }
    if (variant && found.variants.length && !found.variants.includes(variant)) {
      errors.push(`Variante “${variant}” no válida para ${dataType}. Permitidas: ${found.variants.join(", ")}`);
    }
  } else if (!KNOWN_DATA_TYPES.includes(dataType)) {
    warnings.push(`Tipo de dato “${dataType}” desconocido (no se pudieron leer los metadatos de Procore para validarlo).`);
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
    { id: "data_type", label: "Tipo de dato", required: true, example: "date", hint: "string, text, decimal, boolean, date, lov_entry, lov_entries…" },
    { id: "variant", label: "Variante", example: "" },
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
    const variant = cells.variant?.trim() || null;
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
