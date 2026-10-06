import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

/** Badges con color + ícono + texto (no dependen solo del color). */
const STYLES = {
  green: "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800",
  blue: "bg-sky-100 text-sky-900 border-sky-300 dark:bg-sky-950 dark:text-sky-200 dark:border-sky-800",
  amber: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800",
  red: "bg-red-100 text-red-900 border-red-300 dark:bg-red-950 dark:text-red-200 dark:border-red-800",
  gray: "bg-muted text-muted-foreground border-border",
  violet: "bg-violet-100 text-violet-900 border-violet-300 dark:bg-violet-950 dark:text-violet-200 dark:border-violet-800",
} as const;

export function Badge({ color = "gray", icon, children, className, title }: { color?: keyof typeof STYLES; icon?: string; children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-xs font-medium", STYLES[color], className)}>
      {icon && <span aria-hidden>{icon}</span>}
      {children}
    </span>
  );
}

export const CELL_META = {
  aligned: { icon: "✅", color: "green", label: t.cell.aligned },
  missing: { icon: "➕", color: "blue", label: t.cell.missing },
  differs: { icon: "⚠️", color: "amber", label: t.cell.differs },
  conflict: { icon: "⛔", color: "red", label: t.cell.conflict },
  orphan: { icon: "🔇", color: "gray", label: t.cell.orphan },
} as const;

export function CellBadge({ status, compact }: { status: keyof typeof CELL_META; compact?: boolean }) {
  const m = CELL_META[status];
  return (
    <Badge color={m.color} icon={m.icon}>
      {compact ? <span className="sr-only">{m.label}</span> : m.label}
    </Badge>
  );
}

export const ACTION_META = {
  CREATE: { icon: "➕", color: "blue" },
  UPDATE: { icon: "✏️", color: "amber" },
  NOCHANGE: { icon: "＝", color: "green" },
  SKIP: { icon: "⏭", color: "gray" },
} as const;

export function ActionBadge({ action }: { action: keyof typeof ACTION_META }) {
  const m = ACTION_META[action];
  return (
    <Badge color={m.color} icon={m.icon}>
      {t.actions[action]}
    </Badge>
  );
}

export function RowStatusBadge({ status }: { status: "valid" | "warning" | "error" }) {
  const m = { valid: { icon: "✅", color: "green" }, warning: { icon: "⚠️", color: "amber" }, error: { icon: "❌", color: "red" } }[status] as {
    icon: string;
    color: keyof typeof STYLES;
  };
  return (
    <Badge color={m.color} icon={m.icon}>
      {t.row[status]}
    </Badge>
  );
}

export function ItemStatusBadge({ status }: { status: string }) {
  const m: Record<string, { icon: string; color: keyof typeof STYLES }> = {
    pending: { icon: "…", color: "gray" },
    success: { icon: "✅", color: "green" },
    error: { icon: "❌", color: "red" },
    skipped: { icon: "⏭", color: "gray" },
    nochange: { icon: "＝", color: "green" },
  };
  const x = m[status] ?? m.pending;
  return (
    <Badge color={x.color} icon={x.icon}>
      {(t.itemStatus as Record<string, string>)[status] ?? status}
    </Badge>
  );
}
