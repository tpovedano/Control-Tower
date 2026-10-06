"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";

/** Si una pestaña falla al pintarse, se muestra este aviso en vez de una página en blanco. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-xl space-y-3 py-10">
      <Alert variant="error">
        <p className="font-medium">Esta pantalla tuvo un error inesperado.</p>
        <p className="mt-1 text-xs">{error.message}</p>
      </Alert>
      <div className="flex gap-2">
        <Button onClick={reset}>Reintentar</Button>
        <Button variant="outline" onClick={() => (window.location.href = "/cargar")}>
          Ir a Cargar
        </Button>
      </div>
    </div>
  );
}
