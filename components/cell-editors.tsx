"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { parseIdList } from "@/lib/ids";
import type { SelectOption } from "@/lib/types";
import { cn } from "@/lib/utils";

const cellClass = "h-8 w-full border-0 bg-transparent px-2 text-sm outline-none focus:bg-accent/60 focus:ring-2 focus:ring-inset focus:ring-ring";

/** Desplegable de una celda. Si el valor (p. ej. pegado) no está entre las opciones, se muestra igualmente. */
export function SelectCell({
  value,
  options,
  onChange,
  ariaLabel,
  dataR,
  dataC,
  onKeyDown,
}: {
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  ariaLabel: string;
  dataR: number;
  dataC: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLSelectElement>) => void;
}) {
  const known = options.some((o) => o.value === value);
  return (
    <select
      data-r={dataR}
      data-c={dataC}
      aria-label={ariaLabel}
      className={cn(cellClass, "cursor-pointer", !value && "text-muted-foreground")}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
    >
      <option value="">{options.length ? "Elegir…" : "Sin opciones: sincroniza en Gobierno"}</option>
      {value && !known && <option value={value}>{value} (no encontrado en lo sincronizado)</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Selección múltiple de [ID]s. Guarda "[CF-001];[CF-002]" (el mismo formato que se pega desde Excel),
 * así que la celda sigue admitiendo escribir o pegar a mano.
 */
export function MultiSelectCell({
  value,
  options,
  onChange,
  ariaLabel,
  dataR,
  dataC,
  onPaste,
  onKeyDown,
}: {
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  ariaLabel: string;
  dataR: number;
  dataC: number;
  onPaste?: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const selected = useMemo(() => parseIdList(value).map((id) => `[${id}]`), [value]);

  // El panel usa posición fija para no quedar recortado por el scroll de la tabla.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const width = 320;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const below = r.bottom + 4;
      const top = below + 330 > window.innerHeight ? Math.max(8, r.top - 334) : below;
      setPos({ top, left });
    };
    place();
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  function toggle(v: string) {
    const next = selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v];
    onChange(next.join(";"));
  }

  const filtered = options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));
  const unknown = selected.filter((s) => !options.some((o) => o.value === s));

  return (
    <div ref={ref} className="relative flex items-center">
      <input
        data-r={dataR}
        data-c={dataC}
        aria-label={ariaLabel}
        className={cn(cellClass, "pr-7")}
        value={value}
        placeholder={options.length ? "Elegir o pegar [ID];[ID]" : ""}
        onChange={(e) => onChange(e.target.value)}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        className="absolute right-1 rounded p-0.5 text-muted-foreground hover:bg-accent"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Elegir ${ariaLabel}`}
        aria-expanded={open}
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && pos && (
        <div ref={panelRef} role="dialog" aria-label={`Elegir ${ariaLabel}`} className="fixed z-50 w-80 rounded-md border bg-card p-2 shadow-lg" style={{ top: pos.top, left: pos.left }}>
          <div className="relative mb-2">
            <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <input autoFocus className="h-8 w-full rounded border bg-transparent pl-7 pr-2 text-sm outline-none focus:ring-2 focus:ring-ring" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="max-h-60 space-y-0.5 overflow-auto">
            {options.length === 0 && <p className="p-2 text-xs text-muted-foreground">No hay custom fields sincronizados. Pulsa “Sincronizar” en Gobierno.</p>}
            {filtered.map((o) => (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent">
                <input type="checkbox" className="h-4 w-4" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
                <span className="truncate">{o.label}</span>
              </label>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
            <span>
              {selected.length} seleccionado{selected.length === 1 ? "" : "s"}
              {unknown.length > 0 && ` · ${unknown.length} no sincronizado${unknown.length === 1 ? "" : "s"}`}
            </span>
            <button type="button" className="rounded px-2 py-0.5 hover:bg-accent" onClick={() => setOpen(false)}>
              Listo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
