import { parseGovernedName } from "@/lib/naming";
import type { ObjectSpec } from "../spec-types";

export const observationTypesSpec: ObjectSpec = {
  type: "observation_types",
  label: "Observation Types",
  singular: "Observation Type",
  idPrefixExample: "HS-OT-001",
  writable: false,
  readOnlyReason:
    "La API pública de Procore solo expone GET para Observation Types a nivel company (crear/editar existe únicamente a nivel proyecto). Se gobiernan en modo solo lectura.",
  dependsOn: [],
  columns: [
    { id: "name", label: "Nombre con [ID]", required: true, example: "Seguridad [HS-OT-001]" },
    { id: "category", label: "Categoría", example: "safety" },
    { id: "discipline", label: "Disciplina", example: "QE", hint: "QE Calidad y Medioambiente · HS Seguridad y Salud · DE Oficina Técnica. Opcional si el [ID] ya empieza por el código.", input: "select", optionsKey: "disciplines" },
  ],
  compareAttrs: ["category", "active"],
  attrLabels: { category: "Categoría", active: "Activo", name: "Nombre" },
  parseRow(cells) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const parsed = parseGovernedName(cells.name, cells.discipline);
    errors.push(...parsed.errors);
    warnings.push(...parsed.warnings);
    warnings.push("Observation Types es solo lectura en v1: el dry-run mostrará qué falta pero no se escribirá nada.");
    if (errors.length || !parsed.id || !parsed.name) return { errors, warnings };
    return {
      errors,
      warnings,
      desired: {
        key: parsed.id,
        stdId: parsed.id,
        name: parsed.name,
        attrs: { category: cells.category?.trim() || null, active: true },
      },
    };
  },
};
