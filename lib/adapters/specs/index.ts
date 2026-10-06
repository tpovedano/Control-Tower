import type { ObjectType } from "@/lib/types";
import type { ObjectSpec } from "../spec-types";
import { customFieldsSpec } from "./custom-fields";
import { fieldSetsSpec } from "./field-sets";
import { inspectionTypesSpec } from "./inspection-types";
import { lovEntriesSpec } from "./lov-entries";
import { observationTypesSpec } from "./observation-types";

export const SPECS: Record<ObjectType, ObjectSpec> = {
  custom_fields: customFieldsSpec,
  lov_entries: lovEntriesSpec,
  field_sets: fieldSetsSpec,
  inspection_types: inspectionTypesSpec,
  observation_types: observationTypesSpec,
};

export function getSpec(type: ObjectType): ObjectSpec {
  return SPECS[type];
}

/** Orden de ejecución respetando dependencias. */
export const EXECUTION_ORDER: ObjectType[] = ["custom_fields", "lov_entries", "field_sets", "inspection_types", "observation_types"];
