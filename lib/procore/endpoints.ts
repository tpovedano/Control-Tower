/**
 * Único lugar con paths y versiones de la REST API de Procore.
 * Verificados contra la referencia oficial (developers.procore.com / OAS combinado).
 * Si Procore cambia un contrato, se ajusta aquí.
 */
type Id = string | number;

export const PROCORE_ENDPOINTS = {
  oauth: {
    token: "/oauth/token",
    authorize: "/oauth/authorize",
  },
  /** Endpoint ligero para "Probar conexión" (no requiere Procore-Company-Id). */
  companies: () => `/rest/v1.0/companies`,

  customFields: {
    list: (c: Id) => `/rest/v2.0/companies/${c}/custom_field_definitions`,
    show: (c: Id, id: Id) => `/rest/v2.0/companies/${c}/custom_field_definitions/${id}`,
    create: (c: Id) => `/rest/v2.0/companies/${c}/custom_field_definitions`,
    update: (c: Id, id: Id) => `/rest/v2.0/companies/${c}/custom_field_definitions/${id}`,
    /**
     * Tipos de dato y variantes habilitados para la company.
     * Nota: el prompt original sugería custom_field_metadata, pero ese recurso describe la
     * ubicación de un campo dentro de un field set; el catálogo de tipos está aquí.
     */
    dataTypes: (c: Id) => `/rest/v2.0/companies/${c}/custom_field/data_types`,
    metadata: (c: Id) => `/rest/v2.0/companies/${c}/custom_field_metadata`,
  },

  lovEntries: {
    list: (c: Id, cfId: Id) => `/rest/v2.0/companies/${c}/custom_field_definitions/${cfId}/custom_field_lov_entries`,
    /** Posición ordenada de forma descendente: la mayor posición queda arriba. */
    bulkCreate: (cfId: Id) => `/rest/v1.0/custom_field_definitions/${cfId}/custom_field_lov_entries/bulk_create`,
  },

  fieldSets: {
    list: (c: Id) => `/rest/v2.1/companies/${c}/configurable_field_sets`,
    show: (c: Id, id: Id) => `/rest/v2.1/companies/${c}/configurable_field_sets/${id}`,
    create: (c: Id) => `/rest/v2.1/companies/${c}/configurable_field_sets`,
    update: (c: Id, id: Id) => `/rest/v2.1/companies/${c}/configurable_field_sets/${id}`,
    sections: (c: Id) => `/rest/v2.1/companies/${c}/configurable_field_sets/sections`,
    projects: (c: Id, id: Id) => `/rest/v2.0/companies/${c}/configurable_field_sets/${id}/projects`,
  },

  inspectionTypes: {
    list: (c: Id) => `/rest/v1.0/companies/${c}/inspection_types`,
    create: (c: Id) => `/rest/v1.0/companies/${c}/inspection_types`,
    update: (c: Id, id: Id) => `/rest/v1.0/companies/${c}/inspection_types/${id}`,
  },

  observationTypes: {
    /** Solo lectura a nivel company: la API publica GET pero no POST/PATCH a nivel company. */
    listCompany: (c: Id) => `/rest/v1.0/companies/${c}/observation_types`,
    /** Escritura existente solo a nivel proyecto (no usada en v1). */
    createProject: (p: Id) => `/rest/v1.0/projects/${p}/observation_types`,
    updateProject: (p: Id, id: Id) => `/rest/v1.0/projects/${p}/observation_types/${id}`,
  },
} as const;

export const PER_PAGE_MAX = 100;
