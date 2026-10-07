import { describe, expect, it, vi } from "vitest";
import { ProcoreClient } from "@/lib/procore/client";
import { newContext } from "@/lib/adapters/server/types";
import { customFieldsAdapter, parseDataTypes } from "@/lib/adapters/server/custom-fields";
import { lovEntriesAdapter } from "@/lib/adapters/server/lov-entries";
import { extractSections, fieldSetsAdapter, mergeSections } from "@/lib/adapters/server/field-sets";
import { inspectionTypesAdapter } from "@/lib/adapters/server/inspection-types";
import { observationTypesAdapter } from "@/lib/adapters/server/observation-types";

type Route = (url: URL, init: RequestInit) => unknown;

function mockProcore(routes: Record<string, Route>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const f = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push({ method, path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const handler = routes[`${method} ${url.pathname}`];
    if (!handler) return new Response(JSON.stringify({ error: "not mocked" }), { status: 404 });
    const out = handler(url, init!);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200 });
  });
  const client = new ProcoreClient({ baseUrl: "https://api.procore.com", companyId: "7", tokenProvider: { getToken: async () => "t" }, fetchImpl: f as unknown as typeof fetch, sleep: async () => {} });
  return { ctx: newContext(client), calls };
}

const CF_LIST = "GET /rest/v2.0/companies/7/custom_field_definitions";

describe("custom fields adapter", () => {
  it("lista (v2 envuelto en data) y normaliza por [ID]", async () => {
    const { ctx } = mockProcore({
      [CF_LIST]: () => ({ data: [{ id: 1, label: "[cf-001] Fecha", data_type: "date", active: true }, { id: 2, label: "Sin id", data_type: "string" }] }),
    });
    const items = await customFieldsAdapter.list(ctx);
    expect(items[0]).toMatchObject({ key: "CF-001", remoteId: "1", attrs: { data_type: "date", variant: null, active: true } });
    expect(items[1].key).toBeNull();
  });

  it("CREATE envía label con [ID] y data_type; UPDATE conserva el nombre local", async () => {
    const { ctx, calls } = mockProcore({
      "POST /rest/v2.0/companies/7/custom_field_definitions": () => ({ data: { id: 55 } }),
      "PATCH /rest/v2.0/companies/7/custom_field_definitions/9": () => ({ id: 9 }),
    });
    const desired = { key: "CF-1", stdId: "CF-1", name: "[CF-1] Fecha", attrs: { data_type: "date", variant: null, active: false }, extra: { description: "d" } };
    const [created] = await customFieldsAdapter.apply([{ desired, plan: { action: "CREATE", diffs: [] } }], ctx, { includeTexts: false });
    expect(created).toMatchObject({ ok: true, remoteId: "55" });
    expect(calls[0].body).toEqual({ custom_field_definition: { label: "[CF-1] Fecha", data_type: "date", active: false, description: "d" } });
    const current = { key: "CF-1", stdId: "CF-1", name: "[CF-1] Date", text: "Date", remoteId: "9", attrs: {} };
    await customFieldsAdapter.apply([{ desired, plan: { action: "UPDATE", diffs: [], remoteId: "9" }, current }], ctx, { includeTexts: false });
    expect(calls[1].body).toEqual({ custom_field_definition: { label: "[CF-1] Date", active: false } });
  });

  it("422 devuelve el mensaje original de Procore", async () => {
    const { ctx } = mockProcore({
      "POST /rest/v2.0/companies/7/custom_field_definitions": () => new Response(JSON.stringify({ errors: { label: ["ya existe"] } }), { status: 422 }),
    });
    const [r] = await customFieldsAdapter.apply(
      [{ desired: { key: "X", stdId: "X", name: "[X] x", attrs: { data_type: "string", variant: null, active: true } }, plan: { action: "CREATE", diffs: [] } }],
      ctx,
      { includeTexts: false },
    );
    expect(r.ok).toBe(false);
    expect(r.httpStatus).toBe(422);
    expect(r.message).toContain("ya existe");
  });

  it("parseDataTypes acepta varias formas", () => {
    expect(parseDataTypes({ data: [{ data_type: "decimal", variants: ["currency", "percent"] }] })).toEqual([{ dataType: "decimal", label: undefined, variants: ["currency", "percent"] }]);
    expect(parseDataTypes(["string", "datetime"]).map((d) => d.dataType)).toEqual(["string", "datetime"]);
    // Agrupación por nombre: "all" nunca se toma como tipo de dato
    expect(parseDataTypes({ all: ["string", "decimal"], enabled: ["string"] }).map((d) => d.dataType)).toEqual(["string", "decimal"]);
    expect(parseDataTypes({ data: { all: [{ data_type: "lov_entry", variants: [{ variant: "radio_button" }] }] } })).toEqual([{ dataType: "lov_entry", label: undefined, variants: ["radio_button"] }]);
    // Respuesta irreconocible → [] (se usa la lista oficial)
    expect(parseDataTypes({ all: { foo: 1 } })).toEqual([]);
    expect(parseDataTypes({ boolean: { variants: [] }, lov_entry: ["dropdown"] })).toEqual([
      { dataType: "boolean", variants: [] },
      { dataType: "lov_entry", variants: ["dropdown"] },
    ]);
  });
});

