import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactGridLayout, { useContainerWidth, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Check,
  Download,
  LayoutDashboard,
  MessageSquarePlus,
  MonitorPlay,
  MoreVertical,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  SlidersHorizontal,
  Trash2,
  X,
  ZoomOut,
} from "lucide-react";
import {
  api,
  emptySpec,
  newId,
  type AlertRuleInput,
  type Annotation,
  type Dashboard,
  type Panel,
  type Refresh,
  type TimeRange,
  type Variable,
} from "../lib/api";
import { navigate, toast, useLiveContext } from "../lib/hooks";
import { rangeLabel, REFRESH_OPTIONS, refreshMs, resolveRange, toLocalInput } from "../lib/time";
import { applyVars, VAR_NAME, variableOptions } from "../lib/variables";
import { PanelCard, PanelData } from "../components/Panel";
import { PanelEditor } from "../components/PanelEditor";
import { TimeRangePicker } from "../components/TimeRangePicker";
import { Button, cx, Dropdown, EmptyState, Field, inputCls, MenuItem, Modal, Spinner } from "../components/ui";
import { AlertRuleModal, alertsQuery } from "./Alerts";

const COLS = 24;
const ROW_H = 30;
const MARGIN = 12;

/** Controles de la rotación de dashboards en modo kiosco (ver KioskRotation). */
type Rotation = {
  index: number;
  total: number;
  remaining: number;
  seconds: number;
  paused: boolean;
  onPrev: () => void;
  onNext: () => void;
  onTogglePause: () => void;
  onExit: () => void;
};

export function DashboardPage({ id, kiosk = false, rotation }: { id: string; kiosk?: boolean; rotation?: Rotation }) {
  const q = useQuery({ queryKey: ["dashboard", id], queryFn: () => api.dashboard(id), staleTime: Infinity });
  if (q.isPending)
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    );
  if (q.isError)
    return (
      <div className="p-8">
        <EmptyState icon={LayoutDashboard} title="No se pudo abrir el dashboard" action={<Button onClick={() => navigate("/")}>Volver</Button>}>
          {q.error.message}
        </EmptyState>
      </div>
    );
  return <DashboardView key={id} dash={q.data} kiosk={kiosk} rotation={rotation} />;
}

type AnnotationEdit = { id: string | null; time: number; time_end: number | null; text: string; color: string; global: boolean };

