"use client";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Download, Play, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Checkbox, Progress, Spinner } from "@/components/ui/misc";
import { ActionBadge, Badge, ItemStatusBadge } from "@/components/status-badge";
import { formatAttr } from "@/lib/adapters/spec-types";
import { getSpec } from "@/lib/adapters/specs";
import { api } from "@/lib/client/api";
import type { PublicInstance, RunItem } from "@/lib/client/types";
import { toCsv } from "@/lib/paste/parse";
import type { ObjectType } from "@/lib/types";
import { t } from "@/lib/i18n";
import { downloadText } from "@/lib/utils";

type Phase = "creating" | "planning" | "planned" | "executing" | "done" | "failed";

interface PlanResponse {
  runId: string | null;
  instanceIds?: string[];
  count?: number;
  problems: string[];
}

const EXEC_CHUNK = 10;

/** Orquesta el dry-run y la ejecución desde el cliente con llamadas cortas (compatible con los límites de Vercel). */
export function RunFlow({
  request,
  instances,
  objectType,
  onFinished,
}: {
  /** Cuerpo para POST /api/plan. Cambiarlo reinicia el flujo. */
  request: Record<string, unknown>;
  instances: PublicInstance[];
  objectType: ObjectType;
  onFinished?: () => void;
}) {
  const spec = getSpec(objectType);
  const [phase, setPhase] = useState<Phase>("creating");
  const [runId, setRunId] = useState<string | null>(null);
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [items, setItems] = useState<Record<string, RunItem[]>>({});
  const [planErrors, setPlanErrors] = useState<Record<string, string>>({});
  const [planning, setPlanning] = useState<Record<string, boolean>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyChanges, setOnlyChanges] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [execProgress, setExecProgress] = useState({ done: 0, total: 0 });
  const started = useRef<string>("");

  const instById = useMemo(() => new Map(instances.map((i) => [i.id, i])), [instances]);
  const label = (id: string) => instById.get(id)?.label ?? id.slice(0, 8);

  const planInstance = useCallback(async (rid: string, instanceId: string) => {
    setPlanning((p) => ({ ...p, [instanceId]: true }));
    setPlanErrors((e) => {
      const { [instanceId]: _drop, ...rest } = e;
      return rest;
    });
    try {
      const r = await api<{ items: RunItem[] }>(`/api/plan/${rid}`, { body: { instanceId } });
      setItems((prev) => ({ ...prev, [instanceId]: r.items }));
    } catch (e) {
      setPlanErrors((p) => ({ ...p, [instanceId]: (e as Error).message }));
    } finally {
      setPlanning((p) => ({ ...p, [instanceId]: false }));
    }
  }, []);

  // 1) Crear la ejecución y 2) dry-run por instancia (2 en paralelo).
  useEffect(() => {
    const sig = JSON.stringify(request);
    if (started.current === sig) return;
    started.current = sig;
    (async () => {
      setPhase("creating");
      setItems({});
      setPlanErrors({});
      setError(null);
      try {
        const r = await api<PlanResponse>("/api/plan", { body: request });
        setProblems(r.problems ?? []);
        if (!r.runId) {
          setPhase("failed");
          return;
        }
        setRunId(r.runId);
        const ids = r.instanceIds ?? [];
        setTargetIds(ids);
        setPhase("planning");
        const queue = [...ids];
        await Promise.all(
          Array.from({ length: Math.min(2, queue.length) }, async () => {
            while (queue.length) await planInstance(r.runId!, queue.shift()!);
          }),
        );
        setPhase("planned");
      } catch (e) {
        setError((e as Error).message);
        setPhase("failed");
      }
    })();
  }, [request, planInstance]);

  const allItems = useMemo(() => Object.values(items).flat(), [items]);
  const totals = useMemo(() => {
    const out = { CREATE: 0, UPDATE: 0, NOCHANGE: 0, SKIP: 0 } as Record<RunItem["action"], number>;
    for (const i of allItems) out[i.action]++;
    return out;
  }, [allItems]);
  const pendingCount = allItems.filter((i) => i.status === "pending").length;
  const failedCount = allItems.filter((i) => i.status === "error").length;
  const instancesWithWrites = new Set(allItems.filter((i) => i.status === "pending").map((i) => i.instanceId)).size;
  const fullyPlanned = targetIds.length > 0 && targetIds.every((id) => items[id]) && !Object.keys(planErrors).length;

  // Filas = [ID]; columnas = instancias.
  const rows = useMemo(() => {
    const byKey = new Map<string, { key: string; rowIndex: number; cells: Record<string, RunItem> }>();
    for (const it of allItems) {
      const r = byKey.get(it.key) ?? { key: it.key, rowIndex: it.rowIndex, cells: {} };
      r.cells[it.instanceId] = it;
      byKey.set(it.key, r);
    }
    let list = [...byKey.values()].sort((a, b) => a.rowIndex - b.rowIndex);
    if (onlyChanges) list = list.filter((r) => Object.values(r.cells).some((c) => c.action !== "NOCHANGE"));
    return list;
  }, [allItems, onlyChanges]);

  async function confirmAndExecute() {
    if (!runId) return;
    setConfirmOpen(false);
    setError(null);
    try {
      await api(`/api/runs/${runId}/confirm`, { body: { confirm: true, expectedWrites: pendingCount } });
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    await execute();
  }

  async function execute(source: Record<string, RunItem[]> = items) {
    if (!runId) return;
    setPhase("executing");
    const pending = Object.values(source)
      .flat()
      .filter((i) => i.status === "pending");
    setExecProgress({ done: 0, total: pending.length });
    const byInstance = new Map<string, RunItem[]>();
    for (const it of pending) byInstance.set(it.instanceId, [...(byInstance.get(it.instanceId) ?? []), it]);

    // Las instancias se procesan en paralelo (2); dentro de cada una, tandas cortas en orden.
    const queue = [...byInstance.keys()];
    await Promise.all(
      Array.from({ length: Math.min(2, queue.length) }, async () => {
        while (queue.length) {
          const instanceId = queue.shift()!;
          for (const chunk of chunksFor(objectType, byInstance.get(instanceId)!)) {
            try {
              const r = await api<{ items: RunItem[] }>("/api/execute", { body: { runId, instanceId, itemIds: chunk.map((c) => c.id) } });
              mergeItems(r.items);
            } catch (e) {
              const msg = (e as Error).message;
              mergeItems(chunk.map((c) => ({ ...c, status: "error", resultMessage: msg })));
            }
            setExecProgress((p) => ({ ...p, done: p.done + chunk.length }));
          }
        }
      }),
    );
    setPhase("done");
    onFinished?.();
  }

  function mergeItems(updated: RunItem[]) {
    setItems((prev) => {
      const next = { ...prev };
      for (const u of updated) next[u.instanceId] = (next[u.instanceId] ?? []).map((i) => (i.id === u.id ? u : i));
      return next;
    });
  }

  async function retryFailed() {
    if (!runId) return;
    const r = await api<{ count: number; items: RunItem[] }>(`/api/runs/${runId}/retry`, { body: {} });
    const grouped: Record<string, RunItem[]> = {};
    for (const it of r.items) (grouped[it.instanceId] ??= []).push(it);
    setItems(grouped);
    // Se re-planifica en el servidor justo antes de escribir: los que ya existan quedan como "sin cambios".
    await execute(grouped);
  }

  function downloadReport() {
    const header = ["Fila", "ID", "Instancia", "Company ID", "Acción planificada", "Estado", "Diferencias", "Mensaje del plan", "Resultado / respuesta de Procore", "ID en Procore"];
    const data = allItems
      .sort((a, b) => a.rowIndex - b.rowIndex)
      .map((i) => [
        i.rowIndex + 1,
        i.key,
        label(i.instanceId),
        instById.get(i.instanceId)?.companyId ?? "",
        t.actions[i.action],
        (t.itemStatus as Record<string, string>)[i.status] ?? i.status,
        i.diffs.map((d) => `${spec.attrLabels[d.attr] ?? d.attr}: ${formatAttr(d.current as never)} → ${formatAttr(d.desired as never)}`).join("; "),
        i.message ?? "",
        i.resultMessage ?? "",
        i.remoteId ?? "",
      ]);
    downloadText(toCsv([header, ...data]), `reporte-${objectType}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`);
  }

  if (phase === "creating") {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Spinner /> Preparando el dry-run…
      </div>
    );
  }

  if (phase === "failed") {
    return (
      <div className="space-y-2">
        {error && <Alert variant="error">{error}</Alert>}
        {problems.length > 0 && (
          <Alert variant="warning">
            <p className="font-medium">No se pudo preparar la ejecución:</p>
            <ul className="mt-1 list-disc pl-5">
              {problems.slice(0, 20).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Alert>
        )}
      </div>
    );
  }

  const execPct = execProgress.total ? (execProgress.done / execProgress.total) * 100 : 0;

  return (
    <div className="space-y-4">
      {problems.length > 0 && (
        <Alert variant="warning">
          {problems.slice(0, 10).map((p) => (
            <p key={p}>{p}</p>
          ))}
        </Alert>
      )}
      {!spec.writable && <Alert variant="warning">{spec.readOnlyReason}</Alert>}

      {/* Resumen */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(["CREATE", "UPDATE", "NOCHANGE", "SKIP"] as const).map((a) => (
          <div key={a} className="rounded-md border p-3">
            <ActionBadge action={a} />
            <p className="mt-1 text-2xl font-semibold tabular-nums">{totals[a]}</p>
          </div>
        ))}
      </div>

      {/* Estado por instancia */}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Instancia</th>
              <th className="px-3 py-2">Dry-run</th>
              {(["CREATE", "UPDATE", "NOCHANGE", "SKIP"] as const).map((a) => (
                <th key={a} className="px-3 py-2 text-right">
                  {t.actions[a]}
                </th>
              ))}
              <th className="px-3 py-2 text-right">Éxito</th>
              <th className="px-3 py-2 text-right">Error</th>
            </tr>
          </thead>
          <tbody>
            {targetIds.map((id) => {
              const list = items[id] ?? [];
              const count = (a: string) => list.filter((i) => i.action === a).length;
              return (
                <tr key={id} className="border-t">
                  <td className="px-3 py-2 font-medium">{label(id)}</td>
                  <td className="px-3 py-2">
                    {planning[id] ? (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Spinner className="h-3 w-3" /> leyendo…
                      </span>
                    ) : planErrors[id] ? (
                      <span className="flex items-center gap-2">
                        <Badge color="red" icon="❌" title={planErrors[id]}>
                          Error
                        </Badge>
                        <span className="max-w-xs truncate text-xs text-red-600" title={planErrors[id]}>
                          {planErrors[id]}
                        </span>
                        {phase === "planned" && runId && (
                          <Button size="sm" variant="ghost" onClick={() => planInstance(runId, id)}>
                            <RefreshCw className="h-3 w-3" />
                          </Button>
                        )}
                      </span>
                    ) : items[id] ? (
                      <Badge color="green" icon="✓">
                        Listo
                      </Badge>
                    ) : (
                      <Badge>En cola</Badge>
                    )}
                  </td>
                  {(["CREATE", "UPDATE", "NOCHANGE", "SKIP"] as const).map((a) => (
                    <td key={a} className="px-3 py-2 text-right tabular-nums">
                      {count(a)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{list.filter((i) => i.status === "success").length}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-red-600">{list.filter((i) => i.status === "error").length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Acciones */}
      <div className="flex flex-wrap items-center gap-2">
        {(phase === "planned" || phase === "planning") && (
          <Button onClick={() => (setAck(false), setConfirmOpen(true))} disabled={phase !== "planned" || !fullyPlanned || pendingCount === 0}>
            <Play className="h-4 w-4" /> Ejecutar {pendingCount} cambio{pendingCount === 1 ? "" : "s"}
          </Button>
        )}
        {phase === "planned" && pendingCount === 0 && fullyPlanned && <span className="text-sm text-muted-foreground">No hay nada que escribir: todo está al día o se omitirá.</span>}
        {phase === "planned" && !fullyPlanned && Object.keys(planErrors).length > 0 && (
          <span className="text-sm text-red-600">Hay instancias con error en el dry-run: reinténtalas o quítalas del lote antes de ejecutar.</span>
        )}
        {phase === "done" && failedCount > 0 && (
          <Button variant="outline" onClick={retryFailed}>
            <RotateCcw className="h-4 w-4" /> Reintentar solo los fallidos ({failedCount})
          </Button>
        )}
        {allItems.length > 0 && (
          <Button variant="outline" onClick={downloadReport}>
            <Download className="h-4 w-4" /> Descargar reporte CSV
          </Button>
        )}
        <label className="ml-auto flex items-center gap-2 text-sm">
          <Checkbox checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} /> Solo filas con cambios u omisiones
        </label>
      </div>

      {phase === "executing" && (
        <div className="space-y-1">
          <Progress value={execPct} />
          <p className="text-xs text-muted-foreground">
            Ejecutando… {execProgress.done}/{execProgress.total}. No cierres esta pestaña.
          </p>
        </div>
      )}
      {phase === "done" && (
        <Alert variant={failedCount ? "warning" : "info"}>
          Ejecución terminada: {allItems.filter((i) => i.status === "success").length} correctos, {failedCount} con error,{" "}
          {allItems.filter((i) => i.status === "nochange").length} sin cambios, {allItems.filter((i) => i.status === "skipped").length} omitidos.
        </Alert>
      )}
      {error && <Alert variant="error">{error}</Alert>}

      {/* Detalle fila × instancia */}
      <div className="max-h-[60vh] overflow-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="w-6 px-2 py-2" />
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">ID</th>
              {targetIds.map((id) => (
                <th key={id} className="px-3 py-2">
                  {label(id)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={3 + targetIds.length} className="px-3 py-6 text-center text-muted-foreground">
                  {allItems.length ? "Todas las filas están sin cambios." : "Esperando el dry-run…"}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <Fragment key={r.key}>
                <tr className="cursor-pointer border-t hover:bg-accent/40" onClick={() => setExpanded((x) => ({ ...x, [r.key]: !x[r.key] }))}>
                  <td className="px-2 py-1.5">{expanded[r.key] ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</td>
                  <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{r.rowIndex + 1}</td>
                  <td className="px-3 py-1.5 font-mono text-xs">[{r.key}]</td>
                  {targetIds.map((id) => {
                    const c = r.cells[id];
                    return (
                      <td key={id} className="px-3 py-1.5">
                        {c ? (
                          <div className="flex flex-wrap items-center gap-1" title={c.resultMessage ?? c.message ?? ""}>
                            <ActionBadge action={c.action} />
                            {c.status !== "pending" && c.status !== "nochange" && c.status !== "skipped" && <ItemStatusBadge status={c.status} />}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
                {expanded[r.key] && (
                  <tr className="bg-muted/30">
                    <td />
                    <td colSpan={2 + targetIds.length} className="px-3 py-2">
                      <ul className="space-y-1.5 text-xs">
                        {targetIds.map((id) => {
                          const c = r.cells[id];
                          if (!c) return null;
                          return (
                            <li key={id}>
                              <strong>{label(id)}:</strong> {t.actions[c.action]}
                              {c.diffs.length > 0 && (
                                <span>
                                  {" "}
                                  — {c.diffs.map((d) => `${spec.attrLabels[d.attr] ?? d.attr}: ${formatAttr(d.current as never)} → ${formatAttr(d.desired as never)}`).join("; ")}
                                </span>
                              )}
                              {c.message && <span className="text-muted-foreground"> — {c.message}</span>}
                              {c.resultMessage && (
                                <span className={c.status === "error" ? "text-red-600" : "text-emerald-700 dark:text-emerald-400"}> — Resultado: {c.resultMessage}</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirmar ejecución"
        description="Esta acción escribe en Procore. Revisa el resumen antes de continuar."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={confirmAndExecute} disabled={!ack}>
              Ejecutar ahora
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="rounded-md bg-muted p-3 font-medium">
            Se crearán {allItems.filter((i) => i.status === "pending" && i.action === "CREATE").length} y se actualizarán{" "}
            {allItems.filter((i) => i.status === "pending" && i.action === "UPDATE").length} elementos de tipo {spec.label} en {instancesWithWrites} instancia
            {instancesWithWrites === 1 ? "" : "s"}.
          </p>
          <p className="text-muted-foreground">No se borra nada. Cada escritura queda registrada en el Historial.</p>
          <label className="flex items-center gap-2">
            <Checkbox checked={ack} onChange={(e) => setAck(e.target.checked)} /> He revisado el dry-run y quiero ejecutarlo.
          </label>
        </div>
      </Dialog>
    </div>
  );
}

/** Tandas por llamada. Las opciones LOV se agrupan por custom field padre para preservar su orden. */
function chunksFor(objectType: ObjectType, list: RunItem[]): RunItem[][] {
  const sorted = [...list].sort((a, b) => a.rowIndex - b.rowIndex);
  if (objectType === "lov_entries") {
    const byParent = new Map<string, RunItem[]>();
    for (const i of sorted) {
      const parent = i.key.split("/")[0];
      byParent.set(parent, [...(byParent.get(parent) ?? []), i]);
    }
    const out: RunItem[][] = [];
    for (const group of byParent.values()) for (let i = 0; i < group.length; i += 100) out.push(group.slice(i, i + 100));
    return out;
  }
  const out: RunItem[][] = [];
  for (let i = 0; i < sorted.length; i += EXEC_CHUNK) out.push(sorted.slice(i, i + EXEC_CHUNK));
  return out;
}
