import { useState, type ReactNode } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/* ----- Group label ----- */

export function SettingsGroup({
  label,
  children,
  className,
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mt-6 first:mt-0", className)}>
      {label && (
        <h2 className="mb-2 px-3 text-[11px] font-bold uppercase tracking-widest text-text-tertiary">
          {label}
        </h2>
      )}
      {children}
    </section>
  );
}

/* ----- List container ----- */

export function SettingsList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-divider bg-card/80 backdrop-blur-sm divide-y divide-divider",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ----- Simple read/edit row ----- */

interface RowBase {
  icon?: ReactNode;
  label: ReactNode;
  description?: ReactNode;
  className?: string;
}

export function SettingsRow({
  icon,
  label,
  description,
  value,
  trailing,
  className,
}: RowBase & {
  /** Right-aligned secondary text. */
  value?: ReactNode;
  /** Right-side element (badge, switch, chevron). */
  trailing?: ReactNode;
}) {
  return (
    <div className={cn("flex items-center gap-3 px-4 py-3 text-sm", className)}>
      {icon && <span className="shrink-0 text-text-tertiary">{icon}</span>}
      <div className="min-w-0 flex-1">
        <div className="truncate text-text-primary">{label}</div>
        {description && <div className="mt-0.5 text-xs text-text-tertiary">{description}</div>}
      </div>
      {value !== undefined && (
        <div className="max-w-[55%] truncate text-right text-text-secondary">{value}</div>
      )}
      {trailing}
    </div>
  );
}

/* ----- Button row (e.g. Sign out, +Add) ----- */

export function SettingsButtonRow({
  icon,
  label,
  description,
  onClick,
  tone = "default",
  trailing,
  disabled,
  className,
}: RowBase & {
  onClick: () => void;
  tone?: "default" | "accent" | "destructive";
  trailing?: ReactNode;
  disabled?: boolean;
}) {
  const toneClass =
    tone === "destructive"
      ? "text-destructive"
      : tone === "accent"
        ? "text-accent-ink"
        : "text-text-primary";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition hover:bg-elevated/50 disabled:opacity-50",
        toneClass,
        className,
      )}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{label}</div>
        {description && <div className="mt-0.5 text-xs text-text-tertiary">{description}</div>}
      </div>
      {trailing}
    </button>
  );
}

/* ----- Disclosure row with inline body ----- */

export function SettingsDisclosure({
  icon,
  label,
  description,
  value,
  defaultOpen = false,
  children,
}: RowBase & {
  value?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition hover:bg-elevated/50"
        aria-expanded={open}
      >
        {icon && <span className="shrink-0 text-text-tertiary">{icon}</span>}
        <div className="min-w-0 flex-1">
          <div className="truncate text-text-primary">{label}</div>
          {description && <div className="mt-0.5 text-xs text-text-tertiary">{description}</div>}
        </div>
        {value !== undefined && (
          <div className="max-w-[40%] truncate text-right text-xs text-text-tertiary">{value}</div>
        )}
        {open ? (
          <ChevronDown className="size-4 text-text-tertiary" />
        ) : (
          <ChevronRight className="size-4 text-text-tertiary" />
        )}
      </button>
      {open && <div className="border-t border-divider bg-elevated/30 px-4 py-4">{children}</div>}
    </div>
  );
}

/* ----- Toggle row ----- */

export function SettingsToggleRow({
  icon,
  label,
  description,
  trailing,
}: RowBase & { trailing: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 text-sm">
      {icon && <span className="shrink-0 text-text-tertiary">{icon}</span>}
      <div className="min-w-0 flex-1">
        <div className="truncate text-text-primary">{label}</div>
        {description && <div className="mt-0.5 text-xs text-text-tertiary">{description}</div>}
      </div>
      {trailing}
    </div>
  );
}

/* ----- Page header (matches plans header density) ----- */

export function SettingsHeader({ title }: { title: string }) {
  return (
    <header className="mb-3">
      <p className="text-[11px] font-bold uppercase tracking-widest text-accent-ink">Settings</p>
      <h1 className="mt-0.5 font-display text-2xl text-text-primary">{title}</h1>
    </header>
  );
}
