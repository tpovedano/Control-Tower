"use client";
import { useMemo, useRef } from "react";
import { getCoreRowModel, getFilteredRowModel, useReactTable, type ColumnDef, type FilterFn } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CELL_META } from "@/components/status-badge";
import { Checkbox } from "@/components/ui/misc";
import type { PublicInstance } from "@/lib/client/types";
import type { MatrixRow, MatrixStats } from "@/lib/diff/matrix";
import type { ObjectSpec } from "@/lib/adapters/spec-types";
import { formatAttr } from "@/lib/adapters/spec-types";
import { cn } from "@/lib/utils";
import { parseName } from "@/lib/ids";
import { disciplineOf } from "@/lib/naming";

export type StatusFilter = "all" | "aligned" | "missing" | "differs" | "conflict" | "orphan" | "not_aligned";

export interface MatrixFilters {
  text: string;
  status: StatusFilter;
  instanceId: string; // "" = todas
  discipline?: string; // "" = todas; "none" = sin disciplina
}

const ROW_HEIGHT = 40;
const COL_WIDTH = 150;

const matrixFilter: FilterFn<MatrixRow> = (row, _columnId, f: MatrixFilters) => {
  const r = row.original;
  if (f.discipline) {
    const d = disciplineOf(r.key?.split("/")[0]);
    if (f.discipline === "none" ? d !== null : d !== f.discipline) return false;
  }
  if (f.text) {
    const q = f.text.toLowerCase();
    const names = Object.values(r.cells).flatMap((c) => c?.names ?? []);
    if (!(r.key ?? "").toLowerCase().includes(q) && !r.displayName.toLowerCase().includes(q) && !names.some((n) => n.toLowerCase().includes(q))) return false;
  }
  const cells = f.instanceId ? [r.cells[f.instanceId]] : Object.values(r.cells);
  if (f.instanceId && !r.cells[f.instanceId] && f.status !== "missing" && f.status !== "all") return false;
  switch (f.status) {
    case "all":
      return f.instanceId ? !!r.cells[f.instanceId] || !r.orphan : true;
    case "not_aligned":
      return r.orphan || r.alerts.length > 0 || cells.some((c) => c && c.status !== "aligned");
    default:
      return cells.some((c) => c?.status === f.status);
  }
};

