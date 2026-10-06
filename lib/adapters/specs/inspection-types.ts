import { formatName, isValidIdFormat, parseName } from "@/lib/ids";
import type { ObjectSpec } from "../spec-types";

export const inspectionTypesSpec: ObjectSpec = {
  type: "inspection_types",
  label: "Inspection Types",
  singular: "Inspection Type",
  idPrefixExample: "IT-001",
  writable: true,
  dependsOn: [],
  columns: [
    { id: "name", label: "Nombre con [ID]", required: true, example: "[IT-001] Inspección de seguridad" },
    { id: "grouping", label: "Agrupación", example: "Seguridad" },
  ],
  compareAttrs: ["grouping"],
  attrLabels: { grouping: "Agrupación", name: "Nombre" },
  parseRow(cells) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const parsed = parseName(cells.name);
    if (!cells.name?.trim()) errors.push("Falta el nombre.");
    else if (!parsed.id) errors.push("El nombre no incluye un [ID] entre corchetes al inicio.");
    else if (!isValidIdFormat(parsed.id)) errors.push(`ID “${parsed.id}” con formato inválido.`);
    if (errors.length || !parsed.id) return { errors, warnings };
    return {
      errors,
      warnings,
      desired: {
        key: parsed.id,
        stdId: parsed.id,
        name: formatName(parsed.id, parsed.text),
        attrs: { grouping: cells.grouping?.trim() || null },
      },
    };
  },
};
