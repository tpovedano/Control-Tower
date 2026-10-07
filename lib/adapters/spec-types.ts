import type { AttrValue, ColumnSpec, DesiredItem, ObjectType, SelectOption } from "@/lib/types";

export interface DataTypeInfo {
  dataType: string;
  label?: string;
  variants: string[];
}

/** Contexto de validación en vivo (todo serializable; se calcula a partir de snapshots/metadatos). */
export interface ValidationContext {
  dataTypes?: DataTypeInfo[];
  /** IDs conocidos por tipo (unión de las instancias sincronizadas). */
  known?: Partial<Record<ObjectType, string[]>>;
  /** Opciones de los desplegables (de los snapshots): fieldSetTemplates, customFields, lovCustomFields. */
  options?: Partial<Record<string, SelectOption[]>>;
}

export interface RowParseResult {
  desired?: DesiredItem;
  errors: string[];
  warnings: string[];
}

/** Parte "client-safe" de un adaptador: columnas, parseo y reglas de comparación. */
export interface ObjectSpec {
  type: ObjectType;
  label: string;
  singular: string;
  idPrefixExample: string;
  writable: boolean;
  readOnlyReason?: string;
  dependsOn: ObjectType[];
  columns: ColumnSpec[];
  /** Atributos estructurales comparados entre instancias (nunca el nombre). */
  compareAttrs: string[];
  /** Atributo que define la "naturaleza" del objeto (si difiere → conflicto). */
  natureAttr?: string;
  attrLabels: Record<string, string>;
  parseRow(cells: Record<string, string>, ctx: ValidationContext): RowParseResult;
}

export function attrEquals(a: AttrValue | undefined, b: AttrValue | undefined): boolean {
  const norm = (v: AttrValue | undefined): AttrValue => {
    if (v === undefined || v === "") return null;
    if (Array.isArray(v)) return [...v].map(String).sort();
    if (typeof v === "string") return v.trim();
    return v;
  };
  const x = norm(a);
  const y = norm(b);
  if (Array.isArray(x) && Array.isArray(y)) return x.length === y.length && x.every((v, i) => v === y[i]);
  return x === y;
}

export function formatAttr(v: AttrValue | undefined): string {
  if (v === undefined || v === null || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "(ninguno)";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  return String(v);
}
