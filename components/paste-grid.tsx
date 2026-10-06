"use client";
import { useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RowStatusBadge } from "@/components/status-badge";
import { looksLikeHeader, parseClipboard } from "@/lib/paste/parse";
import type { ColumnSpec, ParsedRow } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Cuadrícula ligera tipo hoja de cálculo. Ctrl+V desde Excel rellena a partir de la celda activa
 * (columnas por tabulador, filas por salto de línea). Flechas ↑/↓ y Enter para moverse.
 */
export function PasteGrid({
  columns,
  rows,
  onChange,
  validation,
  suggestions,
}: {
  columns: ColumnSpec[];
  rows: string[][];
  onChange: (rows: string[][]) => void;
  validation: ParsedRow[];
  suggestions?: Record<string, string[]>;
}) {
  const tableRef = useRef<HTMLTableElement>(null);

  function focusCell(r: number, c: number) {
    const el = tableRef.current?.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="${c}"]`);
    el?.focus();
    el?.select();
  }

  function setCell(r: number, c: number, value: string) {
    const next = rows.map((row) => [...row]);
    while (next.length <= r) next.push(Array(columns.length).fill(""));
    next[r][c] = value;
    onChange(next);
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>, r: number, c: number) {
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !text.includes("\n")) return; // pegado simple en una celda
    e.preventDefault();
    let data = parseClipboard(text);
    if (data.length && r === 0 && looksLikeHeader(data[0], columns.map((x) => x.label))) data = data.slice(1);
    const next = rows.map((row) => [...row]);
    data.forEach((cells, i) => {
      const rr = r + i;
      while (next.length <= rr) next.push(Array(columns.length).fill(""));
      cells.forEach((v, j) => {
        if (c + j < columns.length) next[rr][c + j] = v;
      });
    });
    onChange(trimEmpty(next));
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number) {
    if (e.key === "ArrowDown" || (e.key === "Enter" && !e.shiftKey)) {
      e.preventDefault();
      if (r + 1 >= rows.length) onChange([...rows, Array(columns.length).fill("")]);
      setTimeout(() => focusCell(r + 1, c));
    } else if (e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey)) {
      e.preventDefault();
      if (r > 0) focusCell(r - 1, c);
    } else if (e.key === "ArrowRight" && (e.target as HTMLInputElement).selectionStart === (e.target as HTMLInputElement).value.length && c + 1 < columns.length) {
      e.preventDefault();
      focusCell(r, c + 1);
    } else if (e.key === "ArrowLeft" && (e.target as HTMLInputElement).selectionStart === 0 && c > 0) {
      e.preventDefault();
      focusCell(r, c - 1);
    }
  }

  const display = rows.length ? rows : [Array(columns.length).fill("")];

  return (
    <div className="space-y-2">
      <div className="max-h-[55vh] overflow-auto rounded-md border">
        <table ref={tableRef} className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left text-xs">
            <tr>
              <th className="w-10 px-2 py-2 text-right">#</th>
              {columns.map((c) => (
                <th key={c.id} className="min-w-[140px] px-2 py-2 font-medium" title={c.hint}>
                  {c.label}
                  {c.required && <span className="text-red-600"> *</span>}
                </th>
              ))}
              <th className="min-w-[220px] px-2 py-2">Validación</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {display.map((row, r) => {
              const v = validation[r];
              const empty = row.every((x) => !x?.trim());
              return (
                <tr key={r} className={cn("border-t align-top", v?.status === "error" && !empty && "bg-red-50/60 dark:bg-red-950/30")}>
                  <td className="px-2 py-1 text-right text-xs tabular-nums text-muted-foreground">{r + 1}</td>
                  {columns.map((col, c) => (
                    <td key={col.id} className="p-0">
                      <input
                        data-r={r}
                        data-c={c}
                        aria-label={`Fila ${r + 1}, ${col.label}`}
                        className="h-8 w-full border-0 bg-transparent px-2 text-sm outline-none focus:bg-accent/60 focus:ring-2 focus:ring-inset focus:ring-ring"
                        value={row[c] ?? ""}
                        placeholder={r === 0 && empty ? col.example : undefined}
                        list={suggestions?.[col.id] ? `dl-${col.id}` : undefined}
                        onChange={(e) => setCell(r, c, e.target.value)}
                        onPaste={(e) => handlePaste(e, r, c)}
                        onKeyDown={(e) => handleKey(e, r, c)}
                      />
                    </td>
                  ))}
                  <td className="px-2 py-1">
                    {!empty && v && (
                      <div className="space-y-0.5">
                        <RowStatusBadge status={v.status} />
                        {v.messages.map((m, i) => (
                          <p key={i} className={cn("text-xs", v.status === "error" ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300")}>
                            {m}
                          </p>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-1 py-1">
                    {rows.length > 0 && (
                      <button className="rounded p-1 text-muted-foreground hover:bg-accent" onClick={() => onChange(rows.filter((_, i) => i !== r))} aria-label={`Eliminar fila ${r + 1}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {suggestions &&
          Object.entries(suggestions).map(([id, values]) => (
            <datalist key={id} id={`dl-${id}`}>
              {values.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => onChange([...display, Array(columns.length).fill("")])}>
          <Plus className="h-3.5 w-3.5" /> Añadir fila
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onChange([])} disabled={!rows.length}>
          Vaciar
        </Button>
        <span className="text-xs text-muted-foreground">Atajos: Ctrl+V pega desde Excel · Enter/↓ siguiente fila · ↑ fila anterior · ←/→ entre columnas</span>
      </div>
    </div>
  );
}

function trimEmpty(rows: string[][]): string[][] {
  const out = [...rows];
  while (out.length && out[out.length - 1].every((c) => !c?.trim())) out.pop();
  return out;
}
