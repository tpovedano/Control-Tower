"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Building2, ExternalLink, History, LayoutGrid, LogOut, Upload } from "lucide-react";
import { isEmbedded } from "@/lib/client/embed";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { ThemeToggle } from "./theme-toggle";

const TABS = [
  { href: "/cargar", label: t.nav.cargar, icon: Upload },
  { href: "/gobierno", label: t.nav.gobierno, icon: LayoutGrid },
  { href: "/instancias", label: t.nav.instancias, icon: Building2 },
  { href: "/historial", label: t.nav.historial, icon: History },
];

export function Nav({ user }: { user: string }) {
  const pathname = usePathname();
  const [embedded, setEmbedded] = useState(false);
  useEffect(() => setEmbedded(isEmbedded()), []);
  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-4">
        <Link href="/cargar" className="flex items-center gap-2 font-semibold">
          <span className="flex h-7 w-7 items-center justify-center rounded bg-primary text-sm text-primary-foreground" aria-hidden>
            ⌖
          </span>
          <span className="hidden sm:inline">{t.app.name}</span>
        </Link>
        <nav className="flex flex-1 items-center gap-1 overflow-x-auto" aria-label="Pestañas">
          {TABS.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>
        <span className="hidden text-xs text-muted-foreground md:inline">{user}</span>
        {embedded && (
          <a
            href={pathname}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent"
            title="Abrir en pestaña nueva (más espacio y descargas sin restricciones)"
          >
            <ExternalLink className="h-4 w-4" />
            <span className="sr-only">Abrir en pestaña nueva</span>
          </a>
        )}
        <ThemeToggle />
        <button onClick={logout} className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent" title={t.nav.logout}>
          <LogOut className="h-4 w-4" />
          <span className="sr-only">{t.nav.logout}</span>
        </button>
      </div>
    </header>
  );
}
