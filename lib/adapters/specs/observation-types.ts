import { formatName, isValidIdFormat, parseName } from "@/lib/ids";
import type { ObjectSpec } from "../spec-types";

export const observationTypesSpec: ObjectSpec = {
  type: "observation_types",
  label: "Observation Types",
  singular: "Observation Type",
  idPrefixExample: "OT-001",
  writable: false,
  readOnlyReason:
    "La API pública de Procore solo expone GET para Observation Types a nivel company (crear/editar existe únicamente a nivel proyecto). Se gobiernan en modo solo lectura.",
  dependsOn: [],
  columns: [
    { id: "name", label: "Nombre con [ID]", required: true, example: "[OT-001] Seguridad" },
    { id: "category", label: "Categoría", example: "safety" },
  ],
  compareAttrs: ["category", "active"],
  attrLabels: { category: "Categoría", active: "Activo", name: "Nombre" },
  parseRow(cells) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const parsed = parseName(cells.name);
    if (!cells.name?.trim()) errors.push("Falta el nombre.");
    else if (!parsed.id) errors.push("El nombre no incluye un [ID] entre corchetes al inicio.");
    else if (!isValidIdFormat(parsed.id)) errors.push(`ID “${parsed.id}” con formato inválido.`);
    warnings.push("Observation Types es solo lectura en v1: el dry-run mostrará qué falta pero no se escribirá nada.");
    if (errors.length || !parsed.id) return { errors, warnings };
    return {
      errors,
      warnings,
      desired: {
        key: parsed.id,
        stdId: parsed.id,
        name: formatName(parsed.id, parsed.text),
        attrs: { category: cells.category?.trim() || null, active: true },
      },
    };
  },
};
