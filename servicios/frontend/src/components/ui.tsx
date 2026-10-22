import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Loader2, X, XCircle, type LucideIcon } from "lucide-react";
import { useToasts } from "../lib/hooks";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:brightness-110",
  secondary: "bg-surface-2 text-fg border border-border hover:border-muted/60",
  ghost: "text-muted hover:text-fg hover:bg-surface-2",
  danger: "bg-danger text-white hover:brightness-110",
};

export function Button({
  variant = "secondary",
  icon: Icon,
  loading,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: LucideIcon; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md text-sm font-medium whitespace-nowrap transition",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        children ? "px-3" : "w-8",
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 shrink-0 animate-spin" /> : Icon && <Icon className="size-4 shrink-0" />}
      {children}
    </button>
  );
}

export const inputCls =
  "h-8 w-full rounded-md border border-border bg-surface-2 px-2.5 text-sm text-fg placeholder:text-muted/70 " +
  "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25";

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "xl";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        "m-auto max-h-[calc(100dvh-2rem)] rounded-xl border border-border bg-surface p-0 text-fg shadow-2xl",
        size === "md" ? "w-[min(100%-2rem,30rem)]" : "h-[calc(100dvh-2rem)] w-[min(100%-2rem,90rem)]",
      )}
    >
      {open && (
        <div className="flex h-full max-h-[calc(100dvh-2rem)] flex-col">
          <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
            <h2 className="min-w-0 truncate font-semibold">{title}</h2>
            <Button variant="ghost" icon={X} onClick={onClose} aria-label="Cerrar" />
          </header>
          <div className="min-h-0 flex-1 overflow-auto p-5">{children}</div>
          {footer && <footer className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

/**
 * Menú desplegable. Se dibuja en un portal (encima de todo, sin recortes de paneles vecinos)
 * y se cierra al hacer clic fuera, con Escape, al hacer scroll o al elegir una opción.
 */
export function Dropdown({
  trigger,
  children,
  align = "right",
  className,
}: {
  trigger: (props: { onClick: () => void; "aria-expanded": boolean }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = () => setPos(null);

  useEffect(() => {
    if (!pos) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!anchor.current?.contains(t) && !menu.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    addEventListener("scroll", close, true);
    addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      removeEventListener("scroll", close, true);
      removeEventListener("resize", close);
    };
  }, [pos]);

  const toggle = () => {
    if (pos) return close();
    const r = anchor.current!.getBoundingClientRect();
    setPos(align === "right" ? { top: r.bottom + 4, right: innerWidth - r.right } : { top: r.bottom + 4, left: r.left });
  };

  return (
    <div ref={anchor} className="relative">
      {trigger({ onClick: toggle, "aria-expanded": !!pos })}
      {pos &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            style={pos}
            className={cx(
              "fixed z-[60] max-h-[70vh] overflow-auto rounded-lg border border-border bg-surface p-1 text-fg shadow-xl",
              className ?? "min-w-44",
            )}
          >
            {children(close)}
          </div>,
          document.querySelector("dialog[open]") ?? document.body,
        )}
    </div>
  );
}

export function MenuItem({
  icon: Icon,
  children,
  onClick,
  danger,
}: {
  icon?: LucideIcon;
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-2",
        danger ? "text-danger" : "text-fg",
      )}
    >
      {Icon && <Icon className="size-4 opacity-80" />}
      {children}
    </button>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-16 text-center">
      <div className="mb-4 rounded-full bg-surface-2 p-3">
        <Icon className="size-6 text-muted" />
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export const Spinner = ({ className }: { className?: string }) => (
  <Loader2 className={cx("size-5 animate-spin text-muted", className)} />
);

export function Toaster() {
  const toasts = useToasts();
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[100] flex flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm shadow-xl"
        >
          {t.kind === "ok" ? <CheckCircle2 className="size-4 text-ok" /> : <XCircle className="size-4 text-danger" />}
          {t.text}
        </div>
      ))}
    </div>
  );
}

export { cx };
