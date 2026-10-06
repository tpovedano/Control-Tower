/** Tipos de las respuestas de la API usados en el navegador (sin secretos). */
export interface PublicInstance {
  id: string;
  label: string;
  companyId: string;
  companyName: string | null;
  language: string;
  environment: "production" | "sandbox";
  authMethod: "client_credentials" | "authorization_code";
  hasCustomCredentials: boolean;
  isAuthorized: boolean;
  isGolden: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
}

export interface SnapshotMeta {
  instanceId: string;
  objectType: string;
  takenAt: string;
  ok: boolean;
  error: string | null;
  itemCount: number;
}

export interface RunItem {
  id: string;
  runId: string;
  instanceId: string;
  rowIndex: number;
  key: string;
  action: "CREATE" | "UPDATE" | "NOCHANGE" | "SKIP";
  diffs: { attr: string; current: unknown; desired: unknown }[];
  message: string | null;
  status: "pending" | "success" | "error" | "skipped" | "nochange";
  resultMessage: string | null;
  remoteId: string | null;
}

import type { MatrixRow, MatrixStats } from "@/lib/diff/matrix";

export interface GovernanceResponse {
  objectType: string;
  instances: PublicInstance[];
  rows: MatrixRow[];
  stats: MatrixStats;
  crossConflicts: { id: string; types: string[] }[];
  snapshots: SnapshotMeta[];
  referenceMode: "catalog" | "golden" | "consensus";
  catalogSize: number;
}
