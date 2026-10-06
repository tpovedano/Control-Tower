/** Diccionario de textos de la interfaz (español). Para añadir inglés, crear en.ts con las mismas claves. */
export const es = {
  app: { name: "Procore Control Tower", tagline: "Gobierno de configuración multi-instancia" },
  nav: { cargar: "Cargar", gobierno: "Gobierno", instancias: "Instancias", historial: "Historial", logout: "Salir" },
  actions: { CREATE: "CREAR", UPDATE: "ACTUALIZAR", NOCHANGE: "SIN CAMBIOS", SKIP: "OMITIR" },
  itemStatus: { pending: "Pendiente", success: "Éxito", error: "Error", skipped: "Omitido", nochange: "Sin cambios" },
  cell: { aligned: "Alineado", missing: "Falta", differs: "Difiere", conflict: "Conflicto", orphan: "Sin ID / No gobernado", nodata: "Sin datos" },
  row: { valid: "Válida", warning: "Advertencia", error: "Error" },
  steps: ["Elegir tipo", "Pegar", "Elegir instancias", "Revisar (dry-run)", "Ejecutar"],
} as const;

export type Dictionary = typeof es;