function DashboardView({ dash, kiosk, rotation }: { dash: Dashboard; kiosk: boolean; rotation?: Rotation }) {
  const qc = useQueryClient();
  const live = useLiveContext();
  const spec = { ...emptySpec(), ...dash.spec };

  const [saved, setSaved] = useState({ name: dash.name, panels: spec.panels, variables: spec.variables ?? [] });
  const [name, setName] = useState(dash.name);
  const [panels, setPanels] = useState<Panel[]>(spec.panels);
  const [variables, setVariables] = useState<Variable[]>(spec.variables ?? []);
  const [time, setTime] = useState<TimeRange>(spec.time);
  const [refresh, setRefresh] = useState<Refresh>(spec.refresh);
  const [editing, setEditing] = useState(spec.panels.length === 0 && !kiosk);
  const [editor, setEditor] = useState<{ panel: Panel; isNew: boolean } | null>(null);
  const [viewing, setViewing] = useState<Panel | null>(null);
  const [varsOpen, setVarsOpen] = useState(false);
  const [newAlert, setNewAlert] = useState<AlertRuleInput | null>(null);
  const [annotation, setAnnotation] = useState<AnnotationEdit | null>(null);
  const { width, containerRef, mounted } = useContainerWidth();

  const devices = useQuery({ queryKey: ["devices"], queryFn: api.devices });
  const alerts = useQuery(alertsQuery);

  // Valores actuales de las variables (si el guardado ya no existe, el primero disponible).
  const varValues = useMemo(() => {
    const out: Record<string, string> = {};
    for (const v of variables) {
      const opts = variableOptions(v, devices.data ?? []);
      out[v.name] = v.current && (opts.includes(v.current) || !opts.length) ? v.current : (opts[0] ?? "");
    }
    return out;
  }, [variables, devices.data]);
  const resolved = useMemo(() => panels.map((p) => applyVars(p, varValues)), [panels, varValues]);

  // Anotaciones del rango visible (manuales + eventos de alertas).
  const { start: rangeStart, end: rangeEnd } = resolveRange(time);
  const annotations = useQuery({
    queryKey: ["annotations", dash.id, time.from, time.to],
    queryFn: () => {
      const { start, end } = resolveRange(time);
      return api.annotations(start, end, dash.id);
    },
    refetchInterval: refreshMs(refresh) || (refresh === "live" ? 30_000 : false),
  });

  const dirty =
    name !== saved.name ||
    JSON.stringify(panels) !== JSON.stringify(saved.panels) ||
    JSON.stringify(variables.map(({ current, ...v }) => v)) !== JSON.stringify(saved.variables.map(({ current, ...v }) => v));

  const save = useMutation({
    mutationFn: () => {
      const vars = variables.map((v) => ({ ...v, current: varValues[v.name] }));
      return api.saveDashboard(dash.id, name.trim() || "Sin nombre", { panels, time, refresh, variables: vars });
    },
    onSuccess: () => {
      setSaved({ name, panels, variables });
      qc.invalidateQueries({ queryKey: ["dashboards"] });
      toast("Dashboard guardado");
    },
    onError: (e) => toast(`No se pudo guardar: ${e.message}`, "error"),
  });

  const remove = useMutation({
    mutationFn: () => api.deleteDashboard(dash.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboards"] });
      toast("Dashboard eliminado");
      navigate("/");
    },
    onError: (e) => toast(e.message, "error"),
  });

  // Ctrl+S guarda; Escape sale del modo kiosco; avisar antes de salir con cambios sin guardar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (dirty && !save.isPending) save.mutate();
      }
      if (e.key === "Escape" && kiosk && !document.querySelector("dialog[open]")) exitKiosk();
    };
    const onUnload = (e: BeforeUnloadEvent) => dirty && e.preventDefault();
    addEventListener("keydown", onKey);
    addEventListener("beforeunload", onUnload);
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("beforeunload", onUnload);
    };
  });

  // Si se sale de pantalla completa (Esc del navegador), salir también del modo kiosco.
  useEffect(() => {
    if (!kiosk) return;
    const h = () => !document.fullscreenElement && exitKiosk();
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  });

  function enterKiosk() {
    setEditing(false);
    navigate(`/d/${dash.id}/kiosk`);
    document.documentElement.requestFullscreen?.().catch(() => {}); // sin permiso: kiosco sin pantalla completa
  }
  function exitKiosk() {
    if (rotation) return rotation.onExit();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    navigate(`/d/${dash.id}`);
  }

  const bottom = () => Math.max(0, ...panels.map((p) => p.y + p.h));

  function addPanel() {
    const d = devices.data?.[0];
    setEditor({
      isNew: true,
      panel: {
        id: newId(),
        type: "timeseries",
        title: d ? `${d.device} · ${d.metrics[0]}` : "Nuevo panel",
        x: 0,
        y: bottom(),
        w: 12,
        h: 8,
        targets: [{ device: d?.device ?? "", metric: d?.metrics[0] ?? "", agg: "avg" }],
        options: { thresholds: [], style: "line", legend: true },
      },
    });
  }

  function applyPanel(p: Panel) {
    setPanels((ps) => (editor?.isNew ? [...ps, p] : ps.map((x) => (x.id === p.id ? p : x))));
    setEditor(null);
  }

  function onLayoutChange(layout: Layout) {
    if (!editing) return;
    setPanels((ps) => {
      let changed = false;
      const next = ps.map((p) => {
        const it = layout.find((l) => l.i === p.id);
        if (!it || (it.x === p.x && it.y === p.y && it.w === p.w && it.h === p.h)) return p;
        changed = true;
        return { ...p, x: it.x, y: it.y, w: it.w, h: it.h };
      });
      return changed ? next : ps;
    });
  }

  const zoom = (start: number, end: number) =>
    setTime({ from: new Date(start).toISOString(), to: new Date(end).toISOString() });

  function zoomOut() {
    const span = rangeEnd.getTime() - rangeStart.getTime();
    const newEnd = rangeEnd.getTime() + span / 2;
    setTime({
      from: new Date(rangeStart.getTime() - span / 2).toISOString(),
      to: newEnd >= Date.now() ? "now" : new Date(newEnd).toISOString(),
    });
  }

  function exportJson() {
    const a = document.createElement("a");
    const body = { name, spec: { panels, time, refresh, variables } };
    a.href = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: "application/json" }));
    a.download = `${name || "dashboard"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const firingFor = (p: Panel) =>
    (alerts.data?.rules ?? []).filter(
      // Métrica vacía (alerta "sin datos" de todo el dispositivo): cualquier panel de ese dispositivo.
      (r) => r.enabled && r.state === "firing" && p.targets.some((t) => t.device === r.device && (!r.metric || t.metric === r.metric)),
    );

  const newAnnotation = (t: number) => setAnnotation({ id: null, time: t, time_end: null, text: "", color: "#b877d9", global: false });
  const openAnnotation = (a: Annotation) => {
    if (a.kind === "alert") return toast(a.text, a.text.startsWith("Alerta disparada") ? "error" : "ok");
    setAnnotation({
      id: a.id,
      time: Date.parse(a.time),
      time_end: a.time_end ? Date.parse(a.time_end) : null,
      text: a.text,
      color: a.color,
      global: a.dashboard_id === null,
    });
  };

  const card = (p: Panel, i: number) => (
    <PanelCard
      panel={resolved[i]}
      range={time}
      refresh={refresh}
      editing={editing}
      firing={firingFor(resolved[i])}
      annotations={annotations.data}
      onZoom={zoom}
      onView={() => setViewing(resolved[i])}
      onEdit={() => setEditor({ panel: p, isNew: false })}
      onDuplicate={() => setPanels((ps) => [...ps, { ...structuredClone(p), id: newId(), y: bottom() }])}
      onRemove={() => confirm(`¿Eliminar el panel "${p.title || "Sin título"}"?`) && setPanels((ps) => ps.filter((x) => x.id !== p.id))}
      onCreateAlert={() => {
        const t = resolved[i].targets.find((t) => t.device && t.metric);
        const th = [...p.options.thresholds].sort((a, b) => b.value - a.value)[0];
        setNewAlert({
          name: `${resolved[i].title || t?.metric || "Alerta"} alta`,
          device: t?.device ?? "",
          metric: t?.metric ?? "",
          op: ">",
          threshold: th?.value ?? 0,
          for_s: 60,
          enabled: true,
          notify: true,
          on_fire: [],
          on_resolve: [],
        });
      }}
      onAnnotate={newAnnotation}
      onAnnotationClick={openAnnotation}
    />
  );

  const narrow = mounted && width < 768;
  const order = panels.map((p, i) => ({ p, i })).sort((a, b) => a.p.y - b.p.y || a.p.x - b.p.x);

  return (
    <div className={cx("flex flex-col", kiosk ? "h-dvh overflow-auto" : "min-h-dvh")}>
      {kiosk ? (
        <KioskBar name={name} time={time} onExit={exitKiosk} rotation={rotation} />
      ) : (
        <div className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur">
          {/* Barra superior */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 md:px-6">
            <Button variant="ghost" icon={ArrowLeft} aria-label="Volver a dashboards" onClick={() => navigate("/")} />
            {editing ? (
              <input
                className={cx(inputCls, "h-8 w-56 font-semibold")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-label="Nombre del dashboard"
              />
            ) : (
              <h1 className="min-w-0 truncate text-lg font-semibold">{name}</h1>
            )}
            {dirty && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-500">Sin guardar</span>}

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <TimeRangePicker value={time} onChange={setTime} />
              <Button icon={ZoomOut} aria-label="Ampliar rango de tiempo" title="Ampliar rango" onClick={zoomOut} className="hidden sm:inline-flex" />
              <div className="flex items-center">
                <Button
                  icon={RefreshCw}
                  aria-label="Actualizar ahora"
                  title="Actualizar ahora"
                  className="rounded-r-none"
                  onClick={() => {
                    qc.invalidateQueries({ queryKey: ["query"] });
                    qc.invalidateQueries({ queryKey: ["annotations"] });
                  }}
                />
                <select
                  className={cx(inputCls, "w-auto rounded-l-none border-l-0 pr-7")}
                  value={refresh}
                  onChange={(e) => setRefresh(e.target.value as Refresh)}
                  aria-label="Frecuencia de actualización"
                >
                  {REFRESH_OPTIONS.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              {refresh === "live" && (
                <span className="flex items-center gap-1.5 text-xs text-muted" title={live ? "Conectado en vivo" : "Reconectando…"}>
                  <span className={cx("size-2 rounded-full", live ? "animate-pulse bg-ok" : "bg-danger")} />
                  {live ? "En vivo" : "Sin conexión"}
                </span>
              )}

              {!narrow && (
                <>
                  <Button icon={MonitorPlay} aria-label="Modo kiosco" title="Modo kiosco (pantalla completa)" onClick={enterKiosk} />
                  <div className="mx-1 h-6 w-px bg-border" />
                  {editing && (
                    <Button icon={Plus} onClick={addPanel}>
                      Panel
                    </Button>
                  )}
                  <Button variant={editing ? "primary" : "secondary"} icon={editing ? Check : Pencil} onClick={() => setEditing(!editing)}>
                    {editing ? "Listo" : "Editar"}
                  </Button>
                </>
              )}
              {(!narrow || dirty) && (
                <Button
                  variant={dirty ? "primary" : "secondary"}
                  icon={Save}
                  disabled={!dirty}
                  loading={save.isPending}
                  onClick={() => save.mutate()}
                  title="Guardar (Ctrl+S)"
                >
                  Guardar
                </Button>
              )}
              <Dropdown trigger={(p) => <Button {...p} variant="ghost" icon={MoreVertical} aria-label="Más opciones" />}>
                {(close) => (
                  <>
                    <MenuItem icon={SlidersHorizontal} onClick={() => (close(), setVarsOpen(true))}>Variables</MenuItem>
                    <MenuItem icon={MessageSquarePlus} onClick={() => (close(), newAnnotation(Date.now()))}>Agregar anotación</MenuItem>
                    <MenuItem icon={MonitorPlay} onClick={() => (close(), enterKiosk())}>Modo kiosco</MenuItem>
                    <MenuItem icon={Download} onClick={() => (close(), exportJson())}>Exportar JSON</MenuItem>
                    <div className="my-1 h-px bg-border" />
                    <MenuItem
                      icon={Trash2}
                      danger
                      onClick={() => (close(), confirm(`¿Eliminar el dashboard "${name}"?`) && remove.mutate())}
                    >
                      Eliminar dashboard
                    </MenuItem>
                  </>
                )}
              </Dropdown>
            </div>
          </div>

          {/* Variables */}
          {variables.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-t border-border/60 px-4 py-2 md:px-6">
              {variables.map((v) => {
                const opts = variableOptions(v, devices.data ?? []);
                return (
                  <label key={v.name} className="flex items-center text-sm">
                    <span className="rounded-l-md border border-r-0 border-border bg-surface px-2.5 py-1 text-muted">{v.name}</span>
                    <select
                      className={cx(inputCls, "w-auto min-w-28 rounded-l-none pr-7")}
                      value={varValues[v.name]}
                      onChange={(e) => setVariables((vs) => vs.map((x) => (x.name === v.name ? { ...x, current: e.target.value } : x)))}
                    >
                      {opts.length === 0 && <option value="">(sin opciones)</option>}
                      {opts.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  </label>
                );
              })}
              {editing && (
                <Button variant="ghost" icon={Pencil} onClick={() => setVarsOpen(true)}>
                  Editar variables
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Paneles */}
      <div ref={containerRef} className="flex-1 px-2 py-3 md:px-4">
        {panels.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={LayoutDashboard}
              title="Este dashboard está vacío"
              action={
                !kiosk && (
                  <Button variant="primary" icon={Plus} onClick={addPanel}>
                    Agregar panel
                  </Button>
                )
              }
            >
              Agrega paneles para ver tus datos. En modo edición puedes moverlos arrastrando su título y cambiar su
              tamaño desde la esquina.
            </EmptyState>
          </div>
        ) : narrow ? (
          <div className="flex flex-col gap-3 px-2">
            {order.map(({ p, i }) => (
              <div key={p.id} style={{ height: Math.max(220, p.h * ROW_H + (p.h - 1) * MARGIN) }}>
                {card(p, i)}
              </div>
            ))}
          </div>
        ) : (
          mounted && (
            <ReactGridLayout
              width={width}
              layout={panels.map((p) => ({ i: p.id, x: p.x, y: p.y, w: p.w, h: p.h, minW: 3, minH: 3 }))}
              gridConfig={{ cols: COLS, rowHeight: ROW_H, margin: [MARGIN, MARGIN] }}
              dragConfig={{ enabled: editing, handle: ".panel-drag", cancel: "button" }}
              resizeConfig={{ enabled: editing }}
              onLayoutChange={onLayoutChange}
            >
              {panels.map((p, i) => (
                <div key={p.id}>{card(p, i)}</div>
              ))}
            </ReactGridLayout>
          )
        )}
      </div>

      {editor && (
        <PanelEditor
          panel={editor.panel}
          range={time}
          refresh={refresh}
          vars={varValues}
          onApply={applyPanel}
          onClose={() => setEditor(null)}
        />
      )}

      <Modal open={!!viewing} onClose={() => setViewing(null)} size="xl" title={viewing?.title || "Panel"}>
        {viewing && (
          <div className="h-full min-h-96">
            <PanelData
              panel={viewing}
              range={time}
              refresh={refresh}
              annotations={annotations.data}
              onZoom={zoom}
              onAnnotate={newAnnotation}
              onAnnotationClick={openAnnotation}
            />
          </div>
        )}
      </Modal>

      {varsOpen && <VariablesModal variables={variables} onApply={(v) => (setVariables(v), setVarsOpen(false))} onClose={() => setVarsOpen(false)} />}
      {newAlert && <AlertRuleModal initial={newAlert} onClose={() => setNewAlert(null)} />}
      {annotation && <AnnotationModal dashboardId={dash.id} initial={annotation} onClose={() => setAnnotation(null)} />}
    </div>
  );
}

// ---------- Modo kiosco: barra mínima que aparece al mover el mouse ----------

function KioskBar({ name, time, onExit, rotation: r }: { name: string; time: TimeRange; onExit: () => void; rotation?: Rotation }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    let t = window.setTimeout(() => setVisible(false), 3000);
    const show = () => {
      setVisible(true);
      clearTimeout(t);
      t = window.setTimeout(() => setVisible(false), 3000);
    };
    addEventListener("mousemove", show);
    return () => {
      clearTimeout(t);
      removeEventListener("mousemove", show);
    };
  }, []);
  return (
    <>
      {/* Rotación: barra fina arriba que se va llenando hasta el siguiente dashboard. */}
      {r && (
        <div className="fixed inset-x-0 top-0 z-30 h-0.5 bg-transparent">
          <div
            className={cx("h-full bg-accent transition-[width] duration-1000 ease-linear", r.paused && "bg-amber-500")}
            style={{ width: `${((r.seconds - r.remaining) / r.seconds) * 100}%` }}
          />
        </div>
      )}
      <div
        className={cx(
          "fixed top-3 right-3 z-30 flex items-center gap-3 rounded-lg border border-border bg-surface/95 py-1.5 pr-1.5 pl-4 shadow-xl backdrop-blur transition-opacity",
          visible ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <span className="font-semibold">{name}</span>
        <span className="text-sm text-muted">{rangeLabel(time)}</span>
        {r && (
          <div className="flex items-center gap-1 border-l border-border pl-3">
            <span className="mr-1 text-sm text-muted tabular-nums">
              {r.index + 1}/{r.total} · {r.paused ? "en pausa" : `${r.remaining} s`}
            </span>
            <Button variant="ghost" icon={ChevronLeft} aria-label="Dashboard anterior" title="Anterior (←)" onClick={r.onPrev} />
            <Button variant="ghost" icon={r.paused ? Play : Pause} aria-label={r.paused ? "Reanudar" : "Pausar"} title="Pausar (espacio)" onClick={r.onTogglePause} />
            <Button variant="ghost" icon={ChevronRight} aria-label="Dashboard siguiente" title="Siguiente (→)" onClick={r.onNext} />
          </div>
        )}
        <Button icon={X} onClick={onExit} title="Salir (Esc)">
          Salir
        </Button>
      </div>
    </>
  );
}

/**
 * Rotación de dashboards en modo kiosco: #/kiosk/<segundos>/<id1,id2,...>. Cambia cada N segundos;
 * ← / → para ir al anterior o al siguiente, espacio para pausar, Esc para salir.
 */
export function KioskRotation({ seconds, ids }: { seconds: number; ids: string[] }) {
  const qc = useQueryClient();
  const [index, setIndex] = useState(0);
  const [remaining, setRemaining] = useState(seconds);
  const [paused, setPaused] = useState(false);
  const go = (d: number) => {
    setIndex((i) => (i + d + ids.length) % ids.length);
    setRemaining(seconds);
  };

  useEffect(() => {
    if (paused || ids.length < 2) return;
    const t = window.setInterval(() => setRemaining((r) => r - 1), 1000);
    return () => clearInterval(t);
  }, [paused, ids.length]);
  useEffect(() => {
    if (remaining <= 0) go(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);
  // Precarga el siguiente para que el cambio sea instantáneo.
  useEffect(() => {
    const next = ids[(index + 1) % ids.length];
    qc.prefetchQuery({ queryKey: ["dashboard", next], queryFn: () => api.dashboard(next), staleTime: Infinity });
  }, [index, ids, qc]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === " ") (e.preventDefault(), setPaused((p) => !p));
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  const exit = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    navigate("/");
  };
  if (!ids.length) return null;
  return (
    <DashboardPage
      id={ids[index]}
      kiosk
      rotation={{
        index,
        total: ids.length,
        remaining,
        seconds,
        paused: paused || ids.length < 2,
        onPrev: () => go(-1),
        onNext: () => go(1),
        onTogglePause: () => setPaused((p) => !p),
        onExit: exit,
      }}
    />
  );
}

// ---------- Variables ----------

function VariablesModal({ variables, onApply, onClose }: { variables: Variable[]; onApply: (v: Variable[]) => void; onClose: () => void }) {
  const [vars, setVars] = useState(variables);
  const upd = (i: number, p: Partial<Variable>) => setVars((vs) => vs.map((v, j) => (j === i ? { ...v, ...p } : v)));
  const names = vars.map((v) => v.name);
  const invalid = vars.some((v, i) => !VAR_NAME.test(v.name) || names.indexOf(v.name) !== i);

  return (
    <Modal
      open
      onClose={onClose}
      title="Variables del dashboard"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={invalid} onClick={() => onApply(vars)}>
            Aplicar
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted">
        Cada variable es un selector arriba del dashboard. Úsala en un panel escribiendo <code className="text-accent">$nombre</code> en
        el dispositivo, la métrica, el nombre de la serie o el título. Así un mismo dashboard sirve para todos tus sensores.
      </p>
      <div className="flex flex-col gap-3">
        {vars.map((v, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 rounded-lg border border-border bg-surface-2/40 p-3">
            <Field label="Nombre">
              <input
                className={cx(inputCls, !VAR_NAME.test(v.name) && "border-danger")}
                value={v.name}
                onChange={(e) => upd(i, { name: e.target.value })}
                placeholder="dispositivo"
              />
            </Field>
            <Field label="Opciones">
              <select className={inputCls} value={v.type} onChange={(e) => upd(i, { type: e.target.value as Variable["type"] })}>
                <option value="device">Dispositivos</option>
                <option value="metric">Métricas</option>
                <option value="custom">Lista propia</option>
              </select>
            </Field>
            <Button variant="ghost" icon={Trash2} aria-label="Quitar variable" onClick={() => setVars((vs) => vs.filter((_, j) => j !== i))} />
            {v.type === "custom" && (
              <Field label="Valores separados por coma" className="col-span-3">
                <input className={inputCls} value={v.values ?? ""} placeholder="sala, cocina, bodega" onChange={(e) => upd(i, { values: e.target.value })} />
              </Field>
            )}
          </div>
        ))}
        {invalid && <p className="text-xs text-danger">Los nombres deben ser únicos, empezar con letra y usar solo letras, números y _.</p>}
        <Button
          icon={Plus}
          className="self-start"
          onClick={() => setVars((vs) => [...vs, { name: vs.some((v) => v.name === "dispositivo") ? `var${vs.length + 1}` : "dispositivo", type: "device" }])}
        >
          Agregar variable
        </Button>
      </div>
    </Modal>
  );
}

// ---------- Anotaciones ----------

function AnnotationModal({ dashboardId, initial, onClose }: { dashboardId: string; initial: AnnotationEdit; onClose: () => void }) {
  const qc = useQueryClient();
  const [a, setA] = useState(initial);
  const set = (p: Partial<AnnotationEdit>) => setA((x) => ({ ...x, ...p }));
  const done = (msg: string) => {
    qc.invalidateQueries({ queryKey: ["annotations"] });
    toast(msg);
    onClose();
  };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        dashboard_id: a.global ? null : dashboardId,
        time: new Date(a.time).toISOString(),
        time_end: a.time_end ? new Date(a.time_end).toISOString() : null,
        text: a.text.trim(),
        color: a.color,
      };
      return a.id ? api.updateAnnotation(a.id, body) : api.createAnnotation(body);
    },
    onSuccess: () => done(a.id ? "Anotación actualizada" : "Anotación agregada"),
    onError: (e) => toast(e.message, "error"),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteAnnotation(a.id!),
    onSuccess: () => done("Anotación eliminada"),
    onError: (e) => toast(e.message, "error"),
  });

  const valid = a.text.trim() && (!a.time_end || a.time_end > a.time);

  return (
    <Modal
      open
      onClose={onClose}
      title={a.id ? "Editar anotación" : "Nueva anotación"}
      footer={
        <>
          {a.id && (
            <Button variant="danger" icon={Trash2} className="mr-auto" loading={remove.isPending} onClick={() => remove.mutate()}>
              Eliminar
            </Button>
          )}
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Texto">
          <textarea
            autoFocus
            rows={3}
            className={cx(inputCls, "h-auto py-2")}
            value={a.text}
            placeholder="Se cambió el sensor, mantenimiento, apertura de puerta…"
            onChange={(e) => set({ text: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Desde">
            <input
              type="datetime-local"
              step="1"
              className={inputCls}
              value={toLocalInput(new Date(a.time))}
              onChange={(e) => e.target.value && set({ time: new Date(e.target.value).getTime() })}
            />
          </Field>
          <Field label="Hasta (opcional, para un período)">
            <input
              type="datetime-local"
              step="1"
              className={inputCls}
              value={a.time_end ? toLocalInput(new Date(a.time_end)) : ""}
              onChange={(e) => set({ time_end: e.target.value ? new Date(e.target.value).getTime() : null })}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="color" className="h-8 w-10 cursor-pointer rounded-md border border-border bg-surface-2 p-1" value={a.color} onChange={(e) => set({ color: e.target.value })} />
            Color
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={a.global} onChange={(e) => set({ global: e.target.checked })} />
            Mostrar en todos los dashboards
          </label>
        </div>
        <p className="text-xs text-muted">Atajo: Ctrl + clic sobre una serie de tiempo crea una anotación en ese instante.</p>
      </div>
    </Modal>
  );
}
