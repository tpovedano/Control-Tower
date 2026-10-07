"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, PlusCircle, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { Alert, EmptyState, Spinner } from "@/components/ui/misc";
import { Badge, CELL_META, CellBadge } from "@/components/status-badge";
import { MatrixTable, type MatrixFilters } from "@/components/matrix";
import { RunFlow } from "@/components/run-flow";
import { SyncPanel } from "@/components/sync-panel";
import { EXECUTION_ORDER, SPECS } from "@/lib/adapters/specs";
import { attrEquals, formatAttr } from "@/lib/adapters/spec-types";
import { api } from "@/lib/client/api";
import type { GovernanceResponse } from "@/lib/client/types";
import type { MatrixRow } from "@/lib/diff/matrix";
import type { ObjectType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DISCIPLINES } from "@/lib/naming";

const REF_LABEL = { catalog: "Catálogo maestro", golden: "Instancia de referencia (★)", consensus: "Consenso (valor más frecuente)" } as const;

export function GobiernoView() {
  const [type, setType] = useState<ObjectType>("custom_fields");
  const [data, setData] = useState<GovernanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<MatrixFilters>({ text: "", status: "all", instanceId: "", discipline: "" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<MatrixRow | null>(null);
  const [remediation, setRemediation] = useState<{ mode: "create_missing" | "align"; keys: string[] } | null>(null);
  const [catalogInstance, setCatalogInstance] = useState("");
  const [catalogMsg, setCatalogMsg] = useState<string | null>(null);

  const spec = SPECS[type];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api<GovernanceResponse>(`/api/gobierno?type=${type}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => {
    setSelected(new Set());
    load();
  }, [load]);

  const remediationRequest = useMemo(
    () => (remediation ? { source: "gobierno", objectType: type, keys: remediation.keys, mode: remediation.mode } : null),
    [remediation, type],
  );

  const selectedRows = useMemo(() => (data?.rows ?? []).filter((r) => r.key && selected.has(r.key)), [data, selected]);
  const missingCount = selectedRows.filter((r) => Object.values(r.cells).some((c) => c?.status === "missing")).length;
  const differsCount = selectedRows.filter((r) => Object.values(r.cells).some((c) => c?.status === "differs")).length;

  async function saveCatalog() {
    if (!catalogInstance) return;
    setCatalogMsg(null);
    try {
      const r = await api<{ count: number }>("/api/catalog", { body: { instanceId: catalogInstance, objectType: type } });
      setCatalogMsg(`Catálogo maestro de ${spec.label} guardado con ${r.count} elementos.`);
      load();
    } catch (e) {
      setCatalogMsg((e as Error).message);
    }
  }
  async function clearCatalog() {
    await api(`/api/catalog?type=${type}`, { method: "DELETE" });
    setCatalogMsg("Catálogo vaciado: la referencia vuelve a ser la instancia ★ o el consenso.");
    load();
  }

  const instances = data?.instances ?? [];
  const shownInstances = filters.instanceId ? instances.filter((i) => i.id === filters.instanceId) : instances;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Gobierno</h1>
        <p className="text-sm text-muted-foreground">Qué existe en cada instancia y cómo se alinea por [ID] (nunca por el nombre ni el idioma).</p>
      </div>

      <Card className="p-4">
        <SyncPanel instances={instances} snapshots={data?.snapshots ?? []} onDone={load} />
      </Card>

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Tipo de objeto">
        {EXECUTION_ORDER.map((tp) => (
          <button
            key={tp}
            role="tab"
            aria-selected={type === tp}
            onClick={() => setType(tp)}
            className={cn("rounded-md border px-3 py-1.5 text-sm", type === tp ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}
          >
            {SPECS[tp].label}
            {!SPECS[tp].writable && <span className="ml-1 text-xs opacity-70">(solo lectura)</span>}
          </button>
        ))}
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {loading && !data && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Cargando matriz…
        </div>
      )}

      {data && instances.length === 0 && <EmptyState title="No hay instancias">Conecta instancias en la pestaña Instancias y sincronízalas.</EmptyState>}

      {data && instances.length > 0 && (
        <>
          {/* Contadores */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <Stat label="IDs gobernados" value={data.stats.totalIds} />
            <Stat label="Alineación global" value={`${data.stats.alignmentPct}%`} />
            <Stat label="Sin ID (no gobernados)" value={data.stats.orphans} />
            <Stat label="Conflictos de ID" value={data.stats.conflicts + data.crossConflicts.length} danger={data.stats.conflicts + data.crossConflicts.length > 0} />
            <div className="rounded-md border p-3 text-xs">
              <p className="text-muted-foreground">Referencia</p>
              <p className="mt-1 font-medium">{REF_LABEL[data.referenceMode]}</p>
            </div>
          </div>

          {data.crossConflicts.length > 0 && (
            <Alert variant="error">
              Mismo [ID] usado en objetos de naturaleza distinta:{" "}
              {data.crossConflicts.map((c) => `[${c.id}] (${c.types.map((t) => SPECS[t as ObjectType]?.label ?? t).join(" / ")})`).join(", ")}
            </Alert>
          )}
          {data.snapshots.filter((s) => s.objectType === type).length === 0 && (
            <Alert variant="warning">Aún no hay lecturas de {spec.label}. Pulsa “Sincronizar / Leer instancias”.</Alert>
          )}

          {/* Filtros */}
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-64">
              <Label htmlFor="q" className="text-xs">
                Buscar por [ID] o nombre
              </Label>
              <Input id="q" value={filters.text} onChange={(e) => setFilters({ ...filters, text: e.target.value })} placeholder="QE-CF-001, fecha…" />
            </div>
            <div className="w-48">
              <Label htmlFor="st" className="text-xs">
                Estado
              </Label>
              <Select id="st" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value as MatrixFilters["status"] })}>
                <option value="all">Todos</option>
                <option value="not_aligned">No alineados (todo lo pendiente)</option>
                {(Object.keys(CELL_META) as (keyof typeof CELL_META)[]).map((k) => (
                  <option key={k} value={k}>
                    {CELL_META[k].icon} {CELL_META[k].label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-56">
              <Label htmlFor="disc" className="text-xs">
                Disciplina
              </Label>
              <Select id="disc" value={filters.discipline ?? ""} onChange={(e) => setFilters({ ...filters, discipline: e.target.value })}>
                <option value="">Todas</option>
                {DISCIPLINES.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.code} — {d.label}
                  </option>
                ))}
                <option value="none">Sin disciplina en el [ID]</option>
              </Select>
            </div>
            <div className="w-56">
              <Label htmlFor="inst" className="text-xs">
                Instancia
              </Label>
              <Select id="inst" value={filters.instanceId} onChange={(e) => setFilters({ ...filters, instanceId: e.target.value })}>
                <option value="">Todas</option>
                {instances.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.label} ({data.stats.perInstance[i.id]?.pct ?? "–"}%)
                  </option>
                ))}
              </Select>
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="outline" disabled={!spec.writable || missingCount === 0} onClick={() => setRemediation({ mode: "create_missing", keys: selectedRows.map((r) => r.key!) })}>
                <PlusCircle className="h-4 w-4" /> Crear donde falta ({missingCount})
              </Button>
              <Button variant="outline" disabled={!spec.writable || differsCount === 0} onClick={() => setRemediation({ mode: "align", keys: selectedRows.map((r) => r.key!) })}>
                <Wand2 className="h-4 w-4" /> Alinear atributos ({differsCount})
              </Button>
              <a href={`/api/gobierno/export?type=${type}`}>
                <Button variant="outline">
                  <Download className="h-4 w-4" /> Exportar CSV
                </Button>
              </a>
            </div>
          </div>

          <MatrixTable
            rows={data.rows}
            instances={shownInstances}
            spec={spec}
            stats={data.stats}
            filters={filters}
            selected={selected}
            onToggle={(k) =>
              setSelected((s) => {
                const n = new Set(s);
                if (n.has(k)) n.delete(k);
                else n.add(k);
                return n;
              })
            }
            onToggleAll={(keys, v) =>
              setSelected((s) => {
                const n = new Set(s);
                keys.forEach((k) => (v ? n.add(k) : n.delete(k)));
                return n;
              })
            }
            onOpen={setDetail}
          />
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground" aria-label="Leyenda">
            {(Object.keys(CELL_META) as (keyof typeof CELL_META)[]).map((k) => (
              <span key={k}>
                <CellBadge status={k} />
              </span>
            ))}
          </div>

          {/* Catálogo maestro */}
          <Card className="p-4">
            <h2 className="font-semibold">Catálogo maestro de {spec.label}</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              El % de alineación se mide contra el catálogo si existe ({data.catalogSize} elementos), si no contra la instancia marcada como referencia (★), y si no por consenso.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-64">
                <Label className="text-xs" htmlFor="cat">
                  Tomar la definición de
                </Label>
                <Select id="cat" value={catalogInstance} onChange={(e) => setCatalogInstance(e.target.value)}>
                  <option value="">Elegir instancia…</option>
                  {instances.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.label}
                    </option>
                  ))}
                </Select>
              </div>
              <Button variant="secondary" onClick={saveCatalog} disabled={!catalogInstance}>
                Guardar como catálogo maestro
              </Button>
              {data.catalogSize > 0 && (
                <Button variant="ghost" onClick={clearCatalog}>
                  Vaciar catálogo
                </Button>
              )}
            </div>
            {catalogMsg && <p className="mt-2 text-sm">{catalogMsg}</p>}
          </Card>
        </>
      )}

      {/* Detalle de un [ID] */}
      <Dialog open={!!detail} onClose={() => setDetail(null)} title={detail?.key ? `[${detail.key}]` : "Elemento sin ID"} description={detail?.displayName} className="max-w-5xl">
        {detail && data && (
          <DetailPanel
            row={detail}
            data={data}
            canWrite={spec.writable}
            onRemediate={(mode) => {
              setRemediation({ mode, keys: [detail.key!] });
              setDetail(null);
            }}
          />
        )}
      </Dialog>

      {/* Remediación (dry-run + confirmación) */}
      <Dialog
        open={!!remediation}
        onClose={() => setRemediation(null)}
        title={remediation?.mode === "create_missing" ? "Crear en las instancias donde falta" : "Alinear atributos con la referencia"}
        description="Dry-run obligatorio: revisa el plan y confirma para escribir. Se usa la definición de referencia; los nombres existentes no se cambian."
        className="max-w-6xl"
      >
        {remediationRequest && <RunFlow request={remediationRequest} instances={instances} objectType={type} onFinished={() => undefined} />}
      </Dialog>
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: string | number; danger?: boolean }) {
  return (
    <div className={cn("rounded-md border p-3", danger && "border-red-300 dark:border-red-800")}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", danger && "text-red-600")}>{value}</p>
    </div>
  );
}

function DetailPanel({ row, data, canWrite, onRemediate }: { row: MatrixRow; data: GovernanceResponse; canWrite: boolean; onRemediate: (m: "create_missing" | "align") => void }) {
  const spec = SPECS[data.objectType as ObjectType];
  const attrs = Array.from(new Set([...spec.compareAttrs, ...Object.keys(row.referenceAttrs ?? {}).filter((k) => k === "lov_options")]));
  const insts = data.instances.filter((i) => row.cells[i.id]);
  const hasMissing = Object.values(row.cells).some((c) => c?.status === "missing");
  const hasDiff = Object.values(row.cells).some((c) => c?.status === "differs");
  return (
    <div className="space-y-3">
      {row.alerts.map((a) => (
        <Alert key={a} variant="error">
          {a}
        </Alert>
      ))}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs">
            <tr>
              <th className="px-3 py-2">Atributo</th>
              {row.referenceAttrs && <th className="px-3 py-2">Referencia ({REF_LABEL[row.referenceSource ?? "consensus"]})</th>}
              {insts.map((i) => (
                <th key={i.id} className="px-3 py-2">
                  {i.label} <span className="font-normal text-muted-foreground">({i.language})</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t">
              <td className="px-3 py-2 font-medium">Estado</td>
              {row.referenceAttrs && <td />}
              {insts.map((i) => (
                <td key={i.id} className="px-3 py-2">
                  <CellBadge status={row.cells[i.id]!.status} />
                </td>
              ))}
            </tr>
            <tr className="border-t">
              <td className="px-3 py-2 font-medium">Nombre</td>
              {row.referenceAttrs && <td />}
              {insts.map((i) => (
                <td key={i.id} className="px-3 py-2">
                  {row.cells[i.id]!.names.join(" | ") || "—"}
                </td>
              ))}
            </tr>
            {attrs.map((a) => (
              <tr key={a} className="border-t">
                <td className="px-3 py-2 font-medium">{spec.attrLabels[a] ?? (a === "lov_options" ? "Opciones LOV ([ID])" : a)}</td>
                {row.referenceAttrs && <td className="px-3 py-2 align-top">{formatAttr(row.referenceAttrs[a])}</td>}
                {insts.map((i) => {
                  const c = row.cells[i.id]!;
                  const v = c.attrs?.[a];
                  const diff = c.status !== "missing" && row.referenceAttrs && !attrEquals(v, row.referenceAttrs[a]);
                  return (
                    <td key={i.id} className={cn("px-3 py-2 align-top", diff && "bg-amber-100 font-medium dark:bg-amber-950")}>
                      {c.status === "missing" ? "—" : formatAttr(v)}
                      {diff && <span className="sr-only"> (difiere)</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {Object.values(row.cells).some((c) => c?.diffs.some((d) => d.attr === "lov_options")) && (
        <Alert>Las opciones LOV distintas se completan desde el tipo “LOV Entries” → “Crear donde falta” (la API no permite renombrar ni reactivar opciones).</Alert>
      )}
      {row.key && canWrite && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={!hasMissing} onClick={() => onRemediate("create_missing")}>
            <PlusCircle className="h-4 w-4" /> Crear donde falta
          </Button>
          <Button variant="outline" disabled={!hasDiff} onClick={() => onRemediate("align")}>
            <Wand2 className="h-4 w-4" /> Alinear atributos
          </Button>
        </div>
      )}
      {!canWrite && <Badge>Solo lectura</Badge>}
    </div>
  );
}
