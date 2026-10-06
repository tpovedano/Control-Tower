import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Instancias (companies) de Procore conectadas. Secretos y tokens siempre cifrados (AES-256-GCM). */
export const instances = pgTable("instances", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label").notNull(),
  companyId: text("company_id").notNull(),
  companyName: text("company_name"),
  language: text("language").notNull().default("es"),
  environment: text("environment").notNull().default("production"), // production | sandbox
  authMethod: text("auth_method").notNull().default("client_credentials"), // client_credentials | authorization_code
  clientIdEnc: text("client_id_enc"), // opcional: override de credencial (DMSA propia)
  clientSecretEnc: text("client_secret_enc"),
  accessTokenEnc: text("access_token_enc"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenEnc: text("refresh_token_enc"),
  isGolden: boolean("is_golden").notNull().default(false),
  lastTestAt: timestamp("last_test_at", { withTimezone: true }),
  lastTestOk: boolean("last_test_ok"),
  lastTestMessage: text("last_test_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/** Lecturas (snapshot) por instancia y tipo de objeto. */
export const snapshots = pgTable(
  "snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instanceId: uuid("instance_id").notNull().references(() => instances.id),
    objectType: text("object_type").notNull(),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull().defaultNow(),
    ok: boolean("ok").notNull(),
    error: text("error"),
    itemCount: integer("item_count").notNull().default(0),
    items: jsonb("items").notNull().default([]),
  },
  (t) => ({ byInstanceType: index("snapshots_instance_type_idx").on(t.instanceId, t.objectType, t.takenAt) }),
);

/** Catálogo maestro: definición de referencia por [ID]. */
export const catalogItems = pgTable(
  "catalog_items",
  {
    objectType: text("object_type").notNull(),
    key: text("key").notNull(),
    item: jsonb("item").notNull(),
    sourceInstanceId: uuid("source_instance_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by"),
  },
  (t) => ({ pk: primaryKey({ columns: [t.objectType, t.key] }) }),
);

/** Ejecución (lote). Las filas deseadas se guardan aquí: execute solo aplica lo que pasó por dry-run. */
export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by").notNull(),
  source: text("source").notNull(), // cargar | gobierno
  objectType: text("object_type").notNull(),
  options: jsonb("options").notNull().default({}),
  desired: jsonb("desired").notNull(), // DesiredItem[]
  instanceIds: jsonb("instance_ids").notNull(), // string[]
  status: text("status").notNull().default("planning"), // planning | planned | confirmed | running | done
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  confirmedBy: text("confirmed_by"),
});

export const runItems = pgTable(
  "run_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => runs.id),
    instanceId: uuid("instance_id").notNull().references(() => instances.id),
    rowIndex: integer("row_index").notNull(),
    key: text("key").notNull(),
    action: text("action").notNull(), // CREATE | UPDATE | NOCHANGE | SKIP
    diffs: jsonb("diffs").notNull().default([]),
    message: text("message"),
    status: text("status").notNull().default("pending"), // pending | success | error | skipped
    resultMessage: text("result_message"),
    remoteId: text("remote_id"),
    executedAt: timestamp("executed_at", { withTimezone: true }),
  },
  (t) => ({ byRun: index("run_items_run_idx").on(t.runId, t.instanceId) }),
);

/** Audit log: quién, cuándo, dónde, qué. Nunca contiene secretos ni tokens. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    user: text("user").notNull(),
    instanceId: uuid("instance_id"),
    instanceLabel: text("instance_label"),
    companyId: text("company_id"),
    objectType: text("object_type"),
    key: text("key"),
    action: text("action").notNull(),
    result: text("result").notNull(), // success | error | info
    httpStatus: integer("http_status"),
    message: text("message"),
    requestPayload: jsonb("request_payload"),
    responseBody: jsonb("response_body"),
    runId: uuid("run_id"),
  },
  (t) => ({ byAt: index("audit_log_at_idx").on(t.at) }),
);

export type InstanceRow = typeof instances.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type RunItemRow = typeof runItems.$inferSelect;
export type AuditRow = typeof auditLog.$inferSelect;
