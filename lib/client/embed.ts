/** ¿La app se está mostrando dentro de un iframe (p. ej. app "full screen" de Procore)? */
export function isEmbedded(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true; // acceso a window.top bloqueado = estamos en un iframe de otro origen
  }
}

/** Abre una URL en pestaña nueva. Devuelve false si el navegador/iframe bloqueó la ventana emergente. */
export function openInNewTab(url: string): boolean {
  // Sin "noopener": la pestaña de autorización avisa a esta ventana (postMessage) al terminar.
  const w = window.open(url, "_blank");
  return !!w;
}
