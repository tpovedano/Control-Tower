/**
 * Parseo y normalización del ID estándar entre corchetes, AL FINAL del nombre:
 *   "Fecha de inspección [QE-CF-001]"
 * Por compatibilidad se reconoce también el formato antiguo con el ID al principio ("[CF-001] Fecha"),
 * marcado como `position: "start"`: se gobierna igual, pero las filas nuevas deben usar el formato final.
 */

/** ID al final: toma el último grupo entre corchetes. */
export const ID_REGEX = /^(.*?)\s*\[([^\]]+)\]\s*$/s;
/** Formato antiguo: ID al principio. */
export const LEGACY_ID_REGEX = /^\s*\[([^\]]+)\]\s*(.*)$/s;
/** Formato permitido para el ID (tras normalizar). */
export const ID_FORMAT = /^[A-Z0-9][A-Z0-9._-]{0,39}$/;

export interface ParsedName {
  id: string | null;
  text: string;
  raw: string;
  /** Dónde estaba el ID: "end" (formato vigente), "start" (formato antiguo) o null si no tiene. */
  position: "end" | "start" | null;
}

export function normalizeId(id: string): string {
  return id.trim().toUpperCase();
}

export function parseName(raw: string | null | undefined): ParsedName {
  const value = (raw ?? "").toString();
  const end = ID_REGEX.exec(value);
  if (end && normalizeId(end[2])) return { id: normalizeId(end[2]), text: end[1].trim(), raw: value, position: "end" };
  const start = LEGACY_ID_REGEX.exec(value);
  if (start && normalizeId(start[1])) return { id: normalizeId(start[1]), text: start[2].trim(), raw: value, position: "start" };
  return { id: null, text: value.trim(), raw: value, position: null };
}

export function isValidIdFormat(id: string): boolean {
  return ID_FORMAT.test(id);
}

/** Nombre con el ID al final: "Texto [ID]". */
export function formatName(id: string, text: string): string {
  return text ? `${text} [${id}]` : `[${id}]`;
}

/** Divide una lista de IDs separados por ";" o ","; acepta "[CF-001]", "CF-001" o "Nombre [CF-001]". */
export function parseIdList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[;,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = /\[([^\]]+)\]\s*$/.exec(s) ?? /^\[([^\]]+)\]/.exec(s);
      return normalizeId(m ? m[1] : s);
    })
    .filter(Boolean);
}

export function lovKey(parentId: string, optionId: string): string {
  return `${normalizeId(parentId)}/${normalizeId(optionId)}`;
}
