import type { ProcoreClient } from "@/lib/procore/client";
import type { DependencyCheck } from "@/lib/diff/plan";
import type { DesiredItem, NormalizedItem, PlanOptions, PlanResult } from "@/lib/types";
import type { ObjectSpec } from "../spec-types";

export interface AdapterContext {
  client: ProcoreClient;
  companyId: string;
  /** Memo por petición (p. ej. la lista de custom fields la necesitan LOV y field sets). */
  memo: Map<string, Promise<unknown>>;
}

export function newContext(client: ProcoreClient): AdapterContext {
  return { client, companyId: client.companyId, memo: new Map() };
}

export function memo<T>(ctx: AdapterContext, key: string, fn: () => Promise<T>): Promise<T> {
  let p = ctx.memo.get(key) as Promise<T> | undefined;
  if (!p) {
    p = fn();
    ctx.memo.set(key, p);
    p.catch(() => ctx.memo.delete(key));
  }
  return p;
}

export function invalidate(ctx: AdapterContext, key?: string) {
  if (key) ctx.memo.delete(key);
  else ctx.memo.clear();
}

export interface ApplyResult {
  ok: boolean;
  remoteId?: string;
  httpStatus?: number;
  message: string;
  request: unknown;
  response: unknown;
}

export interface ApplyInput {
  desired: DesiredItem;
  plan: PlanResult;
  current?: NormalizedItem;
}

/** Interfaz común de los adaptadores: añadir un tipo de objeto = añadir un archivo que la implemente. */
export interface ServerAdapter {
  spec: ObjectSpec;
  /** Lee todos los elementos de la instancia (con paginación completa) y los normaliza. */
  list(ctx: AdapterContext): Promise<NormalizedItem[]>;
  /** Convierte un objeto crudo de Procore al modelo normalizado. */
  normalize(raw: Record<string, unknown>, ...args: never[]): NormalizedItem;
  /** Dependencias faltantes en la instancia destino. */
  dependencies?(desired: DesiredItem, ctx: AdapterContext): Promise<DependencyCheck>;
  /** Plan (dry-run) de un elemento. */
  plan(desired: DesiredItem, existing: NormalizedItem[], ctx: AdapterContext, options: PlanOptions): Promise<PlanResult>;
  /** Aplica varios elementos ya planificados (CREATE/UPDATE). */
  apply(inputs: ApplyInput[], ctx: AdapterContext, options: PlanOptions): Promise<ApplyResult[]>;
  /** Construye un elemento deseado a partir de uno existente (para remediación desde la matriz). */
  toDesired(item: NormalizedItem): DesiredItem;
}

export function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export function pickAttrs(item: NormalizedItem, keys: string[]) {
  const out: Record<string, NormalizedItem["attrs"][string]> = {};
  for (const k of keys) out[k] = item.attrs[k] ?? null;
  return out;
}
