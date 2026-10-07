import { parseGovernedName } from "@/lib/naming";
import type { ObjectSpec } from "../spec-types";

export const inspectionTypesSpec: ObjectSpec = {
  type: "inspection_types",
  label: "Inspection Types",
  singular: "Inspection Type",
  idPrefixExample: "HS-IT-001",
  writable: true,
  dependsOn: [],
  columns: [
    { id: "name", label: "Nombre con [ID]", required: true, example: "Inspección de seguridad [HS-IT-001]" },
    { id: "grouping", label: "Agrupación", example: "Seguridad" },
    { id: "discipline", label: "Disciplina", example: "QE", hint: "QE Calidad y Medioambiente · HS Seguridad y Salud · DE Oficina Técnica. Opcional si el [ID] ya empieza por el código.", input: "select", optionsKey: "disciplines" },
  ],
  compareAttrs: ["grouping"],
  attrLabels: { grouping: "Agrupación", name: "Nombre" },
  parseRow(cells) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const parsed = parseGovernedName(cells.name, cells.discipline);
    errors.push(...parsed.errors);
    warnings.push(...parsed.warnings);
    if (errors.length || !parsed.id || !parsed.name) return { errors, warnings };
    return {
      errors,
      warnings,
      desired: {
        key: parsed.id,
        stdId: parsed.id,
        name: parsed.name,
        attrs: { grouping: cells.grouping?.trim() || null },
      },
    };
  },
};