describe("LOV entries adapter", () => {
  const routes = (extra: Record<string, Route> = {}) => ({
    [CF_LIST]: () => [
      { id: 10, label: "[CF-10] Estado", data_type: "lov_entry" },
      { id: 11, label: "[CF-11] Fecha", data_type: "date" },
    ],
    "GET /rest/v2.0/companies/7/custom_field_definitions/10/custom_field_lov_entries": () => [{ id: 100, label: "[OK] Conforme", active: true, position: 1 }],
    ...extra,
  });

  it("lista solo LOV de custom fields de tipo lista, con llave padre/opción", async () => {
    const { ctx, calls } = mockProcore(routes());
    const items = await lovEntriesAdapter.list(ctx);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "CF-10/OK", parentKey: "CF-10", parentRemoteId: "10" });
    expect(calls.some((c) => c.path.includes("/11/"))).toBe(false);
  });

  it("plan: bloqueado si el padre no existe o no es lista", async () => {
    const { ctx } = mockProcore(routes());
    const existing = await lovEntriesAdapter.list(ctx);
    const p1 = await lovEntriesAdapter.plan({ key: "CF-99/A", stdId: "A", parentKey: "CF-99", name: "[A] a", attrs: { active: true } }, existing, ctx, { includeTexts: false });
    expect(p1).toMatchObject({ action: "SKIP", missingDependencies: ["CF-99"] });
    const p2 = await lovEntriesAdapter.plan({ key: "CF-11/A", stdId: "A", parentKey: "CF-11", name: "[A] a", attrs: { active: true } }, existing, ctx, { includeTexts: false });
    expect(p2.message).toMatch(/no es una lista/);
    const p3 = await lovEntriesAdapter.plan({ key: "CF-10/OK", stdId: "OK", parentKey: "CF-10", name: "[OK] Okay", attrs: { active: true } }, existing, ctx, { includeTexts: true });
    expect(p3.action).toBe("NOCHANGE");
  });

  it("bulk_create envía las opciones en orden inverso y verifica", async () => {
    let created = false;
    const { ctx, calls } = mockProcore(
      routes({
        "POST /rest/v1.0/custom_field_definitions/10/custom_field_lov_entries/bulk_create": () => ((created = true), {}),
        "GET /rest/v2.0/companies/7/custom_field_definitions/10/custom_field_lov_entries": () =>
          created
            ? [
                { id: 100, label: "[OK] Conforme", position: 1 },
                { id: 102, label: "[B] Segunda", position: 2 },
                { id: 101, label: "[A] Primera", position: 3 },
              ]
            : [{ id: 100, label: "[OK] Conforme", position: 1 }],
      }),
    );
    const mk = (id: string) => ({ desired: { key: `CF-10/${id}`, stdId: id, parentKey: "CF-10", name: `[${id}] x`, attrs: { active: true } }, plan: { action: "CREATE" as const, diffs: [] } });
    const res = await lovEntriesAdapter.apply([mk("A"), mk("B")], ctx, { includeTexts: false });
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toEqual({ custom_field_lov_entries: [{ label: "[B] x" }, { label: "[A] x" }] });
    expect(res.map((r) => r.ok)).toEqual([true, true]);
    expect(res[0].remoteId).toBe("101");
    expect(res[0].message).toBe("Creada");
  });
});

