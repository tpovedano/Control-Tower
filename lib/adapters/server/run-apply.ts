import { ProcoreError, toErrorInfo } from "@/lib/procore/errors";
import type { ApplyResult } from "./types";

/** Ejecuta una escritura y la convierte en ApplyResult (sin lanzar). */
export async function runWrite(
  request: unknown,
  fn: () => Promise<{ status: number; data: unknown }>,
  getId: (data: unknown) => string | undefined,
  okMessage: string,
): Promise<ApplyResult> {
  try {
    const res = await fn();
    return { ok: true, httpStatus: res.status, remoteId: getId(res.data), message: okMessage, request, response: res.data };
  } catch (e) {
    const info = toErrorInfo(e);
    return {
      ok: false,
      httpStatus: info.status,
      message: info.procoreMessage && !info.message.includes(info.procoreMessage) ? `${info.message} — ${info.procoreMessage}` : info.message,
      request,
      response: e instanceof ProcoreError ? e.body ?? null : null,
    };
  }
}

export function idOf(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;
  const inner = d.data && typeof d.data === "object" && !Array.isArray(d.data) ? (d.data as Record<string, unknown>) : d;
  return inner.id !== undefined ? String(inner.id) : undefined;
}
