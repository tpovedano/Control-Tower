"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Alert, EmptyState, Spinner } from "@/components/ui/misc";
import { Badge } from "@/components/status-badge";
import { EXECUTION_ORDER, SPECS } from "@/lib/adapters/specs";
import { api } from "@/lib/client/api";
import type { PublicInstance } from "@/lib/client/types";
import type { ObjectType } from "@/lib/types";
import { formatDate } from "@/lib/utils";

interface Entry {
  id: string;
  at: string;
  user: string;
  instanceId: string | null;
  instanceLabel: string | null;
  companyId: string | null;
  objectType: string | null;
  key: string | null;
  action: string;
  result: "success" | "error" | "info";
  httpStatus: number | null;
  message: string | null;
  requestPayload: unknown;
  responseBody: unknown;
  runId: string | null;
}

const ACTIONS: Record<string, string> = {
  CREATE: "Crear",
  UPDATE: "Actualizar",
  SYNC: "Sincronizar",
  READ: "Leer",
  TEST: "Probar conexión",
  CONFIRM: "Confirmar ejecución",
  INSTANCE_CREATE: "Alta de instancia",
  INSTANCE_UPDATE: "Edición de instancia",
  INSTANCE_DISABLE: "Baja de instancia",
  OAUTH_AUTHORIZE: "Autorización OAuth",
  CATALOG_SET: "Catálogo guardado",
  CATALOG_CLEAR: "Catálogo vaciado",
};

export function HistorialView() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [instances, setInstances] = useState<PublicInstance[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [f, setF] = useState({ q: "", instanceId: "", objectType: "", result: "", action: "", from: "", to: "" });

  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();

  const load = useCallback(async () => {
    setEntries(null);
    setError(null);
    try {
      setEntries((await api<{ entries: Entry[] }>(`/api/historial?${qs}`)).entries);
    } catch (e) {
      setError((e as Error).message);
      setEntries([]);
    }
  }, [qs]);

  useEffect(() => {
    api<{ instances: PublicInstance[] }>("/api/instancias")
      .then((r) => setInstances(r.instances))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    const id = setTimeout(load, 250);
    return () => clearTimeout(id);
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Historial</h1>
          <p className="text-sm text-muted-foreground">Quién creó o cambió qué, cuándo y dónde. Los payloads no contienen secretos.</p>
        </div>
        <a href={`/api/historial?${qs}${qs ? "&" : ""}format=csv`}>
          <Button variant="outline">
            <Download className="h-4 w-4" /> Exportar CSV
          </Button>
        </a>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        <div className="col-span-2">
          <Label className="text-xs" htmlFor="hq">
            Buscar ([ID], usuario, mensaje)
          </Label>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input id="hq" className="pl-8" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
          </div>
        </div>
        <div>
          <Label className="text-xs" htmlFor="hi">
            Instancia
          </Label>
          <Select id="hi" value={f.instanceId} onChange={(e) => setF({ ...f, instanceId: e.target.value })}>
            <option value="">Todas</option>
            {instances.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label className="text-xs" htmlFor="ht">
            Tipo
          </Label>
          <Select id="ht" value={f.objectType} onChange={(e) => setF({ ...f, objectType: e.target.value })}>
            <option value="">Todos</option>
            {EXECUTION_ORDER.map((tp) => (
              <option key={tp} value={tp}>
                {SPECS[tp].label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label className="text-xs" htmlFor="ha">
            Acción
          </Label>
          <Select id="ha" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>
            <option value="">Todas</option>
            {Object.entries(ACTIONS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label className="text-xs" htmlFor="hr">
            Resultado
          </Label>
          <Select id="hr" value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })}>
            <option value="">Todos</option>
            <option value="success">Éxito</option>
            <option value="error">Error</option>
            <option value="info">Info</option>
          </Select>
        </div>
        <div className="col-span-2 grid grid-cols-2 gap-2 md:col-span-1">
          <div>
            <Label className="text-xs" htmlFor="hf">
              Desde
            </Label>
            <Input id="hf" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs" htmlFor="hto">
              Hasta
            </Label>
            <Input id="hto" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
          </div>
        </div>
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {entries === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Cargando…
        </div>
      ) : entries.length === 0 ? (
        <EmptyState title="Sin registros">Aún no hay actividad que coincida con los filtros.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs">
              <tr>
                <th className="w-6" />
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Usuario</th>
                <th className="px-3 py-2">Instancia</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">[ID]</th>
                <th className="px-3 py-2">Acción</th>
                <th className="px-3 py-2">Resultado</th>
                <th className="px-3 py-2">Mensaje</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <Fragment key={e.id}>
                  <tr className="cursor-pointer border-t hover:bg-accent/40" onClick={() => setOpen((o) => ({ ...o, [e.id]: !o[e.id] }))}>
                    <td className="px-2">{open[e.id] ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</td>
                    <td className="whitespace-nowrap px-3 py-2">{formatDate(e.at)}</td>
                    <td className="px-3 py-2">{e.user}</td>
                    <td className="px-3 py-2">{e.instanceLabel ?? "—"}</td>
                    <td className="px-3 py-2">{e.objectType ? SPECS[e.objectType as ObjectType]?.label ?? e.objectType : "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{e.key ? `[${e.key}]` : "—"}</td>
                    <td className="px-3 py-2">{ACTIONS[e.action] ?? e.action}</td>
                    <td className="px-3 py-2">
                      {e.result === "success" ? (
                        <Badge color="green" icon="✅">
                          Éxito
                        </Badge>
                      ) : e.result === "error" ? (
                        <Badge color="red" icon="❌">
                          Error{e.httpStatus ? ` ${e.httpStatus}` : ""}
                        </Badge>
                      ) : (
                        <Badge icon="ℹ">Info</Badge>
                      )}
                    </td>
                    <td className="max-w-md truncate px-3 py-2" title={e.message ?? ""}>
                      {e.message}
                    </td>
                  </tr>
                  {open[e.id] && (
                    <tr className="bg-muted/30">
                      <td />
                      <td colSpan={8} className="space-y-2 px-3 py-2 text-xs">
                        <p>
                          Company ID: {e.companyId ?? "—"} · Ejecución: {e.runId ?? "—"}
                        </p>
                        <div className="grid gap-2 md:grid-cols-2">
                          <div>
                            <p className="font-medium">Payload enviado</p>
                            <pre className="max-h-64 overflow-auto rounded bg-background p-2">{e.requestPayload ? JSON.stringify(e.requestPayload, null, 2) : "—"}</pre>
                          </div>
                          <div>
                            <p className="font-medium">Respuesta de Procore</p>
                            <pre className="max-h-64 overflow-auto rounded bg-background p-2">{e.responseBody ? JSON.stringify(e.responseBody, null, 2) : "—"}</pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          {entries.length >= 200 && <p className="p-2 text-center text-xs text-muted-foreground">Se muestran los 200 más recientes; usa filtros o exporta a CSV para ver todo.</p>}
        </div>
      )}
    </div>
  );
}
