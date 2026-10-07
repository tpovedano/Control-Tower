/**
 * Servidor Procore simulado para desarrollo local sin credenciales de sandbox.
 *   npm run mock:procore   (puerto 4010)
 * y en .env.local: PROCORE_BASE_URL=http://localhost:4010  PROCORE_LOGIN_URL=http://localhost:4010
 * Companies: 1001 (es) y 1002 (en) con datos de ejemplo. MOCK_429=1 inyecta 429 periódicos.
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
}

let seq = 5000;
const nextId = () => ++seq;

const companies: Record<string, Company> = {
  "1001": {
    name: "Demo Constructora (ES)",
    cfs: [
      { id: 11, label: "[CF-001] Fecha de inspección", data_type: "datetime", active: true },
      { id: 12, label: "[CF-002] Estado de calidad", data_type: "lov_entry", active: true },
      { id: 13, label: "Campo antiguo sin ID", data_type: "string", active: true },
    ],
    lovs: { 12: [{ id: 121, label: "[OK] Conforme", active: true, position: 2 }, { id: 122, label: "[NOK] No conforme", active: true, position: 1 }] },
    fieldSets: [
      { id: 31, name: "Predeterminado Observaciones", class_name: "Observation", company_default: true, fields: { title: { required: true } }, custom_field_sections: [] },
      { id: 32, name: "[FS-001] Calidad", class_name: "Observation", fields: { title: { required: true } }, custom_field_sections: [{ id: 301, name: "General", custom_field_definition_ids: [11, 12] }] },
    ],
    inspectionTypes: [{ id: 41, name: "[IT-001] Seguridad", grouping: "HSE" }],
    observationTypes: [{ id: 51, name: "[OT-001] Seguridad", category: "safety", active: true }],
  },
  "1002": {
    name: "Demo Builders (EN)",
    cfs: [
      { id: 21, label: "[CF-001] Inspection date", data_type: "datetime", active: true },
      { id: 22, label: "[CF-002] Quality status", data_type: "lov_entry", active: false },
    ],
    lovs: { 22: [{ id: 221, label: "[OK] Compliant", active: true, position: 1 }] },
    fieldSets: [{ id: 61, name: "Default Observations", class_name: "Observation", company_default: true, fields: { title: { required: true } }, custom_field_sections: [] }],
    inspectionTypes: [],
    observationTypes: [{ id: 71, name: "[OT-001] Safety", category: "safety", active: true }],
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
    const id = Number(mm[1]);
    const list = (c.lovs[id] ??= []);
    const entries = ((await body(req)).custom_field_lov_entries ?? []) as { label: string }[];
    let pos = Math.max(0, ...list.map((l) => Number(l.position)));
    const created = entries.map((e) => ({ id: nextId(), label: e.label, active: true, position: ++pos }));
    list.push(...created);
    return send(res, 201, created);
  }

  // Field sets
  if (/^\/rest\/v2\.1\/companies\/\d+\/configurable_field_sets$/.test(path)) {
    if (m === "GET") return page(c.fieldSets.map(({ custom_field_sections: _s, ...fs }) => fs), url, res, true);
    const b = await body(req);
    const fs = b.configurable_field_set as Obj;
    if (!fs?.name || !fs.class_name || !fs.fields) return send(res, 422, { errors: { base: ["name, class_name y fields son obligatorios"] } });
    const created = { ...fs, id: nextId(), custom_field_sections: ((b.custom_field_sections ?? []) as Obj[]).map((s) => ({ ...s, id: nextId() })) };
    c.fieldSets.push(created);
    return send(res, 201, { data: created });
  }
  if ((mm = /^\/rest\/v2\.1\/companies\/\d+\/configurable_field_sets\/(\d+)$/.exec(path))) {
    const fs = c.fieldSets.find((x) => x.id === Number(mm![1]));
    if (!fs) return send(res, 404, { error: "not found" });
    if (m === "GET") return send(res, 200, { data: fs });
    const b = await body(req);
    Object.assign(fs, b.configurable_field_set, { custom_field_sections: ((b.custom_field_sections ?? []) as Obj[]).map((s) => ({ ...s, id: s.id ?? nextId() })) });
    return send(res, 200, { data: fs });
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