describe("field sets adapter", () => {
  it("extrae secciones en distintos formatos", () => {
    expect(extractSections({ custom_field_sections: [{ id: 1, name: "G", custom_field_definition_ids: [5, 6] }] })).toEqual([{ id: "1", name: "G", remoteIds: ["5", "6"] }]);
    expect(extractSections({ sections: [{ name: "S", custom_field_definitions: [{ id: 7 }] }] })[0].remoteIds).toEqual(["7"]);
    expect(extractSections({ fields: { custom_field_8: { visible: true }, title: {} } })[0].remoteIds).toEqual(["8"]);
  });

  it("Observaciones: lee la categoría de `category` y crea con category + fields de una plantilla de la misma herramienta", async () => {
    const { ctx, calls } = mockProcore({
      [CF_LIST]: () => [
        { id: 501, label: "A [QE-CF-1]", data_type: "string" },
        { id: 502, label: "B [QE-CF-2]", data_type: "datetime" },
      ],
      // El listado no trae fields, secciones ni clase: se pide el detalle de cada uno.
      "GET /rest/v2.1/companies/7/configurable_field_sets": () => [
        { id: 1, name: "Default Safety", company_default: true },
        { id: 2, name: "Calidad [QE-FS-1]" },
      ],
      "GET /rest/v2.1/companies/7/configurable_field_sets/1": () => ({
        id: 1,
        class_name: "Observations::Item",
        category: "safety",
        observations_category_id: 70,
        schema_id: "s-1",
        fields: { name: { name: "name", visible: true, required: true } },
        custom_field_sections: [],
      }),
      "GET /rest/v2.1/companies/7/configurable_field_sets/2": () => ({
        id: 2,
        class_name: "Observations::Item",
        category: "Quality",
        fields: { name: { name: "name", visible: true, required: true } },
        custom_field_sections: [{ id: 9, name: "General", custom_field_definition_ids: [502, 999] }],
      }),
      "POST /rest/v2.1/companies/7/configurable_field_sets": () => ({ id: 3 }),
    });
    const items = await fieldSetsAdapter.list(ctx);
    expect(items.find((i) => i.key === "QE-FS-1")!.attrs).toEqual({ class_name: "Observations::Item", scope: "quality", custom_fields: ["#999", "QE-CF-2"] });

    // Categoría "warranty": no hay plantilla de esa categoría, pero sí de la herramienta → se copian sus fields, no su categoría/ids.
    const desired = {
      key: "QE-FS-2",
      stdId: "QE-FS-2",
      name: "Nuevo [QE-FS-2]",
      attrs: { class_name: "Observations::Item", scope: "warranty", custom_fields: ["QE-CF-1", "QE-CF-2"] },
      extra: { sections: [{ name: "General", ids: ["QE-CF-1", "QE-CF-2"] }] },
    };
    expect(await fieldSetsAdapter.dependencies!(desired, ctx)).toEqual({ missing: [] });
    const [r] = await fieldSetsAdapter.apply([{ desired, plan: { action: "CREATE", diffs: [] } }], ctx, { includeTexts: false });
    expect(r.ok).toBe(true);
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toEqual({
      configurable_field_set: {
        name: "Nuevo [QE-FS-2]",
        class_name: "Observations::Item",
        fields: { name: { name: "name", visible: true, required: true } },
        category: "warranty",
        schema_id: "s-1",
      },
      custom_field_sections: [{ name: "General", custom_field_definition_ids: [501, 502] }],
    });

    // Misma categoría que la plantilla → también se copia su observations_category_id.
    const same = { ...desired, key: "QE-FS-3", stdId: "QE-FS-3", name: "Seg [QE-FS-3]", attrs: { ...desired.attrs, scope: "safety" } };
    await fieldSetsAdapter.apply([{ desired: same, plan: { action: "CREATE", diffs: [] } }], ctx, { includeTexts: false });
    const post2 = calls.filter((c) => c.method === "POST")[1];
    expect((post2.body as { configurable_field_set: Record<string, unknown> }).configurable_field_set).toMatchObject({ category: "safety", observations_category_id: 70 });
  });

  it("sin field sets de esa herramienta en la instancia → usa los fields de otra instancia (respaldo)", async () => {
    const { ctx, calls } = mockProcore({
      [CF_LIST]: () => [{ id: 501, label: "A [QE-CF-1]", data_type: "string" }],
      "GET /rest/v2.1/companies/7/configurable_field_sets": () => [],
      "POST /rest/v2.1/companies/7/configurable_field_sets": () => ({ id: 3 }),
    });
    const desired = { key: "QE-FS-9", stdId: "QE-FS-9", name: "X [QE-FS-9]", attrs: { class_name: "Observations::Item", scope: "quality", custom_fields: ["QE-CF-1"] } };
    // Sin respaldo: bloqueado antes de escribir.
    expect((await fieldSetsAdapter.dependencies!(desired, ctx)).message).toMatch(/configuración de campos/);
    const plan = await fieldSetsAdapter.plan(desired, await fieldSetsAdapter.list(ctx), ctx, { includeTexts: false });
    expect(plan.action).toBe("SKIP");
    // Con respaldo (otra instancia sincronizada): se crea.
    ctx.fieldSetFieldsFallback = async (cls) => (cls === "Observations::Item" ? { name: { name: "name", visible: true, required: true } } : null);
    expect(await fieldSetsAdapter.dependencies!(desired, ctx)).toEqual({ missing: [] });
    const [r] = await fieldSetsAdapter.apply([{ desired, plan: { action: "CREATE", diffs: [] } }], ctx, { includeTexts: false });
    expect(r).toMatchObject({ ok: true });
    expect(r.message).toMatch(/otra instancia/);
    expect((calls.find((c) => c.method === "POST")!.body as { configurable_field_set: Record<string, unknown> }).configurable_field_set).toEqual({
      name: "X [QE-FS-9]",
      class_name: "Observations::Item",
      fields: { name: { name: "name", visible: true, required: true } },
      category: "quality",
    });
  });

  it("extractScope y parseClassCell", async () => {
    const { extractScope } = await import("@/lib/adapters/server/field-sets");
    const { parseClassCell } = await import("@/lib/adapters/specs/field-sets");
    expect(extractScope({ inspection_type: { id: 5, name: "[IT-1] Seguridad" } })).toEqual({ kind: "inspection_type", id: "5", name: "[IT-1] Seguridad" });
    expect(extractScope({ observations_category_id: 3 })).toEqual({ kind: "observations_category", id: "3", name: null });
    expect(extractScope({ category: "safety" })).toEqual({ kind: "category", id: null, name: "safety" });
    expect(extractScope({})).toBeNull();
    expect(parseClassCell("Observation | Safety")).toEqual({ className: "Observations::Item", scope: "safety" });
    expect(parseClassCell("Observaciones | Trabajo pendiente")).toEqual({ className: "Observations::Item", scope: "work_to_complete" });
    expect(parseClassCell("Observations::Item | Garantía")).toEqual({ className: "Observations::Item", scope: "warranty" });
    expect(parseClassCell("Observations::Item")).toEqual({ className: "Observations::Item", scope: null });
    expect(parseClassCell("punch list")).toEqual({ className: "PunchItem", scope: null });
    expect(parseClassCell("RFI")).toEqual({ className: "Rfi::Header", scope: null });
  });

  it("dependencia faltante", async () => {
    const { ctx } = mockProcore({ [CF_LIST]: () => [{ id: 501, label: "[CF-1] A" }] });
    const deps = await fieldSetsAdapter.dependencies!({ key: "F", stdId: "F", name: "[F] f", attrs: { class_name: "X", custom_fields: ["CF-1", "CF-7"] } }, ctx);
    expect(deps.missing).toEqual(["CF-7"]);
  });

  it("mergeSections conserva ids de sección, quita sobrantes y añade faltantes", () => {
    const existing = [{ id: "9", name: "General", remoteIds: [], ids: ["CF-1", "CF-3"] }];
    expect(mergeSections(existing, ["CF-1", "CF-2"], null)).toEqual([{ id: "9", name: "General", ids: ["CF-1", "CF-2"] }]);
    expect(mergeSections(existing, ["CF-1"], [{ name: "general", ids: ["CF-1"] }])).toEqual([{ name: "general", ids: ["CF-1"], id: "9" }]);
  });
});

