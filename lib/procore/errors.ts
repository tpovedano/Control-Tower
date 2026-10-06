export type ProcoreErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation"
  | "rate_limited"
  | "server"
  | "network"
  | "config"
  | "unknown";

/** Error de Procore con mensaje legible en español y el mensaje original. */
export class ProcoreError extends Error {
  constructor(
    public readonly code: ProcoreErrorCode,
    message: string,
    public readonly status?: number,
    public readonly procoreMessage?: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ProcoreError";
  }

  toJSON() {
    return { code: this.code, message: this.message, status: this.status, procoreMessage: this.procoreMessage };
  }
}

/** Extrae el mensaje de error de las distintas formas de respuesta de Procore. */
export function extractProcoreMessage(body: unknown): string | undefined {
  if (!body) return undefined;
  if (typeof body === "string") return body.slice(0, 500);
  if (typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof b.message === "string") parts.push(b.message);
  if (typeof b.error === "string") parts.push(b.error);
  if (b.error && typeof b.error === "object") {
    const e = b.error as Record<string, unknown>;
    if (typeof e.message === "string") parts.push(e.message);
    if (e.details) parts.push(JSON.stringify(e.details));
  }
  if (typeof b.error_description === "string") parts.push(b.error_description);
  if (b.errors) {
    if (typeof b.errors === "string") parts.push(b.errors);
    else if (Array.isArray(b.errors)) parts.push(b.errors.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("; "));
    else if (typeof b.errors === "object") {
      for (const [k, v] of Object.entries(b.errors as Record<string, unknown>)) {
        parts.push(`${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
      }
    }
  }
  return parts.length ? parts.join(" · ").slice(0, 1000) : undefined;
}

export function errorFromResponse(status: number, body: unknown, resource?: string): ProcoreError {
  const original = extractProcoreMessage(body);
  const what = resource ? ` (${resource})` : "";
  switch (true) {
    case status === 401:
      return new ProcoreError("unauthorized", `Token inválido o expirado: la credencial no fue aceptada por Procore${what}.`, status, original, body);
    case status === 403:
      return new ProcoreError(
        "forbidden",
        `Permiso denegado: la credencial no tiene acceso a ${resource ?? "este recurso"} en esta company.`,
        status,
        original,
        body,
      );
    case status === 404:
      return new ProcoreError("not_found", `No encontrado${what}. Revisa el company_id o el ID del elemento.`, status, original, body);
    case status === 422 || status === 400:
      return new ProcoreError("validation", `Procore rechazó los datos${what}: ${original ?? "error de validación"}`, status, original, body);
    case status === 429:
      return new ProcoreError("rate_limited", `Límite de peticiones de Procore alcanzado${what}. Intenta de nuevo en unos minutos.`, status, original, body);
    case status >= 500:
      return new ProcoreError("server", `Error interno de Procore (${status})${what}. Reintenta más tarde.`, status, original, body);
    default:
      return new ProcoreError("unknown", `Respuesta inesperada de Procore (${status})${what}.`, status, original, body);
  }
}

export function toErrorInfo(err: unknown): { code: string; message: string; status?: number; procoreMessage?: string } {
  if (err instanceof ProcoreError) return err.toJSON();
  if (err instanceof Error) return { code: "unknown", message: err.message };
  return { code: "unknown", message: String(err) };
}