export function MatrixTable({
  rows,
  instances,
  spec,
  stats,
  filters,
  selected,
  onToggle,
  onToggleAll,
  onOpen,
}: {
  rows: MatrixRow[];
  instances: PublicInstance[];
  spec: ObjectSpec;
  stats: MatrixStats;
  filters: MatrixFilters;
  selected: Set<string>;
  onToggle: (key: string) => void;
  onToggleAll: (keys: string[], value: boolean) => void;
  onOpen: (row: MatrixRow) => void;
}) {
  const columns = useMemo<ColumnDef<MatrixRow>[]>(() => [{ id: "key", accessorFn: (r) => r.key ?? r.displayName }], []);
  const table = useReactTable({
    data: rows,
    columns,
    state: { globalFilter: filters },
    globalFilterFn: matrixFilter,
    getColumnCanGlobalFilter: () => true,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  const visible = table.getRowModel().rows.map((r) => r.original);
  const selectableKeys = visible.filter((r) => r.key).map((r) => r.key!);
  const allSelected = selectableKeys.length > 0 && selectableKeys.every((k) => selected.has(k));

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({ count: visible.length, getScrollElement: () => parentRef.current, estimateSize: () => ROW_HEIGHT, overscan: 12 });
  const gridTemplate = `40px minmax(260px, 1fr) ${instances.map(() => `${COL_WIDTH}px`).join(" ")}`;
  const minWidth = 40 + 260 + instances.length * COL_WIDTH;

  return (
    <div className="rounded-md border">
      <div ref={parentRef} className="relative h-[62vh] overflow-auto" role="grid" aria-rowcount={visible.length} aria-label="Matriz de alineación">
        <div style={{ minWidth }}>
          {/* Cabecera */}
          <div className="sticky top-0 z-20 grid border-b bg-muted text-xs font-medium" style={{ gridTemplateColumns: gridTemplate }} role="row">
            <div className="sticky left-0 z-30 flex items-center justify-center bg-muted p-2">
              <Checkbox aria-label="Seleccionar todas las visibles" checked={allSelected} onChange={(e) => onToggleAll(selectableKeys, e.target.checked)} />
            </div>
            <div className="sticky left-10 z-30 flex items-center bg-muted p-2" role="columnheader">
              [ID] · nombre ({visible.length})
            </div>
            {instances.map((i) => {
              const s = stats.perInstance[i.id];
              return (
                <div key={i.id} className="flex flex-col justify-center p-2" role="columnheader" title={`${i.label} (company ${i.companyId})`}>
                  <span className={cn("truncate", filters.instanceId === i.id && "text-primary")}>
                    {i.isGolden && "★ "}
                    {i.label}
                  </span>
                  <span className="font-normal text-muted-foreground">{s ? `${s.pct}% alineado` : "sin datos"}</span>
                </div>
              );
            })}
          </div>
          {/* Filas virtualizadas */}
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((v) => {
              const r = visible[v.index];
              return (
                <div
                  key={r.rowId}
                  role="row"
                  className={cn("absolute left-0 grid w-full border-b text-sm hover:bg-accent/40", r.alerts.length > 0 && "bg-red-50/60 dark:bg-red-950/30")}
                  style={{ top: v.start, height: ROW_HEIGHT, gridTemplateColumns: gridTemplate }}
                >
                  <div className="sticky left-0 z-10 flex items-center justify-center bg-background">
                    {r.key && <Checkbox aria-label={`Seleccionar ${r.key}`} checked={selected.has(r.key)} onChange={() => onToggle(r.key!)} />}
                  </div>
                  <button className="sticky left-10 z-10 flex min-w-0 items-center gap-2 bg-background px-2 text-left" onClick={() => onOpen(r)} title="Ver detalle">
                    {r.key ? (
                      <span className="shrink-0 font-mono text-xs font-semibold">[{r.key}]</span>
                    ) : (
                      <span className="shrink-0 text-xs" aria-label="Sin ID">
                        🔇
                      </span>
                    )}
                    <span className="truncate text-muted-foreground">{r.key ? parseName(r.displayName).text || r.displayName : r.displayName}</span>
                    {r.alerts.length > 0 && (
                      <span className="shrink-0 rounded bg-red-600 px-1 text-[10px] font-semibold text-white" title={r.alerts.join(" · ")}>
                        ⛔ conflicto
                      </span>
                    )}
                  </button>
                  {instances.map((i) => {
                    const c = r.cells[i.id];
                    if (!c) {
                      return (
                        <div key={i.id} className="flex items-center px-2 text-xs text-muted-foreground">
                          {r.orphan ? "" : "sin datos"}
                        </div>
                      );
                    }
                    const m = CELL_META[c.status];
                    const tip = [
                      `${m.label}`,
                      ...c.names.map((n) => `Nombre: ${n}`),
                      ...c.diffs.map((d) => `${spec.attrLabels[d.attr] ?? d.attr}: ${formatAttr(d.current)} (ref: ${formatAttr(d.desired)})`),
                      c.note ?? "",
                    ]
                      .filter(Boolean)
                      .join("\n");
                    return (
                      <button key={i.id} onClick={() => onOpen(r)} className="flex min-w-0 items-center gap-1.5 px-2 text-left text-xs" title={tip} aria-label={`${i.label}: ${tip}`}>
                        <span aria-hidden>{m.icon}</span>
                        <span className="truncate">{c.status === "missing" ? "Falta" : c.names[0] ?? m.label}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {visible.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">Ningún elemento coincide con los filtros.</p>}
        </div>
      </div>
    </div>
  );
}
