import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { InstanceRow, RunItemRow, RunRow } from "@/lib/db/schema";
import { getAdapter } from "@/lib/adapters/server";
import { newContext, type ApplyInput, type ApplyResult } from "@/lib/adapters/server/types";
import { getSpec } from "@/lib/adapters/specs";
import { toErrorInfo } from "@/lib/procore/errors";
import type { DesiredItem, NormalizedItem, ObjectType, PlanOptions, PlanResult } from "@/lib/types";
import { audit } from "./audit";
import { clientFor, getInstance } from "./instances";

// ---------------- Sincronización / snapshots ----------------

export async function syncInstanceType(instance: InstanceRow, objectType: ObjectType, user: string) {
  const adapter = getAdapter(objectType);
  const ctx = newContext(clientFor(instance));
  try {
    const items = await adapter.list(ctx);
    const [snap] = await db()
      .insert(schema.snapshots)
      .values({ instanceId: instance.id, objectType, ok: true, itemCount: items.length, items })
      .returning({ id: schema.snapshots.id, takenAt: schema.snapshots.takenAt });
    return { ok: true as const, count: items.length, takenAt: snap.takenAt.toISOString() };
  } catch (e) {
    const info = toErrorInfo(e);
    await db().insert(schema.snapshots).values({ instanceId: instance.id, objectType, ok: false, error: info.message, itemCount: 0, items: [] });
    await audit({ user, instanceId: instance.id, instanceLabel: instance.label, companyId: instance.companyId, objectType, action: "SYNC", result: "error", httpStatus: info.status, message: info.message });
    return { ok: false as const, error: info.message, status: info.status };
  }
}

export interface LatestSnapshot {
  instanceId: string;
  objectType: ObjectType;
  takenAt: string;
  ok: boolean;
  error: string | null;
  itemCount: number;
  items: NormalizedItem[];
}

/** Último snapshot por instancia y tipo. Si withItems=false no se cargan los elementos. */
export async function latestSnapshots(opts: { objectType?: ObjectType; withItems?: boolean; okOnly?: boolean } = {}): Promise<LatestSnapshot[]> {
  const typeFilter = opts.objectType ? sql`and s.object_type = ${opts.objectType}` : sql``;
  const okFilter = opts.okOnly ? sql`and s.ok = true` : sql``;
  const itemsCol = opts.withItems ? sql`s.items` : sql`'[]'::jsonb as items`;
  const res = await db().execute(sql`
    select distinct on (s.instance_id, s.object_type)
      s.instance_id, s.object_type, s.taken_at, s.ok, s.error, s.item_count, ${itemsCol}
    from snapshots s
    join instances i on i.id = s.instance_id and i.deleted_at is null
    where true ${typeFilter} ${okFilter}
    order by s.instance_id, s.object_type, s.taken_at desc
  `);
  const rows = (res as unknown as { rows: Record<string, unknown>[] }).rows ?? (res as unknown as Record<string, unknown>[]);
  return rows.map((r) => ({
    instanceId: String(r.instance_id),
    objectType: r.object_type as ObjectType,
    takenAt: new Date(r.taken_at as string).toISOString(),
    ok: Boolean(r.ok),
    error: (r.error as string) ?? null,
    itemCount: Number(r.item_count ?? 0),
    items: (r.items as NormalizedItem[]) ?? [],
  }));
}

export async function catalogMap(objectType: ObjectType): Promise<Map<string, NormalizedItem>> {
  const rows = await db().select().from(schema.catalogItems).where(eq(schema.catalogItems.objectType, objectType));
  return new Map(rows.map((r) => [r.key, r.item as NormalizedItem]));
}

// ---------------- Runs (dry-run + ejecución) ----------------

export async function createRun(args: {
  user: string;
  source: "cargar" | "gobierno";
  objectType: ObjectType;
  desired: DesiredItem[];
  instanceIds: string[];
  options: PlanOptions;
}): Promise<RunRow> {
  const [run] = await db()
    .insert(schema.runs)
    .values({
      createdBy: args.user,
      source: args.source,
      objectType: args.objectType,
      desired: args.desired,
      instanceIds: args.instanceIds,
      options: args.options,
      status: "planning",
    })
    .returning();
  return run;
}

export async function getRun(id: string): Promise<RunRow> {
  const [run] = await db().select().from(schema.runs).where(eq(schema.runs.id, id));
  if (!run) throw new Error("Ejecución no encontrada");
  return run;
}

