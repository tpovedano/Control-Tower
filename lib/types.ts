/** Tipos de dominio compartidos entre cliente y servidor (sin dependencias de servidor). */

export const OBJECT_TYPES = [
  "custom_fields",
  "lov_entries",
  "field_sets",
  "inspection_types",
  "observation_types",
] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];

export type AttrValue = string | number | boolean | null | string[];

/** Elemento leído de Procore y normalizado. */
export interface NormalizedItem {
  /** Llave de correspondencia entre instancias (para LOV: "CF-001/OPT-01"). null si no tiene [ID]. */
  key: string | null;
  stdId: string | null;
  parentKey?: string | null;
  /** Nombre completo tal como está en Procore. */
  name: string;
  /** Texto del nombre sin el [ID]. */
  text: string;
  remoteId: string;
  parentRemoteId?: string | null;
  /** Atributos estructurales que se comparan entre instancias (nunca el nombre). */
  attrs: Record<string, AttrValue>;
  /** Datos no comparados pero útiles para replicar (descripción, fields…). */
  extra?: Record<string, unknown>;
}

/** Elemento deseado (fila pegada o definición tomada de la referencia). */
export interface DesiredItem {
  key: string;
  stdId: string;
  parentKey?: string;
  name: string;
  attrs: Record<string, AttrValue>;
  extra?: Record<string, unknown>;
}

export type PlanAction = "CREATE" | "UPDATE" | "NOCHANGE" | "SKIP";

export interface AttrDiff {
  attr: string;
  current: AttrValue | undefined;
  desired: AttrValue | undefined;
}

export interface PlanResult {
  action: PlanAction;
  diffs: AttrDiff[];
  message?: string;
  remoteId?: string;
  /** IDs de dependencias faltantes en la instancia destino. */
  missingDependencies?: string[];
}

export interface PlanOptions {
  /** Si es true, el nombre/descripción también se comparan y se sobrescriben. */
  includeTexts: boolean;
  /** Si se indica, solo se permiten estas acciones de escritura (el resto se omite). */
  onlyActions?: PlanAction[];
}

export type RowStatus = "valid" | "warning" | "error";

export interface ParsedRow {
  index: number;
  status: RowStatus;
  messages: string[];
  desired?: DesiredItem;
}

export interface ColumnSpec {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  example: string;
}
