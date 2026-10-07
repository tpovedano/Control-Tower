/**
 * Servidor Procore simulado para desarrollo local sin credenciales de sandbox.
 *   npm run mock:procore   (puerto 4010)
 * y en .env.local: PROCORE_BASE_URL=http://localhost:4010  PROCORE_LOGIN_URL=http://localhost:4010
 * Companies: 1001 (es, formato vigente "Nombre [ID]") y 1002 (en, formato antiguo "[ID] Nombre") con datos de ejemplo. MOCK_429=1 inyecta 429 periódicos.
 * Solo implementa los endpoints que usa la app; el estado vive en memoria.
 */
import http from "node:http";

type Obj = Record<string, unknown> & { id: number };
interface Company {
  name: string;
  cfs: Obj[];
  lovs: Record<number, Obj[]>;
  fieldSets: Obj[];
  inspectionTypes: Obj[];
  observationTypes: Obj[];
  metadata?: Obj[];
}

let seq = 5000;
const nextId = () => ++seq;

const companies: Record<string, Company> = {
  "1001": {
    name: "Demo Constructora (ES)",
    cfs: [
      { id: 11, label: "Fecha de inspección [QE-CF-001]", data_type: "datetime", active: true },
      { id: 12, label: "Estado de calidad [QE-CF-002]", data_type: "lov_entry", active: true },
      { id: 13, label: "Campo antiguo sin ID", data_type: "string", active: true },
    ],
    lovs: { 12: [{ id: 121, label: "Conforme [OK]", active: true, position: 2 }, { id: 122, label: "No conforme [NOK]", active: true, position: 1 }] },
    fieldSets: [
      { id: 31, name: "Predeterminado Observaciones Seguridad", class_name: "Observations::Item", category: "safety", company_default: true, fields: { name: { name: "name", visible: true, required: true }, description: { name: "description", visible: true, required: false } }, custom_field_sections: [] },
      { id: 33, name: "Predeterminado Observaciones Calidad", class_name: "Observations::Item", category: "quality", company_default: true, fields: { name: { name: "name", visible: true, required: true }, description: { name: "description", visible: true, required: false, conditions: [{ field: "name", operator: "present" }] } }, custom_field_sections: [] },
      { id: 32, name: "Calidad [QE-FS-001]", class_name: "Observations::Item", category: "quality", fields: { name: { name: "name", visible: true, required: true, conditions: [{ field: "type" }] } }, custom_field_sections: [{ id: 301, name: "General", custom_field_definition_ids: [11] }] }, // con campos condicionales
    ],
    metadata: [{ id: 901, custom_field_definition_id: 11, custom_fields_section_id: 301, host_type: "Observations::Item", source_type: "ConfigurableFieldSet", source_id: 32, position: 1 }],
    inspectionTypes: [{ id: 41, name: "Seguridad [HS-IT-001]", grouping: "HSE" }],
    observationTypes: [{ id: 51, name: "Seguridad [HS-OT-001]", category: "safety", active: true }],
  },
  "1002": {
    name: "Demo Builders (EN)",
    cfs: [
      { id: 21, label: "[QE-CF-001] Inspection date", data_type: "datetime", active: true },
      { id: 22, label: "[QE-CF-002] Quality status", data_type: "lov_entry", active: false },
    ],
    lovs: { 22: [{ id: 221, label: "[OK] Compliant", active: true, position: 1 }] },
    fieldSets: [], // sin field sets: la creación debe tomar "fields" de otra instancia
    inspectionTypes: [],
    observationTypes: [{ id: 71, name: "[HS-OT-001] Safety", category: "safety", active: true }],
  },
};

// Forma agrupada (como puede devolverla Procore): el nombre del grupo no es un tipo de dato.
const DATA_TYPES = {
  all: [
    { data_type: "string", variants: ["read_only"] },
    { data_type: "decimal", variants: ["currency", "read_only"] },
    { data_type: "boolean", variants: [] },
    { data_type: "datetime", variants: [] },
    { data_type: "rich_text", variants: [] },
    { data_type: "lov_entry", variants: ["radio_button"] },
    { data_type: "lov_entries", variants: [] },
    { data_type: "login_information", variants: ["project_directory"] },
    { data_type: "login_informations", variants: ["project_directory"] },
    { data_type: "vendor", variants: [] },
    { data_type: "location", variants: [] },
  ],
};


