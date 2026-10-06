"use client";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/misc";
import { Badge } from "@/components/status-badge";
import { EXECUTION_ORDER, SPECS } from "@/lib/adapters/specs";
import { api } from "@/lib/client/api";
import type { PublicInstance, SnapshotMeta } from "@/lib/client/types";
import { formatDate } from "@/lib/utils";

/** Lee de cada instancia los 5 tipos (una llamada corta por instancia × tipo) y guarda snapshots. */
export function SyncPanel({ instances, snapshots, onDone }: { instances: PublicInstance[]; snapshots: SnapshotMeta[]; onDone: () => void }) {
  const [running, setRunning] = useState<Record<string, string | null>>({});
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const busy = Object.values(running).some(Boolean);

  async function sync(ids: string[]) {
    const total = ids.length * EXECUTION_ORDER.length;
    setProgress({ done: 0, total });
    const queue = [...ids];
    await Promise.all(
      Array.from({ length: Math.min(2, queue.length) }, async () => {
        while (queue.length) {
          const id = queue.shift()!;
          for (const type of EXECUTION_ORDER) {
            setRunning((r) => ({ ...r, [id]: SPECS[type].label }));
            try {
              await api("/api/sync", { body: { instanceId: id, objectType: type } });
            } catch {
              /* el error queda guardado en el snapshot y se muestra abajo */
            }
            setProgress((p) => ({ ...p, done: p.done + 1 }));
          }
          setRunning((r) => ({ ...r, [id]: null }));
        }
      }),
    );
    onDone();
  }

  const last = (instanceId: string) => snapshots.filter((s) => s.instanceId === instanceId);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => sync(instances.map((i) => i.id))} loading={busy} disabled={!instances.length}>
          <RefreshCw className="h-4 w-4" /> Sincronizar / Leer instancias
        </Button>
        {busy && (
          <div className="flex min-w-[200px] flex-1 items-center gap-2">
            <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} />
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {progress.done}/{progress.total}
            </span>
          </div>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {instances.map((inst) => {
          const snaps = last(inst.id);
          const latest = snaps.map((s) => s.takenAt).sort().pop();
          const errors = snaps.filter((s) => !s.ok);
          return (
            <div key={inst.id} className="flex items-start justify-between gap-2 rounded-md border p-2.5 text-xs">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {inst.label} {inst.isGolden && <span title="Referencia">★</span>}
                </p>
                <p className="text-muted-foreground">{running[inst.id] ? `Leyendo ${running[inst.id]}…` : `Última sincronización: ${formatDate(latest)}`}</p>
                {errors.length > 0 && !running[inst.id] && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {errors.map((e) => (
                      <Badge key={e.objectType} color="red" icon="!" title={e.error ?? ""}>
                        {SPECS[e.objectType as keyof typeof SPECS]?.label ?? e.objectType}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <Button size="sm" variant="ghost" onClick={() => sync([inst.id])} disabled={busy} title="Sincronizar solo esta instancia">
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