export async function runItemsFor(runId: string, instanceId?: string): Promise<RunItemRow[]> {
  const where = instanceId ? and(eq(schema.runItems.runId, runId), eq(schema.runItems.instanceId, instanceId)) : eq(schema.runItems.runId, runId);
  return db().select().from(schema.runItems).where(where).orderBy(schema.runItems.rowIndex);
}

/** Aplica el alcance de la acción (p. ej. "solo crear lo que falta"). */
export function scopePlan(p: PlanResult, options: PlanOptions): PlanResult {
  if (!options.onlyActions || !(p.action === "CREATE" || p.action === "UPDATE")) return p;
  if (options.onlyActions.includes(p.action)) return p;
  return {
    ...p,
    action: "SKIP",
    message: p.action === "UPDATE" ? "Existe pero difiere: fuera del alcance de esta acción (usa “Alinear atributos”)." : "No existe: fuera del alcance de esta acción (usa “Crear donde falta”).",
  };
}

function statusForPlan(p: PlanResult): string {
  if (p.action === "CREATE" || p.action === "UPDATE") return "pending";
  if (p.action === "NOCHANGE") return "nochange";
  return "skipped";
}

/** Calcula el plan de una instancia leyendo su estado actual en vivo. */
export async function planRunInstance(run: RunRow, instanceId: string): Promise<RunItemRow[]> {
  if (!(run.instanceIds as string[]).includes(instanceId)) throw new Error("La instancia no pertenece a esta ejecución");
  if (run.status !== "planning" && run.status !== "planned") throw new Error("La ejecución ya fue confirmada; crea un nuevo dry-run.");
  const instance = await getInstance(instanceId);
  const objectType = run.objectType as ObjectType;
  const adapter = getAdapter(objectType);
  const ctx = newContext(clientFor(instance));
  const existing = await adapter.list(ctx);
  const desired = run.desired as DesiredItem[];
  const options = run.options as PlanOptions;

  const values = [];
  for (let i = 0; i < desired.length; i++) {
    const p = scopePlan(await adapter.plan(desired[i], existing, ctx, options), options);
    values.push({
      runId: run.id,
      instanceId,
      rowIndex: i,
      key: desired[i].key,
      action: p.action,
      diffs: p.diffs,
      message: p.message ?? null,
      remoteId: p.remoteId ?? null,
      status: statusForPlan(p),
    });
  }
  await db().delete(schema.runItems).where(and(eq(schema.runItems.runId, run.id), eq(schema.runItems.instanceId, instanceId)));
  const inserted = values.length ? await insertChunks(values) : [];
  return inserted.sort((a, b) => a.rowIndex - b.rowIndex);
}

async function insertChunks(values: (typeof schema.runItems.$inferInsert)[]): Promise<RunItemRow[]> {
  const out: RunItemRow[] = [];
  for (let i = 0; i < values.length; i += 200) {
    out.push(...(await db().insert(schema.runItems).values(values.slice(i, i + 200)).returning()));
  }
  return out;
}

export async function confirmRun(runId: string, user: string): Promise<RunRow> {
  const run = await getRun(runId);
  if (run.status === "planning") {
    const items = await runItemsFor(runId);
    const expected = (run.desired as unknown[]).length * (run.instanceIds as string[]).length;
    const planned = new Set(items.map((i) => i.instanceId));
    if (items.length !== expected || planned.size !== (run.instanceIds as string[]).length) {
      throw new Error("El dry-run aún no ha terminado para todas las instancias.");
    }
    run.status = "planned";
  }
  if (run.status === "planned") {
    const [updated] = await db()
      .update(schema.runs)
      .set({ status: "confirmed", confirmedAt: new Date(), confirmedBy: user })
      .where(eq(schema.runs.id, runId))
      .returning();
    await audit({ user, objectType: run.objectType, action: "CONFIRM", result: "info", runId, message: `Ejecución confirmada (${run.source})` });
    return updated;
  }
  return run;
}

/**
 * Ejecuta una tanda de elementos de una instancia. Vuelve a leer el estado en vivo y re-planifica cada
 * elemento justo antes de escribir: re-ejecutar el mismo lote nunca duplica (idempotencia por [ID]).
 */
