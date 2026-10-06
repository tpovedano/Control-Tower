import { attrEquals, type ObjectSpec } from "@/lib/adapters/spec-types";
import type { AttrDiff, DesiredItem, NormalizedItem, PlanOptions, PlanResult } from "@/lib/types";

export interface DependencyCheck {
  missing: string[];
  message?: string;
}

/**
 * Motor de plan (dry-run) para un elemento deseado frente al estado actual de una instancia.
 * La correspondencia es SIEMPRE por [ID] (key), nunca por el texto del nombre.
 */
export function planItem(
  spec: ObjectSpec,
  desired: DesiredItem,
  existing: NormalizedItem[],
  options: PlanOptions = { includeTexts: false },
  deps?: DependencyCheck,
): PlanResult {
  const matches = existing.filter((i) => i.key === desired.key);

  if (matches.length > 1) {
    return {
      action: "SKIP",
      diffs: [],
      message: `Conflicto: el ID [${desired.key}] está repetido ${matches.length} veces en esta instancia (${matches.map((m) => `“${m.name}”`).join(", ")}). Corrígelo manualmente.`,
    };
  }

  const current = matches[0];

  if (!current) {
    if (!spec.writable) return { action: "SKIP", diffs: [], message: `Falta en la instancia. ${spec.readOnlyReason ?? "Tipo de solo lectura."}` };
    if (deps && (deps.missing.length || deps.message)) {
      return {
        action: "SKIP",
        diffs: [],
        missingDependencies: deps.missing,
        message:
          deps.message ??
          `Bloqueado por dependencia: no existe ${deps.missing.map((d) => `[${d}]`).join(", ")} en esta instancia. Crea primero ${deps.missing.length > 1 ? "esos custom fields" : "ese custom field"}.`,
      };
    }
    return { action: "CREATE", diffs: [] };
  }

  // Las opciones LOV no se pueden renombrar por API: nunca se comparan textos.
  const diffs = diffAttrs(spec, desired, current, spec.type === "lov_entries" ? { includeTexts: false } : options);

  // Atributo de "naturaleza" distinto (p. ej. data_type): Procore no permite cambiarlo.
  if (spec.natureAttr) {
    const n = diffs.find((d) => d.attr === spec.natureAttr);
    if (n) {
      return {
        action: "SKIP",
        diffs,
        remoteId: current.remoteId,
        message: `Conflicto: [${desired.key}] existe con ${spec.attrLabels[n.attr] ?? n.attr} “${n.current}” y se pide “${n.desired}”. No se puede cambiar automáticamente.`,
      };
    }
  }

  if (!diffs.length) return { action: "NOCHANGE", diffs: [], remoteId: current.remoteId };
  if (!spec.writable) return { action: "SKIP", diffs, remoteId: current.remoteId, message: `Difiere, pero ${spec.readOnlyReason ?? "es de solo lectura."}` };
  if (spec.type === "lov_entries") {
    return { action: "SKIP", diffs, remoteId: current.remoteId, message: "La opción existe pero está inactiva; la API no permite reactivar opciones LOV. Hazlo manualmente en Procore." };
  }
  if (deps && deps.missing.length) {
    return { action: "SKIP", diffs, remoteId: current.remoteId, missingDependencies: deps.missing, message: `Bloqueado por dependencia: faltan ${deps.missing.map((d) => `[${d}]`).join(", ")}.` };
  }
  return { action: "UPDATE", diffs, remoteId: current.remoteId };
}

export function diffAttrs(spec: ObjectSpec, desired: DesiredItem, current: NormalizedItem, options: PlanOptions): AttrDiff[] {
  const diffs: AttrDiff[] = [];
  for (const attr of spec.compareAttrs) {
    const want = desired.attrs[attr];
    // Un atributo opcional vacío en la fila significa "no me importa".
    if (want === null || want === undefined) continue;
    const have = current.attrs[attr];
    if (!attrEquals(have, want)) diffs.push({ attr, current: have, desired: want });
  }
  if (options.includeTexts) {
    if (current.name.trim() !== desired.name.trim()) diffs.push({ attr: "name", current: current.name, desired: desired.name });
    for (const k of ["description", "default_value"]) {
      const want = desired.extra?.[k] as string | null | undefined;
      if (want === null || want === undefined || want === "") continue;
      const have = (current.extra?.[k] as string | null | undefined) ?? null;
      if ((have ?? "") !== want) diffs.push({ attr: k, current: have, desired: want });
    }
  }
  return diffs;
}

export function summarize(plans: { action: string }[]) {
  const out = { CREATE: 0, UPDATE: 0, NOCHANGE: 0, SKIP: 0 } as Record<string, number>;
  for (const p of plans) out[p.action] = (out[p.action] ?? 0) + 1;
  return out;
}
