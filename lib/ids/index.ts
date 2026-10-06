/** Parseo y normalización del ID estándar entre corchetes: "[CF-001] Fecha de inspección". */

export const ID_REGEX = /^\s*\[([^\]]+)\]\s*(.*)$/s;
/** Formato permitido para el ID (tras normalizar). */
export const ID_FORMAT = /^[A-Z0-9][A-Z0-9._-]{0,39}$/;

export interface ParsedName {
  id: string | null;
  text: string;
  raw: string;
}

export function normalizeId(id: string): string {
  return id.trim().toUpperCase();
}

export function parseName(raw: string | null | undefined): ParsedName {
  const value = (raw ?? "").toString();
  const m = ID_REGEX.exec(value);
  if (!m) return { id: null, text: value.trim(), raw: value };
  const id = normalizeId(m[1]);
  if (!id) return { id: null, text: value.trim(), raw: value };
  return { id, text: m[2].trim(), raw: value };
}

export function isValidIdFormat(id: string): boolean {
  return ID_FORMAT.test(id);
}

export function formatName(id: string, text: string): string {
  return text ? `[${id}] ${text}` : `[${id}]`;
}

/** Divide una lista de IDs separados por ";" o ","; acepta "[CF-001]" o "CF-001". */
export function parseIdList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[;,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = /^\[([^\]]+)\]/.exec(s);
      return normalizeId(m ? m[1] : s);
    })
    .filter(Boolean);
}

export function lovKey(parentId: string, optionId: string): string {
  return `${normalizeId(parentId)}/${normalizeId(optionId)}`;
}
