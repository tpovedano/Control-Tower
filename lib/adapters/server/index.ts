import type { ObjectType } from "@/lib/types";
import { customFieldsAdapter } from "./custom-fields";
import { fieldSetsAdapter } from "./field-sets";
import { inspectionTypesAdapter } from "./inspection-types";
import { lovEntriesAdapter } from "./lov-entries";
import { observationTypesAdapter } from "./observation-types";
import type { ServerAdapter } from "./types";

export const ADAPTERS: Record<ObjectType, ServerAdapter> = {
  custom_fields: customFieldsAdapter,
  lov_entries: lovEntriesAdapter,
  field_sets: fieldSetsAdapter,
  inspection_types: inspectionTypesAdapter,
  observation_types: observationTypesAdapter,
};

export function getAdapter(type: ObjectType): ServerAdapter {
  return ADAPTERS[type];
}
