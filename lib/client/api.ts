/** Helper de fetch para el navegador. Solo habla con nuestros Route Handlers, nunca con Procore. */
export class ApiError extends Error {
  constructor(message: string, public status: number, public data?: unknown) {
    super(message);
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data as { error?: string; issues?: string[]; procoreMessage?: string };
    const msg = [d.error ?? `Error ${res.status}`, d.issues?.join("; "), d.procoreMessage].filter(Boolean).join(" — ");
    throw new ApiError(msg, res.status, data);
  }
  return data as T;
}
