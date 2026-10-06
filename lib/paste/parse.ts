/**
 * Parseo del texto pegado desde Excel/Sheets: filas separadas por "\n" y columnas por "\t".
 * Soporta celdas entrecomilladas (Excel las usa cuando hay saltos de línea dentro de la celda).
 */
export function parseClipboard(text: string): string[][] {
  if (!text) return [];
  const normalized = text.replace(/\r\n?/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let cellStart = true;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cellStart) {
      inQuotes = true;
      cellStart = false;
      continue;
    }
    if (ch === "\t") {
      row.push(cell);
      cell = "";
      cellStart = true;
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      cellStart = true;
      continue;
    }
    cell += ch;
    cellStart = false;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Quita filas totalmente vacías (p. ej. el salto de línea final de Excel).
  return rows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ""));
}

/** Detecta si la primera fila es una cabecera comparándola con las etiquetas de columna. */
export function looksLikeHeader(row: string[], labels: string[]): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9áéíóúñ]/g, "");
  const set = new Set(labels.map(norm));
  const hits = row.filter((c) => set.has(norm(c))).length;
  return hits > 0 && hits >= Math.min(2, row.length);
}

/** Convierte una matriz a CSV (separador coma, comillas cuando hace falta). */
export function toCsv(rows: (string | number | boolean | null | undefined)[][]): string {
  const esc = (v: string | number | boolean | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM para que Excel abra correctamente acentos.
  return "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
}

export function parseBoolean(raw: string | undefined, fallback = true): boolean | null {
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["si", "sí", "s", "yes", "y", "true", "1", "activo", "x", "verdadero"].includes(v)) return true;
  if (["no", "n", "false", "0", "inactivo", "falso"].includes(v)) return false;
  return null;
}
