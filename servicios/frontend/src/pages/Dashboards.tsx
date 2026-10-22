import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, LayoutDashboard, MonitorPlay, Plus, Radio, Search, Trash2, Upload } from "lucide-react";
import { api, emptySpec, type DashboardSpec, type DashboardSummary } from "../lib/api";
import { navigate, toast } from "../lib/hooks";
import { timeAgo } from "../lib/time";
import { Button, cx, EmptyState, Field, inputCls, Modal, Spinner } from "../components/ui";

export function DashboardsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [rotating, setRotating] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const list = useQuery({ queryKey: ["dashboards"], queryFn: api.dashboards });
  const devices = useQuery({ queryKey: ["devices"], queryFn: api.devices });

  const create = useMutation({
    mutationFn: ({ name, spec }: { name: string; spec: DashboardSpec }) => api.createDashboard(name, spec),
    onSuccess: ({ id }) => {
      qc.invalidateQueries({ queryKey: ["dashboards"] });
      navigate(`/d/${id}`);
    },
    onError: (e) => toast(e.message, "error"),
  });

  const remove = useMutation({
    mutationFn: api.deleteDashboard,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboards"] });
      toast("Dashboard eliminado");
    },
    onError: (e) => toast(e.message, "error"),
  });

  async function importFile(f: File) {
    try {
      const j = JSON.parse(await f.text());
      if (typeof j.name !== "string" || !Array.isArray(j.spec?.panels)) throw new Error();
      create.mutate({ name: j.name, spec: { ...emptySpec(), ...j.spec } });
    } catch {
      toast("El archivo no es un dashboard exportado válido", "error");
    }
  }

  const shown = list.data?.filter((d) => d.name.toLowerCase().includes(search.toLowerCase())) ?? [];

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboards</h1>
          <p className="mt-1 text-sm text-muted">Organiza paneles para visualizar los datos de tus dispositivos.</p>
        </div>
        <div className="flex gap-2">
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importFile(f);
              e.target.value = "";
            }}
          />
          <Button icon={Upload} onClick={() => file.current?.click()}>
            Importar
          </Button>
          {(list.data?.length ?? 0) > 0 && (
            <Button icon={MonitorPlay} onClick={() => setRotating(true)} title="Mostrar varios dashboards en pantalla completa, uno tras otro">
              Rotar en kiosco
            </Button>
          )}
          <Button
            variant="primary"
            icon={Plus}
            loading={create.isPending}
            onClick={() => create.mutate({ name: "Nuevo dashboard", spec: emptySpec() })}
          >
            Nuevo dashboard
          </Button>
        </div>
      </div>

      {devices.data?.length === 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-accent/30 bg-accent/5 px-4 py-3 text-sm">
          <Radio className="size-4 shrink-0 text-accent" />
          <p className="flex-1">
            Aún no hay dispositivos conectados. Puedes armar tus dashboards desde ya: los paneles mostrarán datos en
            cuanto lleguen.
          </p>
          <Button variant="ghost" onClick={() => navigate("/devices")}>
            Cómo conectar un dispositivo →
          </Button>
        </div>
      )}

      {list.isPending ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : list.isError ? (
        <p className="text-danger">Error: {list.error.message}</p>
      ) : list.data.length === 0 ? (
        <EmptyState
          icon={LayoutDashboard}
          title="Todavía no tienes dashboards"
          action={
            <Button variant="primary" icon={Plus} onClick={() => create.mutate({ name: "Nuevo dashboard", spec: emptySpec() })}>
              Crear el primero
            </Button>
          }
        >
          Un dashboard agrupa paneles (series de tiempo con anomalías y pronóstico, valores, medidores, barras, tablas,
          estados, mapas de calor y mapas) que se actualizan en vivo.
        </EmptyState>
      ) : (
        <>
          <div className="relative mb-4 max-w-sm">
            <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted" />
            <input className={`${inputCls} pl-8`} placeholder="Buscar dashboards" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((d) => (
              <li key={d.id} className="group relative">
                <a
                  href={`#/d/${d.id}`}
                  className="flex h-full items-start gap-3 rounded-lg border border-border bg-surface p-4 transition hover:border-accent/60 hover:shadow-lg"
                >
                  <div className="rounded-md bg-surface-2 p-2">
                    <LayoutDashboard className="size-5 text-accent" />
                  </div>
                  <div className="min-w-0 flex-1 pr-8">
                    <p className="truncate font-medium">{d.name}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {d.panels} {d.panels === 1 ? "panel" : "paneles"} · actualizado {timeAgo(d.updated_at)}
                    </p>
                  </div>
                </a>
                <Button
                  variant="ghost"
                  icon={Trash2}
                  aria-label={`Eliminar ${d.name}`}
                  className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 focus:opacity-100"
                  onClick={() => confirm(`¿Eliminar el dashboard "${d.name}"?`) && remove.mutate(d.id)}
                />
              </li>
            ))}
            {shown.length === 0 && <p className="text-sm text-muted">Ningún dashboard coincide con "{search}".</p>}
          </ul>
        </>
      )}
      {rotating && list.data && <RotationModal dashboards={list.data} onClose={() => setRotating(false)} />}
    </div>
  );
}

