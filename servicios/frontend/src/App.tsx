import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Bell, BellRing, Cpu, LayoutDashboard, LogOut, Moon, Sun, type LucideIcon } from "lucide-react";
import { api, type Device } from "./lib/api";
import { LiveContext, ThemeContext, toast, useLiveReadings, useLiveSocket, useRoute, useTheme, useThemeState } from "./lib/hooks";
import { AlertsPage, alertsQuery } from "./pages/Alerts";
import { Button, cx, Spinner, Toaster } from "./components/ui";
import { Login } from "./pages/Login";
import { DashboardsPage } from "./pages/Dashboards";
import { DashboardPage, KioskRotation } from "./pages/Dashboard";
import { DevicesPage } from "./pages/Devices";

export default function App() {
  const themeState = useThemeState();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, retry: false, staleTime: Infinity });
  const authed = me.isSuccess && !!me.data;

  // Sesión vencida en cualquier llamada -> volver al login.
  useEffect(() => {
    const h = () => qc.setQueryData(["me"], null);
    addEventListener("unauthorized", h);
    return () => removeEventListener("unauthorized", h);
  }, [qc]);

  const connected = useLiveSocket(authed);

  // Dispositivo o métrica nuevos en vivo -> refrescar la lista de dispositivos.
  useLiveReadings((rows) => {
    const known = qc.getQueryData<Device[]>(["devices"]);
    if (known && rows.some((r) => !known.some((d) => d.device === r.device && d.metrics.includes(r.metric))))
      qc.invalidateQueries({ queryKey: ["devices"] });
  }, authed);

  return (
    <ThemeContext.Provider value={themeState}>
      <LiveContext.Provider value={connected}>
        {me.isPending ? (
          <div className="flex min-h-dvh items-center justify-center">
            <Spinner />
          </div>
        ) : authed ? (
          <Shell user={me.data.user} connected={connected} />
        ) : (
          <Login />
        )}
        <Toaster />
      </LiveContext.Provider>
    </ThemeContext.Provider>
  );
}

function Shell({ user, connected }: { user: string; connected: boolean }) {
  const route = useRoute();
  const qc = useQueryClient();
  const { theme, toggle } = useTheme();
  const rotation = route[0] === "kiosk"; // #/kiosk/<segundos>/<id1,id2,...>
  const kiosk = (route[0] === "d" && route[2] === "kiosk") || rotation;

  // Alertas: contador en el menú y aviso emergente cuando una se dispara.
  const alerts = useQuery(alertsQuery);
  const firing = alerts.data?.rules.filter((r) => r.enabled && r.state === "firing") ?? [];
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!alerts.data) return;
    const ids = new Set(firing.map((r) => r.id));
    if (seen.current) for (const r of firing) if (!seen.current.has(r.id)) toast(`Alerta disparada: ${r.name}`, "error");
    seen.current = ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts.data]);

  const page = rotation ? (
    <KioskRotation seconds={Math.max(5, Number(route[1]) || 30)} ids={(route[2] ?? "").split(",").filter(Boolean)} />
  ) : route[0] === "d" && route[1] ? (
      <DashboardPage id={route[1]} kiosk={kiosk} />
    ) : route[0] === "devices" ? (
      <DevicesPage />
    ) : route[0] === "alerts" ? (
      <AlertsPage />
    ) : (
      <DashboardsPage />
    );
  const section = route[0] === "devices" || route[0] === "alerts" ? route[0] : "dashboards";

  async function logout() {
    await api.logout().catch(() => {});
    qc.clear();
    qc.setQueryData(["me"], null);
  }

  const ThemeIcon = theme === "dark" ? Sun : Moon;

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Barra lateral (escritorio) / superior (móvil). En modo kiosco no se dibuja, pero el dashboard sigue montado. */}
      {!kiosk && (
      <aside className="sticky top-0 z-30 flex shrink-0 items-center gap-1 border-b border-border bg-surface px-3 py-2 md:h-dvh md:w-56 md:flex-col md:items-stretch md:border-r md:border-b-0 md:px-3 md:py-4">
        <a href="#/" className="mr-2 flex items-center gap-2 px-2 md:mb-6 md:mr-0">
          <span className="rounded-md bg-accent/15 p-1.5">
            <Activity className="size-5 text-accent" />
          </span>
          <span className="hidden font-semibold tracking-tight sm:inline">IoT Platform</span>
        </a>
        <NavLink href="#/" icon={LayoutDashboard} active={section === "dashboards"}>
          Dashboards
        </NavLink>
        <NavLink href="#/devices" icon={Cpu} active={section === "devices"}>
          Dispositivos
        </NavLink>
        <NavLink href="#/alerts" icon={firing.length ? BellRing : Bell} active={section === "alerts"} badge={firing.length}>
          Alertas
        </NavLink>

        <div className="ml-auto flex items-center gap-1 md:mt-auto md:ml-0 md:flex-col md:items-stretch md:gap-2">
          <p
            className="hidden items-center gap-2 px-2.5 text-xs text-muted md:flex"
            title={connected ? "Recibiendo datos en vivo" : "Reconectando al servidor…"}
          >
            <span className={cx("size-2 rounded-full", connected ? "bg-ok" : "bg-danger")} />
            {connected ? "Conectado en vivo" : "Sin conexión en vivo"}
          </p>
          <Button variant="ghost" icon={ThemeIcon} onClick={toggle} className="md:w-full md:justify-start md:px-2.5" aria-label="Cambiar tema">
            <span className="hidden md:inline">{theme === "dark" ? "Tema claro" : "Tema oscuro"}</span>
          </Button>
          <div className="flex items-center gap-2 md:border-t md:border-border md:pt-3">
            <span className="hidden flex-1 truncate px-2.5 text-sm md:block">{user}</span>
            <Button variant="ghost" icon={LogOut} onClick={logout} aria-label="Cerrar sesión" title="Cerrar sesión" />
          </div>
        </div>
      </aside>
      )}

      <main className="min-w-0 flex-1">{page}</main>
    </div>
  );
}

function NavLink({
  href,
  icon: Icon,
  active,
  badge,
  children,
}: {
  href: string;
  icon: LucideIcon;
  active: boolean;
  badge?: number;
  children: string;
}) {
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition",
        active ? "bg-accent/15 font-medium text-accent" : "text-muted hover:bg-surface-2 hover:text-fg",
        badge ? "text-danger" : "",
      )}
    >
      <Icon className="size-4" />
      <span className="hidden sm:inline">{children}</span>
      {badge ? (
        <span className="ml-auto rounded-full bg-danger px-1.5 text-xs leading-5 font-semibold text-white max-sm:absolute max-sm:-top-1 max-sm:-right-1">
          {badge}
        </span>
      ) : null}
    </a>
  );
}
