"use client";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import { t } from "@/lib/i18n";

export function LoginForm({ requiresUser }: { requiresUser: boolean }) {
  const params = useSearchParams();
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user, password }) });
    setLoading(false);
    if (!res.ok) {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "No se pudo iniciar sesión");
      return;
    }
    const next = params.get("next");
    window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/cargar";
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">{t.app.name}</CardTitle>
        <CardDescription>{t.app.tagline}. Acceso restringido.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="user">{requiresUser ? "Correo" : "Nombre (para el historial)"}</Label>
            <Input id="user" type={requiresUser ? "email" : "text"} required={requiresUser} value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Contraseña de acceso</Label>
            <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          {error && <Alert variant="error">{error}</Alert>}
          <Button type="submit" className="w-full" loading={loading}>
            Entrar
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