const ROTATION_SECONDS: [number, string][] = [
  [15, "15 segundos"],
  [30, "30 segundos"],
  [60, "1 minuto"],
  [120, "2 minutos"],
  [300, "5 minutos"],
];

/** Elegir qué dashboards rotan en modo kiosco, en qué orden y cada cuánto. */
function RotationModal({ dashboards, onClose }: { dashboards: DashboardSummary[]; onClose: () => void }) {
  const [order, setOrder] = useState(dashboards.map((d) => d.id));
  const [chosen, setChosen] = useState(new Set(order));
  const [seconds, setSeconds] = useState(30);
  const byId = new Map(dashboards.map((d) => [d.id, d]));
  const ids = order.filter((id) => chosen.has(id));
  const path = `/kiosk/${seconds}/${ids.join(",")}`;
  const move = (i: number, d: number) =>
    setOrder((o) => {
      const n = [...o];
      [n[i], n[i + d]] = [n[i + d], n[i]];
      return n;
    });

  function start() {
    document.documentElement.requestFullscreen?.().catch(() => {}); // requiere el clic del usuario
    navigate(path);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Rotar dashboards en modo kiosco"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" icon={MonitorPlay} disabled={!ids.length} onClick={start}>
            Iniciar
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted">
        Pantalla completa sin menús; cambia de dashboard automáticamente. En la pantalla: ← / → para cambiar, espacio para
        pausar, Esc para salir.
      </p>
      <ul className="mb-4 flex flex-col gap-1">
        {order.map((id, i) => (
          <li key={id} className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5">
            <input
              type="checkbox"
              className="size-4 accent-[var(--accent)]"
              checked={chosen.has(id)}
              aria-label={`Incluir ${byId.get(id)!.name}`}
              onChange={(e) =>
                setChosen((c) => {
                  const n = new Set(c);
                  if (e.target.checked) n.add(id);
                  else n.delete(id);
                  return n;
                })
              }
            />
            <span className={cx("min-w-0 flex-1 truncate text-sm", !chosen.has(id) && "text-muted")}>{byId.get(id)!.name}</span>
            <Button variant="ghost" icon={ArrowUp} aria-label="Subir" disabled={i === 0} onClick={() => move(i, -1)} />
            <Button variant="ghost" icon={ArrowDown} aria-label="Bajar" disabled={i === order.length - 1} onClick={() => move(i, 1)} />
          </li>
        ))}
      </ul>
      <Field label="Cambiar cada">
        <select className={inputCls} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
          {ROTATION_SECONDS.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </Field>
      {ids.length > 0 && (
        <p className="mt-4 text-xs text-muted">
          Para dejarlo fijo en una pantalla, guarda esta dirección como favorito:{" "}
          <code className="break-all text-fg">{`${location.origin}/#${path}`}</code>
        </p>
      )}
    </Modal>
  );
}