describe("inspection / observation types", () => {
  it("inspection types: crea con grouping", async () => {
    const { ctx, calls } = mockProcore({
      "GET /rest/v1.0/companies/7/inspection_types": () => [{ id: 1, name: "[IT-1] Seguridad", grouping: "HSE" }],
      "POST /rest/v1.0/companies/7/inspection_types": () => ({ id: 2 }),
    });
    const items = await inspectionTypesAdapter.list(ctx);
    expect(items[0]).toMatchObject({ key: "IT-1", attrs: { grouping: "HSE" } });
    await inspectionTypesAdapter.apply([{ desired: { key: "IT-2", stdId: "IT-2", name: "[IT-2] Calidad", attrs: { grouping: "QA" } }, plan: { action: "CREATE", diffs: [] } }], ctx, { includeTexts: false });
    expect(calls.at(-1)?.body).toEqual({ inspection_type: { name: "[IT-2] Calidad", grouping: "QA" } });
  });

  it("observation types: solo lectura, nunca escribe", async () => {
    const { ctx, calls } = mockProcore({ "GET /rest/v1.0/companies/7/observation_types": () => [{ id: 1, name: "[OT-1] Seguridad", category: "safety", active: false }] });
    const items = await observationTypesAdapter.list(ctx);
    expect(items[0].attrs).toEqual({ category: "safety", active: false });
    const [r] = await observationTypesAdapter.apply([{ desired: { key: "OT-2", stdId: "OT-2", name: "x", attrs: {} }, plan: { action: "CREATE", diffs: [] } }], ctx, { includeTexts: false });
    expect(r.ok).toBe(false);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });
});
