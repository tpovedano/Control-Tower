"use client";
import { useEffect, useMemo, useState } from "react";
import { ClipboardPaste, Download, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert, Checkbox, EmptyState, Spinner } from "@/components/ui/misc";
import { Badge } from "@/components/status-badge";
import { PasteGrid } from "@/components/paste-grid";
import { RunFlow } from "@/components/run-flow";
import { EXECUTION_ORDER, SPECS } from "@/lib/adapters/specs";
import { KNOWN_DATA_TYPES, KNOWN_VARIANTS } from "@/lib/adapters/specs/custom-fields";
import { DISCIPLINES, DISCIPLINE_OPTIONS } from "@/lib/naming";
import type { DataTypeInfo, ValidationContext } from "@/lib/adapters/spec-types";
import { validateBatch } from "@/lib/adapters/validate";
import { api } from "@/lib/client/api";
import type { PublicInstance } from "@/lib/client/types";
import { looksLikeHeader, parseClipboard, toCsv } from "@/lib/paste/parse";
import type { ObjectType } from "@/lib/types";
import { t } from "@/lib/i18n";
import { cn, downloadText } from "@/lib/utils";

export function CargarView({ maxRows }: { maxRows: number }) {
  const [type, setType] = useState<ObjectType>("custom_fields");
  const [rows, setRows] = useState<string[][]>([]);
  const [instances, setInstances] = useState<PublicInstance[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [includeTexts, setIncludeTexts] = useState(false);
  const [ctx, setCtx] = useState<ValidationContext>({});
  const [dataTypesInfo, setDataTypesInfo] = useState<{ from?: string; error?: string }>({});
  const [request, setRequest] = useState<Record<string, unknown> | null>(null);
  const spec = SPECS[type];

  useEffect(() => {
    api<{ instances: PublicInstance[] }>("/api/instancias")
      .then((r) => setInstances(r.instances))
      .catch(() => setInstances([]));
    api<{ known: ValidationContext["known"]; options: ValidationContext["options"] }>("/api/validation-context")
      .then((r) => setCtx((c) => ({ ...c, known: r.known, options: r.options })))
      .catch(() => undefined);
  }, []);

  // Tipos de dato válidos según Procore (de la primera instancia destino, o la primera conectada).
  const metaInstance = useMemo(() => {
    const list = instances ?? [];
    return list.find((i) => selected.has(i.id)) ?? list[0];
  }, [instances, selected]);
  useEffect(() => {
    if (type !== "custom_fields" || !metaInstance) return;
    let cancelled = false;
    api<{ dataTypes: DataTypeInfo[]; error?: string }>(`/api/procore/data-types?instanceId=${metaInstance.id}`)
      .then((r) => {
        if (cancelled) return;
        setCtx((c) => ({ ...c, dataTypes: r.dataTypes }));
        setDataTypesInfo({ from: metaInstance.label, error: r.error });
      })
      .catch((e) => !cancelled && setDataTypesInfo({ error: (e as Error).message }));
    return () => {
      cancelled = true;
    };
  }, [type, metaInstance]);

  // Las disciplinas son fijas (naming convention); el resto de opciones viene de lo sincronizado.
  const fullCtx = useMemo<ValidationContext>(() => ({ ...ctx, options: { ...ctx.options, disciplines: DISCIPLINE_OPTIONS } }), [ctx]);
  const validation = useMemo(() => validateBatch(type, rows, fullCtx, maxRows), [type, rows, fullCtx, maxRows]);
  const nonEmpty = rows.filter((r) => r.some((c) => c?.trim()));
  const counts = { valid: 0, warning: 0, error: 0 };
  validation.forEach((v, i) => rows[i]?.some((c) => c?.trim()) && counts[v.status]++);
  const canPlan = nonEmpty.length > 0 && counts.error === 0 && selected.size > 0 && nonEmpty.length === rows.length;

  // Cualquier cambio invalida el dry-run anterior.
  useEffect(() => setRequest(null), [type, rows, selected, includeTexts]);

  function changeType(tp: ObjectType) {
    setType(tp);
    setRows([]);
  }

  function pasteIntoEmpty(text: string) {
    let data = parseClipboard(text);
    if (data.length && looksLikeHeader(data[0], spec.columns.map((c) => c.label))) data = data.slice(1);
    setRows(data.map((r) => spec.columns.map((_, i) => r[i] ?? "")));
  }

  function downloadTemplate() {
    downloadText(toCsv([spec.columns.map((c) => c.label), spec.columns.map((c) => c.example)]), `plantilla-${type}.csv`);
  }

  const suggestions: Record<string, string[]> = {};
  if (type === "custom_fields") suggestions.data_type = ctx.dataTypes?.length ? ctx.dataTypes.map((d) => d.dataType) : KNOWN_DATA_TYPES;
  if (type === "custom_fields") {
    const fromMeta = Array.from(new Set((ctx.dataTypes ?? []).flatMap((d) => d.variants)));
    suggestions.variant = fromMeta.length ? fromMeta : KNOWN_VARIANTS;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Cargar</h1>
        <p className="text-sm text-muted-foreground">Alta masiva por copiar/pegar desde Excel. Nada se escribe sin dry-run y confirmación.</p>
      </div>

      <ol className="flex flex-wrap gap-2 text-xs" aria-label="Pasos">
        {t.steps.map((s, i) => (
          <li key={s} className="flex items-center gap-1.5 rounded-full border px-2.5 py-1">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>

      {/* 1. Tipo */}
      <section className="space-y-2">
        <h2 className="font-semibold">1. Tipo de objeto</h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {EXECUTION_ORDER.map((tp) => (
            <button
              key={tp}
              onClick={() => changeType(tp)}
              aria-pressed={type === tp}
              className={cn("rounded-md border p-3 text-left text-sm transition-colors", type === tp ? "border-primary bg-primary/10 ring-1 ring-primary" : "hover:bg-accent")}
            >
              <span className="font-medium">{SPECS[tp].label}</span>
              <span className="mt-0.5 block font-mono text-xs text-muted-foreground">Nombre [{SPECS[tp].idPrefixExample}]</span>
              {!SPECS[tp].writable && <Badge className="mt-1">Solo lectura</Badge>}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Orden recomendado por dependencias: Custom Fields → LOV Entries → Field Sets. Inspection y Observation Types son independientes.</p>
        {!spec.writable && <Alert variant="warning">{spec.readOnlyReason}</Alert>}
      </section>

      <Alert>
        <p className="font-medium">Regla de nombres</p>
        <p className="mt-1 text-xs">
          El [ID] va <strong>al final</strong> del nombre y empieza por el código de la disciplina:{" "}
          {DISCIPLINES.map((d, i) => (
            <span key={d.code}>
              {i > 0 && " · "}
              <strong>{d.code}</strong> {d.label}
            </span>
          ))}
          . Ejemplo: <code>Fecha de inspección [QE-CF-001]</code>. Si eliges la disciplina en su columna y el [ID] no la lleva, se añade sola.
        </p>
      </Alert>

      {/* 2. Pegar */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">2. Pega las filas desde Excel</h2>
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <Download className="h-3.5 w-3.5" /> Plantilla CSV
          </Button>
        </div>
        {rows.length === 0 && (
          <textarea
            aria-label="Zona de pegado"
            className="flex h-24 w-full cursor-text items-center justify-center rounded-md border-2 border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            placeholder={`📋 Haz clic aquí y pulsa Ctrl+V. Columnas: ${spec.columns.map((c) => c.label).join(" · ")}. También vale una sola columna de nombres.`}
            value=""
            onChange={() => undefined}
            onPaste={(e) => {
              e.preventDefault();
              pasteIntoEmpty(e.clipboardData.getData("text/plain"));
            }}
          />
        )}
        <PasteGrid columns={spec.columns} rows={rows} onChange={setRows} validation={validation} suggestions={suggestions} options={fullCtx.options} />
        {spec.columns.some((c) => c.optionsKey) && (
          <p className="text-xs text-muted-foreground">
            Los desplegables se rellenan con lo sincronizado en Gobierno. Si falta algo, pulsa “Sincronizar / Leer instancias” allí.
            {type === "field_sets" &&
              " Clase/Herramienta = herramienta + categoría/tipo de un field set existente: en cada instancia destino se usa uno de esa misma herramienta como plantilla (Procore exige su configuración de campos)."}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge color="green" icon="✅">
            {counts.valid} válidas
          </Badge>
          <Badge color="amber" icon="⚠️">
            {counts.warning} con advertencia
          </Badge>
          <Badge color="red" icon="❌">
            {counts.error} con error
          </Badge>
          {nonEmpty.length !== rows.length && <span className="text-xs text-amber-600">Hay filas vacías: elimínalas antes de continuar.</span>}
          {type === "custom_fields" && (
            <span className="text-xs text-muted-foreground">
              {dataTypesInfo.error
                ? `No se pudieron leer los tipos de dato de Procore (${dataTypesInfo.error}); se valida contra la lista oficial de tipos de Procore.`
                : dataTypesInfo.from
                  ? `Tipos de dato validados contra “${dataTypesInfo.from}”.`
                  : ""}
            </span>
          )}
        </div>
      </section>

      {/* 3. Instancias */}
      <section className="space-y-2">
        <h2 className="font-semibold">3. Instancias destino</h2>
        {instances === null ? (
          <Spinner />
        ) : instances.length === 0 ? (
          <EmptyState title="No hay instancias conectadas">Añádelas en la pestaña Instancias.</EmptyState>
        ) : (
          <Card className="p-3">
            <label className="mb-2 flex items-center gap-2 border-b pb-2 text-sm font-medium">
              <Checkbox
                checked={selected.size === instances.length}
                ref={(el) => {
                  if (el) el.indeterminate = selected.size > 0 && selected.size < instances.length;
                }}
                onChange={(e) => setSelected(e.target.checked ? new Set(instances.map((i) => i.id)) : new Set())}
              />
              Seleccionar todas ({selected.size}/{instances.length})
            </label>
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
              {instances.map((i) => (
                <label key={i.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={selected.has(i.id)}
                    onChange={(e) =>
                      setSelected((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(i.id);
                        else n.delete(i.id);
                        return n;
                      })
                    }
                  />
                  <span className="truncate">{i.label}</span>
                  <span className="text-xs text-muted-foreground">({i.language})</span>
                  {i.lastTestOk === false && (
                    <Badge color="red" icon="!" title={i.lastTestMessage ?? ""}>
                      conexión
                    </Badge>
                  )}
                </label>
              ))}
            </div>
          </Card>
        )}
        <label className="flex items-start gap-2 text-sm">
          <Checkbox className="mt-0.5" checked={includeTexts} onChange={(e) => setIncludeTexts(e.target.checked)} />
          <span>
            Sobrescribir también textos (nombre, descripción) en los elementos existentes.
            <span className="block text-xs text-muted-foreground">
              Desactivado por defecto: así cada instancia conserva su idioma y solo se alinean los atributos estructurales.
            </span>
          </span>
        </label>
      </section>

      {/* 4–5. Dry-run y ejecución */}
      <section className="space-y-3">
        <h2 className="font-semibold">4. Revisar (dry-run) · 5. Ejecutar</h2>
        {!request && (
          <Button
            onClick={() => setRequest({ source: "cargar", objectType: type, rows, instanceIds: [...selected], includeTexts })}
            disabled={!canPlan}
          >
            <Eye className="h-4 w-4" /> Revisar (dry-run) {nonEmpty.length} fila{nonEmpty.length === 1 ? "" : "s"} en {selected.size} instancia{selected.size === 1 ? "" : "s"}
          </Button>
        )}
        {!canPlan && !request && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ClipboardPaste className="h-3.5 w-3.5" />
            {nonEmpty.length === 0 ? "Pega al menos una fila." : counts.error > 0 ? "Corrige las filas con error." : selected.size === 0 ? "Elige al menos una instancia." : "Revisa las filas."}
          </p>
        )}
        {request && (
          <Card className="p-4">
            <RunFlow key={JSON.stringify(request)} request={request} instances={instances ?? []} objectType={type} />
          </Card>
        )}
      </section>
    </div>
  );
}