/** Detalle con la forma real de v2.1: custom fields dentro de "fields" (custom_field_<n>) y secciones en "sections". */
function renderFieldSet(fs: Obj): Obj {
  const sections = ((fs.custom_field_sections ?? []) as Obj[]);
  const fields: Record<string, unknown> = { ...((fs.fields ?? {}) as object) };
  let n = 0;
  for (const sec of sections) {
    for (const defId of (sec.custom_field_definition_ids ?? []) as number[]) {
      n++;
      fields[`custom_field_${fs.id}${n}`] = { id: `${fs.id}${n}`, name: `custom_field_${fs.id}${n}`, custom_field_definition_id: String(defId), custom_fields_section_id: String(sec.id), host_type: fs.class_name, position: n, visible: true, required: false };
    }
  }
  const { custom_field_sections: _s, ...rest } = fs;
  return { ...rest, fields, sections: sections.map((x, i) => ({ id: String(x.id), name: x.name, position: i + 1, from_v1_custom_fields: false })) };
}

/** Saca de "fields" las entradas de custom fields y las coloca en su sección (o en la primera). */
function absorbCustomFields(fs: Obj) {
  const fields = (fs.fields ?? {}) as Record<string, Obj>;
  const sections = ((fs.custom_field_sections ??= []) as Obj[]);
  if (!sections.length) sections.push({ id: nextId(), name: "General", custom_field_definition_ids: [] });
  for (const [k, v] of Object.entries(fields)) {
    if (!/^custom_field_/.test(k) || !v || typeof v !== "object" || v.custom_field_definition_id === undefined) continue;
    delete fields[k];
    const sec = sections.find((x) => String(x.id) === String(v.custom_fields_section_id)) ?? sections[0];
    const list = (sec.custom_field_definition_ids ??= []) as number[];
    if (!list.includes(Number(v.custom_field_definition_id))) list.push(Number(v.custom_field_definition_id));
  }
}

let counter = 0;

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function page<T>(list: T[], url: URL, res: http.ServerResponse, wrap = false) {
  const p = Number(url.searchParams.get("page") ?? 1);
  const per = Math.min(Number(url.searchParams.get("per_page") ?? 100), 100);
  const slice = list.slice((p - 1) * per, p * per);
  send(res, 200, wrap ? { data: slice } : slice, { Total: String(list.length), "Per-Page": String(per) });
}

