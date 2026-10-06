import { es } from "./es";

const dictionaries = { es } as const;
export type Locale = keyof typeof dictionaries;

export function getDictionary(locale: Locale = "es") {
  return dictionaries[locale];
}

/** Atajo para la locale por defecto. */
export const t = getDictionary("es");