export async function executeItems(runId: string, instanceId: string, itemIds: string[], user: string): Promise<RunItemRow[]> {
  const run = await getRun(runId);
  if (!run.confirmedAt) throw new Error("La ejecución no ha sido confirmada. Revisa el dry-run y confirma.");
  const items = (await runItemsFor(runId, instanceId)).filter((i) => itemIds.includes(i.id));
  if (items.length !== itemIds.length) throw new Error("Algunos elementos no pertenecen a esta ejecución/instancia.");
  const pending = items.filter((i) => i.status === "pending");
  if (!pending.length) return items;

  if (run.status !== "running") await db().update(schema.runs).set({ status: "running" }).where(eq(schema.runs.id, runId));

  const instance = await getInstance(instanceId);
  const objectType = run.objectType as ObjectType;
  const adapter = getAdapter(objectType);
  const spec = getSpec(objectType);
  const ctx = newContext(clientFor(instance));
  const desiredAll = run.desired as DesiredItem[];
  const options = run.options as PlanOptions;

  const base = { user, instanceId, instanceLabel: instance.label, companyId: instance.companyId, objectType, runId };
  let existing: NormalizedItem[];
  try {
    existing = await adapter.list(ctx);
  } catch (e) {
    const info = toErrorInfo(e);
    for (const item of pending) await setItem(item.id, { status: "error", resultMessage: `No se pudo leer la instancia: ${info.message}` });
    await audit({ ...base, action: "READ", result: "error", httpStatus: info.status, message: info.message });
    return runItemsFor(runId, instanceId).then((all) => all.filter((i) => itemIds.includes(i.id)));
  }

  const toApply: { item: RunItemRow; input: ApplyInput }[] = [];
  for (const item of pending) {
    const desired = desiredAll[item.rowIndex];
    if (!spec.writable) {
      await setItem(item.id, { status: "skipped", resultMessage: spec.readOnlyReason ?? "Solo lectura" });
      continue;
    }
    const plan = scopePlan(await adapter.plan(desired, existing, ctx, options), options);
    if (plan.action === "NOCHANGE") {
      await setItem(item.id, { status: "nochange", resultMessage: "Ya estaba aplicado (sin cambios).", remoteId: plan.remoteId ?? null });
      continue;
    }
    if (plan.action === "SKIP") {
      await setItem(item.id, { status: "skipped", resultMessage: plan.message ?? "Omitido" });
      continue;
    }
    const current = plan.remoteId ? existing.find((e) => e.remoteId === plan.remoteId) : undefined;
    toApply.push({ item, input: { desired, plan, current } });
  }

  if (toApply.length) {
    let results: ApplyResult[];
    try {
      results = await adapter.apply(
        toApply.map((t) => t.input),
        ctx,
        options,
      );
    } catch (e) {
      const info = toErrorInfo(e);
      results = toApply.map(() => ({ ok: false, message: info.message, httpStatus: info.status, request: null, response: null }));
    }
    for (let i = 0; i < toApply.length; i++) {
      const { item, input } = toApply[i];
      const r = results[i];
      await setItem(item.id, {
        status: r.ok ? "success" : "error",
        resultMessage: r.message,
        remoteId: r.remoteId ?? input.plan.remoteId ?? null,
        action: input.plan.action,
        diffs: input.plan.diffs,
      });
      await audit({
        ...base,
        key: item.key,
        action: input.plan.action,
        result: r.ok ? "success" : "error",
        httpStatus: r.httpStatus ?? null,
        message: r.message,
        requestPayload: r.request,
        responseBody: r.response,
      });
    }
  }

  return runItemsFor(runId, instanceId).then((all) => all.filter((i) => itemIds.includes(i.id)));
}

async function setItem(id: string, patch: Partial<typeof schema.runItems.$inferInsert>) {
  await db()
    .update(schema.runItems)
    .set({ ...patch, executedAt: new Date() })
    .where(eq(schema.runItems.id, id));
}

/** Vuelve a dejar como pendientes los elementos con error (para "Reintentar solo los fallidos"). */
export async function resetFailed(runId: string, instanceId?: string): Promise<number> {
  const where = instanceId
    ? and(eq(schema.runItems.runId, runId), eq(schema.runItems.instanceId, instanceId), eq(schema.runItems.status, "error"))
    : and(eq(schema.runItems.runId, runId), eq(schema.runItems.status, "error"));
  const rows = await db().update(schema.runItems).set({ status: "pending", resultMessage: null }).where(where).returning({ id: schema.runItems.id });
  return rows.length;
}

export async function finishRunIfDone(runId: string) {
  const items = await runItemsFor(runId);
  if (!items.some((i) => i.status === "pending")) await db().update(schema.runs).set({ status: "done" }).where(eq(schema.runs.id, runId));
}

export async function recentRuns(limit = 20) {
  return db().select().from(schema.runs).orderBy(desc(schema.runs.createdAt)).limit(limit);
}

export async function instancesByIds(ids: string[]) {
  if (!ids.length) return [];
  return db().select().from(schema.instances).where(inArray(schema.instances.id, ids));
}