async function body(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString();
  if (!raw) return {};
  if ((req.headers["content-type"] ?? "").includes("urlencoded")) return Object.fromEntries(new URLSearchParams(raw));
  return JSON.parse(raw);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const m = req.method ?? "GET";
  const path = url.pathname;
  console.log(m, path + url.search);

  if (path === "/oauth/token" && m === "POST") {
    const b = await body(req);
    if (!b.client_id || !b.client_secret) return send(res, 401, { error: "invalid_client" });
    return send(res, 200, { access_token: `mock-${Date.now()}`, token_type: "bearer", expires_in: 5400, ...(b.grant_type !== "client_credentials" ? { refresh_token: `r-${Date.now()}` } : {}) });
  }
  if (path === "/oauth/authorize") {
    const redirect = new URL(url.searchParams.get("redirect_uri")!);
    redirect.searchParams.set("code", "mock-code");
    redirect.searchParams.set("state", url.searchParams.get("state") ?? "");
    res.writeHead(302, { Location: redirect.toString() });
    return res.end();
  }
  if (!String(req.headers.authorization ?? "").startsWith("Bearer ")) return send(res, 401, { error: "unauthorized" });
  if (process.env.MOCK_429 === "1" && ++counter % 7 === 0) return send(res, 429, { error: "Too Many Requests" }, { "Retry-After": "1" });

  if (path === "/rest/v1.0/companies") return send(res, 200, Object.entries(companies).map(([id, c]) => ({ id: Number(id), name: c.name })));

  let mm: RegExpExecArray | null;
  const companyHeader = String(req.headers["procore-company-id"] ?? "");
  if ((mm = /^\/rest\/v[\d.]+\/companies\/(\d+)\//.exec(path)) && mm[1] !== companyHeader) return send(res, 400, { error: "Procore-Company-Id no coincide" });
  const c = companies[(mm?.[1] ?? companyHeader) as string];
  if (!c) return send(res, 404, { error: "company not found" });

  // Custom fields
  if ((mm = /^\/rest\/v2\.0\/companies\/\d+\/custom_field\/data_types$/.exec(path))) return send(res, 200, { data: DATA_TYPES });
  if (/^\/rest\/v2\.0\/companies\/\d+\/custom_field_definitions$/.test(path)) {
    if (m === "GET") return page(c.cfs, url, res, true);
    const d = ((await body(req)).custom_field_definition ?? {}) as Obj;
    if (!d.label || !d.data_type) return send(res, 422, { errors: { label: ["can't be blank"] } });
    if (c.cfs.some((x) => x.label === d.label)) return send(res, 422, { errors: { label: ["has already been taken"] } });
    const cf = { ...d, id: nextId(), active: d.active ?? true };
    c.cfs.push(cf);
    if (Array.isArray(d.custom_field_lov_entries)) c.lovs[cf.id] = [];
    return send(res, 201, { data: cf });
  }
  if ((mm = /^\/rest\/v2\.0\/companies\/\d+\/custom_field_definitions\/(\d+)$/.exec(path)) && m === "PATCH") {
    const cf = c.cfs.find((x) => x.id === Number(mm![1]));
    if (!cf) return send(res, 404, { error: "not found" });
    Object.assign(cf, (await body(req)).custom_field_definition);
    return send(res, 200, { data: cf });
  }
  if ((mm = /^\/rest\/v2\.0\/companies\/\d+\/custom_field_definitions\/(\d+)\/custom_field_lov_entries$/.exec(path))) {
    return page(c.lovs[Number(mm[1])] ?? [], url, res, true);
  }
  if ((mm = /^\/rest\/v1\.0\/custom_field_definitions\/(\d+)\/custom_field_lov_entries\/bulk_create$/.exec(path)) && m === "POST") {
    if (!url.searchParams.get("company_id")) return send(res, 400, { code: "BAD_REQUEST", message: "Missing Project or Company ID" });
    const id = Number(mm[1]);
    const list = (c.lovs[id] ??= []);
    const entries = ((await body(req)).custom_field_lov_entries ?? []) as { label: string }[];
    let pos = Math.max(0, ...list.map((l) => Number(l.position)));
    const created = entries.map((e) => ({ id: nextId(), label: e.label, active: true, position: ++pos }));
    list.push(...created);
    return send(res, 201, created);
  }

  // Custom field metadata (asociar un custom field a un field set)
  if (/^\/rest\/v2\.0\/companies\/\d+\/custom_field_metadata$/.test(path)) {
    const list = (c.metadata ??= []);
    if (m === "GET") {
      const fsIds = url.searchParams.getAll("filters[field_set_id][]").map(Number);
      return page(fsIds.length ? list.filter((x) => fsIds.includes(Number(x.source_id))) : list, url, res, true);
    }
    const md = ((await body(req)).custom_field_metadatum ?? {}) as Obj;
    const fs = c.fieldSets.find((x) => x.id === Number(md.source_id));
    if (!fs || md.source_type !== "ConfigurableFieldSet" || !md.host_type || !md.custom_field_definition_id || md.position === undefined) {
      return send(res, 422, { errors: { base: ["custom_field_definition_id, host_type, source_type, source_id y position son obligatorios"] } });
    }
    const sections = ((fs.custom_field_sections ??= []) as Obj[]);
    let sec = sections.find((x) => x.id === Number(md.custom_fields_section_id)) ?? sections[0];
    if (!sec) sections.push((sec = { id: nextId(), name: "General", custom_field_definition_ids: [] }));
    (sec.custom_field_definition_ids as number[]).push(Number(md.custom_field_definition_id));
    const created = { ...md, id: nextId(), custom_fields_section_id: sec.id };
    list.push(created);
    return send(res, 201, { data: created });
  }

  // Field sets
  if (/^\/rest\/v2\.1\/companies\/\d+\/configurable_field_sets$/.test(path)) {
    // Como Procore: el listado no incluye "fields", las secciones ni (en este simulado) la clase: hay que pedir el detalle.
    if (m === "GET") return page(c.fieldSets.map(({ custom_field_sections: _s, fields: _f, class_name: _c, ...fs }) => fs), url, res, true);
    const b = await body(req);
    const fs = b.configurable_field_set as Obj;
    const errs: string[] = [];
    if (!fs?.fields || !Object.keys(fs.fields as object).length) errs.push("Configurable fields can't be blank");
    if (fs?.class_name === "Observations::Item" && !["quality", "safety", "commissioning", "warranty", "work_to_complete"].includes(String(fs.category))) errs.push("Observation category can't be blank");
    if (!fs?.name || !fs.class_name) errs.push("name and class_name are required");
    else if (!["Observations::Item", "PunchItem", "Rfi::Header"].includes(String(fs.class_name))) errs.push("class_name is not included in the list");
    if (errs.length) return send(res, 422, { errors: { base: errs } });
    // Como el Procore real observado: ignora los custom fields de custom_field_sections al crear.
    const created: Obj = { ...fs, id: nextId(), custom_field_sections: [{ id: nextId(), name: "General", custom_field_definition_ids: [] as number[] }] };
    absorbCustomFields(created); // los custom fields enviados dentro de "fields" sí se guardan
    c.fieldSets.push(created);
    return send(res, 201, { data: renderFieldSet(created) });
  }
  if ((mm = /^\/rest\/v2\.1\/companies\/\d+\/configurable_field_sets\/(\d+)$/.exec(path))) {
    const fs = c.fieldSets.find((x) => x.id === Number(mm![1]));
    if (!fs) return send(res, 404, { error: "not found" });
    if (m === "GET") return send(res, 200, { data: renderFieldSet(fs) });
    const hasConditional = Object.values((fs.fields ?? {}) as Record<string, Obj>).some((f) => f && typeof f === "object" && "conditions" in f);
    if (hasConditional) return send(res, 422, { errors: ["You cannot use this endpoint on a field set with conditional fields."] });
    const b = await body(req);
    Object.assign(fs, b.configurable_field_set);
    absorbCustomFields(fs);
    return send(res, 200, { data: renderFieldSet(fs) });
  }

  // Inspection types
  if (/^\/rest\/v1\.0\/companies\/\d+\/inspection_types$/.test(path)) {
    if (m === "GET") return page(c.inspectionTypes, url, res);
    const it = { ...((await body(req)).inspection_type as Obj), id: nextId() };
    c.inspectionTypes.push(it);
    return send(res, 201, it);
  }
  if ((mm = /^\/rest\/v1\.0\/companies\/\d+\/inspection_types\/(\d+)$/.exec(path)) && m === "PATCH") {
    const it = c.inspectionTypes.find((x) => x.id === Number(mm![1]));
    if (!it) return send(res, 404, {});
    Object.assign(it, (await body(req)).inspection_type);
    return send(res, 200, it);
  }

  // Observation types (solo GET a nivel company)
  if (/^\/rest\/v1\.0\/companies\/\d+\/observation_types$/.test(path) && m === "GET") return page(c.observationTypes, url, res);

  send(res, 404, { error: `mock: ${m} ${path} no implementado` });
});

const port = Number(process.env.MOCK_PORT ?? 4010);
server.listen(port, () => console.log(`Mock Procore escuchando en http://localhost:${port}`));
