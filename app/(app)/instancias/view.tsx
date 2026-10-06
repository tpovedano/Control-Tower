"use client";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, KeyRound, Pencil, Plug, Plus, Star, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { Alert, Checkbox, EmptyState, Spinner } from "@/components/ui/misc";
import { Badge } from "@/components/status-badge";
import { api } from "@/lib/client/api";
import type { PublicInstance } from "@/lib/client/types";
import { formatDate } from "@/lib/utils";

interface TestResult {
  ok: boolean;
  message: string;
  procoreMessage?: string;
  checks: { label: string; ok: boolean; message: string }[];
}

const EMPTY = {
  label: "",
  companyId: "",
  language: "es",
  environment: "production" as "production" | "sandbox",
  authMethod: "client_credentials" as "client_credentials" | "authorization_code",
  clientId: "",
  clientSecret: "",
  clearCustomCredentials: false,
  isGolden: false,
};

export function InstanciasView() {
  const params = useSearchParams();
  const [instances, setInstances] = useState<PublicInstance[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PublicInstance | "new" | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestResult>>({});
  const [toDisable, setToDisable] = useState<PublicInstance | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ instances: PublicInstance[] }>("/api/instancias");
      setInstances(r.instances);
    } catch (e) {
      setError((e as Error).message);
      setInstances([]);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  function openForm(inst: PublicInstance | "new") {
    setEditing(inst);
    setFormError(null);
    setForm(
      inst === "new"
        ? EMPTY
        : { ...EMPTY, label: inst.label, companyId: inst.companyId, language: inst.language, environment: inst.environment, authMethod: inst.authMethod, isGolden: inst.isGolden },
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const body = { ...form, clientId: form.clientId || undefined, clientSecret: form.clientSecret || undefined };
      if (editing === "new") await api("/api/instancias", { body });
      else if (editing) await api(`/api/instancias/${editing.id}`, { method: "PATCH", body });
      setEditing(null);
      await load();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function test(inst: PublicInstance) {
    setTesting(inst.id);
    try {
      const r = await api<TestResult>(`/api/instancias/${inst.id}/test`, { method: "POST", body: {} });
      setTests((t) => ({ ...t, [inst.id]: r }));
    } catch (e) {
      setTests((t) => ({ ...t, [inst.id]: { ok: false, message: (e as Error).message, checks: [] } }));
    } finally {
      setTesting(null);
      load();
    }
  }

  async function disable() {
    if (!toDisable) return;
    await api(`/api/instancias/${toDisable.id}`, { method: "DELETE" });
    setToDisable(null);
    load();
  }

  async function setGolden(inst: PublicInstance) {
    await api(`/api/instancias/${inst.id}`, {
      method: "PATCH",
      body: { label: inst.label, companyId: inst.companyId, language: inst.language, environment: inst.environment, authMethod: inst.authMethod, isGolden: !inst.isGolden },
    });
    load();
  }

  const oauth = params.get("oauth");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Instancias</h1>
          <p className="text-sm text-muted-foreground">Cuentas (companies) de Procore conectadas. Las credenciales se guardan cifradas y nunca llegan al navegador.</p>
        </div>
        <Button onClick={() => openForm("new")}>
          <Plus className="h-4 w-4" /> Añadir instancia
        </Button>
      </div>

      {oauth === "ok" && <Alert>Autorización con Procore completada.</Alert>}
      {oauth === "error" && <Alert variant="error">Error en la autorización: {params.get("msg")}</Alert>}
      {error && <Alert variant="error">{error}</Alert>}

      {instances === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Cargando instancias…
        </div>
      ) : instances.length === 0 ? (
        <EmptyState title="Aún no hay instancias conectadas">Añade al menos dos companies de Procore para empezar a gobernar su configuración.</EmptyState>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {instances.map((inst) => {
            const tr = tests[inst.id];
            return (
              <Card key={inst.id} className="flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate font-semibold">{inst.label}</h2>
                      {inst.isGolden && (
                        <Badge color="violet" icon="★" title="Instancia de referencia (golden)">
                          Referencia
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Company {inst.companyId}
                      {inst.companyName ? ` · ${inst.companyName}` : ""}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => setGolden(inst)} title={inst.isGolden ? "Quitar como referencia" : "Marcar como referencia (golden)"}>
                      <Star className={inst.isGolden ? "h-4 w-4 fill-current text-violet-500" : "h-4 w-4"} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => openForm(inst)} title="Editar">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setToDisable(inst)} title="Dar de baja">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge color={inst.environment === "sandbox" ? "amber" : "gray"}>{inst.environment === "sandbox" ? "Sandbox" : "Producción"}</Badge>
                  <Badge>Idioma: {inst.language}</Badge>
                  <Badge>{inst.authMethod === "client_credentials" ? "Client Credentials (DMSA)" : "Authorization Code"}</Badge>
                  {inst.hasCustomCredentials && <Badge color="blue">Credencial propia</Badge>}
                  {!inst.isAuthorized && (
                    <Badge color="red" icon="!">
                      Sin autorizar
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  Última prueba: {formatDate(inst.lastTestAt)}{" "}
                  {inst.lastTestOk === true && <span className="text-emerald-600">· OK</span>}
                  {inst.lastTestOk === false && <span className="text-red-600">· Falló</span>}
                  {inst.lastTestMessage && !tr && <p className="mt-1">{inst.lastTestMessage}</p>}
                </div>
                {tr && (
                  <Alert variant={tr.ok ? "info" : tr.checks.length ? "warning" : "error"}>
                    <p>{tr.message}</p>
                    {tr.procoreMessage && <p className="mt-1 text-xs opacity-80">Procore: {tr.procoreMessage}</p>}
                    {tr.checks.length > 0 && (
                      <ul className="mt-2 space-y-1 text-xs">
                        {tr.checks.map((c) => (
                          <li key={c.label} className="flex items-start gap-1.5">
                            {c.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <XCircle className="h-3.5 w-3.5 shrink-0 text-red-600" />}
                            <span>
                              <strong>{c.label}:</strong> {c.message}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Alert>
                )}
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => test(inst)} loading={testing === inst.id}>
                    <Plug className="h-4 w-4" /> Probar conexión
                  </Button>
                  {inst.authMethod === "authorization_code" && (
                    <a href={`/api/auth/procore/start?instanceId=${inst.id}`}>
                      <Button size="sm" variant={inst.isAuthorized ? "ghost" : "default"}>
                        <KeyRound className="h-4 w-4" /> {inst.isAuthorized ? "Reautorizar" : "Autorizar con Procore"}
                      </Button>
                    </a>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Añadir instancia" : "Editar instancia"}>
        <form onSubmit={save} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="label">Etiqueta</Label>
              <Input id="label" required value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="México – Producción" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="companyId">Company ID</Label>
              <Input id="companyId" required inputMode="numeric" value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })} placeholder="123456" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="language">Idioma</Label>
              <Select id="language" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
                {["es", "en", "pt", "fr", "de", "it"].map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="environment">Entorno</Label>
              <Select id="environment" value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value as typeof form.environment })}>
                <option value="production">Producción</option>
                <option value="sandbox">Sandbox</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="authMethod">Autenticación</Label>
              <Select id="authMethod" value={form.authMethod} onChange={(e) => setForm({ ...form, authMethod: e.target.value as typeof form.authMethod })}>
                <option value="client_credentials">Client Credentials (DMSA)</option>
                <option value="authorization_code">Authorization Code (usuario)</option>
              </Select>
            </div>
          </div>
          <fieldset className="space-y-2 rounded-md border p-3">
            <legend className="px-1 text-xs text-muted-foreground">Credencial propia (opcional)</legend>
            <p className="text-xs text-muted-foreground">
              Vacío = usar PROCORE_CLIENT_ID/SECRET del servidor. Úsalo si esta company tiene su propia service account (DMSA).
              {editing !== "new" && editing?.hasCustomCredentials && " Ya hay una credencial guardada; deja vacío para conservarla."}
            </p>
            <Input placeholder="Client ID" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} autoComplete="off" />
            <Input placeholder="Client Secret" type="password" value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} autoComplete="new-password" />
            {editing !== "new" && editing?.hasCustomCredentials && (
              <label className="flex items-center gap-2 text-xs">
                <Checkbox checked={form.clearCustomCredentials} onChange={(e) => setForm({ ...form, clearCustomCredentials: e.target.checked })} /> Eliminar credencial propia
              </label>
            )}
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.isGolden} onChange={(e) => setForm({ ...form, isGolden: e.target.checked })} /> Instancia de referencia (golden)
          </label>
          {formError && <Alert variant="error">{formError}</Alert>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button type="submit" loading={saving}>
              Guardar
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={!!toDisable}
        onClose={() => setToDisable(null)}
        title="Dar de baja la instancia"
        description={
          <>
            “{toDisable?.label}” dejará de aparecer en la app y se borrarán sus tokens. No se elimina nada en Procore y el historial se conserva.
          </>
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setToDisable(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={disable}>
              Dar de baja
            </Button>
          </>
        }
      />
    </div>
  );
}
