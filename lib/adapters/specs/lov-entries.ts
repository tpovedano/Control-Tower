import { formatName, isValidIdFormat, lovKey, normalizeId, parseName } from "@/lib/ids";
import type { ObjectSpec } from "../spec-types";

export const lovEntriesSpec: ObjectSpec = {
  type: "lov_entries",
  label: "LOV Entries",
  singular: "Opción LOV",
  idPrefixExample: "OPT-01",
  writable: true,
  dependsOn: ["custom_fields"],
  columns: [
    { id: "parent", label: "[ID] del custom field padre", required: true, example: "[QE-CF-010]", input: "select", optionsKey: "lovCustomFields" },
    { id: "name", label: "Opción con [ID]", required: true, example: "Conforme [OPT-01]" },
  ],
  compareAttrs: ["active"],
  attrLabels: { active: "Activa", parent: "Custom field padre", name: "Nombre" },
  parseRow(cells, ctx) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const rawParent = cells.parent?.trim() ?? "";
    const parentParsed = parseName(rawParent);
    const parentId = parentParsed.id ?? (rawParent ? normalizeId(rawParent) : "");
    if (!parentId) errors.push("Falta el [ID] del custom field padre.");
    else if (!isValidIdFormat(parentId)) errors.push(`ID padre “${parentId}” con formato inválido.`);
    const parsed = parseName(cells.name);
    if (!cells.name?.trim()) errors.push("Falta la opción.");
    else if (!parsed.id) errors.push("La opción no incluye un [ID] entre corchetes al final, p. ej. “Conforme [OPT-01]”.");
    else if (parsed.position === "start") errors.push(`El [ID] debe ir al final: “${parsed.text || "Opción"} [${parsed.id}]”.`);
    else if (!isValidIdFormat(parsed.id)) errors.push(`ID “${parsed.id}” con formato inválido.`);
    const knownCf = ctx.known?.custom_fields;
    if (parentId && knownCf && !knownCf.includes(parentId)) {
      warnings.push(`El custom field padre [${parentId}] no aparece en las instancias sincronizadas; el dry-run lo comprobará por instancia.`);
    }
    if (errors.length || !parsed.id) return { errors, warnings };
    return {
      errors,
      warnings,
      desired: {
        key: lovKey(parentId, parsed.id),
        stdId: parsed.id,
        parentKey: parentId,
        name: formatName(parsed.id, parsed.text),
        attrs: { active: true },
      },
    };
  },
};
