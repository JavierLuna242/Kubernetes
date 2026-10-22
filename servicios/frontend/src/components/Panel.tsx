import { useMemo, useRef, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  BellPlus,
  BellRing,
  Copy,
  Download,
  Gauge,
  Grid3x3,
  Hash,
  LineChart,
  MapIcon,
  Maximize2,
  MoreVertical,
  Pencil,
  Power,
  Table2,
  ToggleRight,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { api, type AlertRule, type Annotation, type Panel, type PanelType, type Refresh, type SeriesResult, type TimeRange } from "../lib/api";
import { exprError, withExpressions } from "../lib/expressions";
import { useLiveReadings } from "../lib/hooks";
import { isRelative, refreshMs, resolveRange } from "../lib/time";
import { Button, cx, Dropdown, MenuItem, Spinner } from "./ui";
import { toSeriesViews, type SeriesView } from "../lib/series";
import { BarViz, GaugeViz, HeatmapViz, StateViz, StatViz, TableViz, TimeSeriesViz } from "./Charts";
import { mapQueries, MapChart, toMapViews } from "./MapChart";
import { DeviceControls } from "./DeviceControls";

export const PANEL_TYPES: Record<PanelType, { label: string; icon: LucideIcon; points: number }> = {
  timeseries: { label: "Serie de tiempo", icon: LineChart, points: 400 },
  stat: { label: "Valor", icon: Hash, points: 120 },
  gauge: { label: "Medidor", icon: Gauge, points: 60 },
  bar: { label: "Barras", icon: BarChart3, points: 60 },
  table: { label: "Tabla", icon: Table2, points: 200 },
  state: { label: "Estado", icon: ToggleRight, points: 400 },
  heatmap: { label: "Mapa de calor", icon: Grid3x3, points: 10 }, // usa intervalos exactos de 1 h
  map: { label: "Mapa", icon: MapIcon, points: 300 },
  control: { label: "Control", icon: Power, points: 30 },
};

export const COMPARE_OPTIONS: [number, string][] = [
  [3_600_000, "hace 1 hora"],
  [86_400_000, "hace 1 día"],
  [604_800_000, "hace 1 semana"],
  [2_592_000_000, "hace 30 días"],
];

const LIVE_THROTTLE_MS = 2000;
const HOUR_S = 3600;

/** Posiciones de las consultas de datos válidas (no fórmulas; el mapa solo necesita el dispositivo). */
const queryIndexes = (p: Panel) =>
  p.targets.flatMap((t, i) => (t.expr === undefined && t.device && (p.type === "map" || t.metric) ? [i] : []));

/** Pide los datos del panel y dibuja su visualización. Se usa en el dashboard, el editor y la vista ampliada. */
export function PanelData({
  panel,
  range,
  refresh,
  annotations,
  onZoom,
  onSeries,
  onAnnotate,
  onAnnotationClick,
}: {
  panel: Panel;
  range: TimeRange;
  refresh: Refresh;
  annotations?: Annotation[];
  onZoom?: (start: number, end: number) => void;
  onSeries?: (s: SeriesView[]) => void;
  onAnnotate?: (time: number) => void;
  onAnnotationClick?: (a: Annotation) => void;
}) {
  const o = panel.options;
  const queryIdx = queryIndexes(panel);
  const targets = queryIdx.map((i) => panel.targets[i]);
  // Fórmulas (A * B, sensacion_termica(A, B)…) y consultas ocultas; no aplican al mapa ni al control.
  const usesExpr = panel.type !== "map" && panel.type !== "control";
  const shown = (results: SeriesResult[]) => (usesExpr ? withExpressions(panel.targets, queryIdx, results) : { results, targets });
  const queries = panel.type === "map" ? mapQueries(targets, o) : targets;
  const points = PANEL_TYPES[panel.type].points;
  const bucketS = panel.type === "heatmap" ? HOUR_S : undefined;

  const q = useQuery({
    queryKey: ["query", queries.map((t) => [t.device, t.metric, t.agg]), range.from, range.to, points, bucketS],
    queryFn: async () => {
      const { start, end } = resolveRange(range);
      return { start: +start, end: +end, results: await api.query(start, end, points, queries, bucketS) };
    },
    enabled: queries.length > 0,
    refetchInterval: refreshMs(refresh),
    placeholderData: keepPreviousData,
  });

  // En vivo: cuando llega una lectura de alguna serie del panel, se vuelve a consultar (máx. 1 vez cada 2 s).
  const last = useRef(0);
  const pending = useRef<number | undefined>(undefined);
  useLiveReadings(
    (rows) => {
      if (!rows.some((r) => queries.some((t) => t.device === r.device && t.metric === r.metric))) return;
      const wait = last.current + LIVE_THROTTLE_MS - Date.now();
      if (wait <= 0) {
        last.current = Date.now();
        q.refetch();
      } else if (pending.current === undefined) {
        pending.current = window.setTimeout(() => {
          pending.current = undefined;
          last.current = Date.now();
          q.refetch();
        }, wait);
      }
    },
    refresh === "live" && isRelative(range) && queries.length > 0,
  );

  const series = useMemo(() => {
    if (!q.data || panel.type === "map") return [];
    const view = shown(q.data.results);
    const s = toSeriesViews(view.results, view.targets, bucketS ? bucketS * 1000 : (q.data.end - q.data.start) / points);
    onSeries?.(s);
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, JSON.stringify(panel.targets), panel.type]);

  // Comparar períodos: el mismo rango desplazado atrás, dibujado sobre el actual.
  const compare = panel.type === "timeseries" ? o.compare : undefined;
  const past = useQuery({
    queryKey: ["query", queries.map((t) => [t.device, t.metric, t.agg]), range.from, range.to, points, "compare", compare, JSON.stringify(panel.targets)],
    queryFn: async () => {
      const { start, end } = resolveRange(range);
      const results = await api.query(new Date(+start - compare!), new Date(+end - compare!), points, queries);
      const shifted = results.map((r) => ({
        ...r,
        points: r.points.map(([t, v]) => [new Date(Date.parse(t) + compare!).toISOString(), v] as [string, number | null]),
      }));
      const label = COMPARE_OPTIONS.find(([ms]) => ms === compare)?.[1] ?? "antes";
      const view = shown(shifted);
      return toSeriesViews(view.results, view.targets, (+end - +start) / points).map((s) => ({ ...s, name: `${s.name} (${label})` }));
    },
    enabled: !!compare && queries.length > 0,
    refetchInterval: refreshMs(refresh) || (refresh === "live" ? 60_000 : false),
    placeholderData: keepPreviousData,
  });

  // Análisis (servicio "analysis"): anomalías y pronóstico de cada serie, solo en series de tiempo.
  const wantAnalysis = panel.type === "timeseries" && !!(o.anomalies || o.forecast) && series.length > 0;
  const analysis = useQuery({
    queryKey: ["analysis", q.dataUpdatedAt, JSON.stringify(panel.targets), o.anomalies, o.forecast, o.sensitivity, o.horizon],
    queryFn: () =>
      api.analyze({
        series: series.map((s) => ({ points: s.points })),
        anomalies: !!o.anomalies,
        forecast: !!o.forecast,
        sensitivity: o.sensitivity ?? 3.5,
        horizon_ms: (q.data!.end - q.data!.start) * (o.horizon ?? 0.25),
      }),
    enabled: wantAnalysis,
    placeholderData: keepPreviousData,
  });

  if (!targets.length)
    return <Centered>{panel.type === "map" ? "Agrega una consulta: elige un dispositivo." : "Agrega una consulta: elige un dispositivo y una métrica."}</Centered>;
  if (q.isPending) return <Centered><Spinner /></Centered>;
  if (q.isError) return <Centered className="text-danger">Error: {q.error.message}</Centered>;

  const { start, end, results } = q.data;
  if (panel.type === "map") {
    const items = toMapViews(results, targets);
    if (items.every((i) => !i.last))
      return <Centered>Sin posiciones en este rango. El dispositivo debe enviar "{o.latMetric || "lat"}" y "{o.lonMetric || "lon"}".</Centered>;
    return <MapChart items={items} options={o} />;
  }
  // El control se muestra aunque el dispositivo aún no haya reportado estado.
  if (panel.type === "control") return <DeviceControls targets={targets} series={series} options={o} />;
  if (series.every((s) => s.last === null)) return <Centered>Sin datos en este rango de tiempo</Centered>;

  switch (panel.type) {
    case "timeseries":
      return (
        <div className="relative h-full">
          <TimeSeriesViz
            series={series}
            options={o}
            start={start}
            end={end}
            analysis={wantAnalysis ? analysis.data : undefined}
            compare={compare ? past.data : undefined}
            annotations={annotations}
            onZoom={onZoom}
            onAnnotate={onAnnotate}
            onAnnotationClick={onAnnotationClick}
          />
          {wantAnalysis && analysis.isError && (
            <p className="absolute top-0 right-2 text-xs text-danger" title={analysis.error.message}>
              Análisis no disponible
            </p>
          )}
        </div>
      );
    case "stat":
      return <StatViz series={series} options={o} />;
    case "gauge":
      return <GaugeViz series={series} options={o} />;
    case "bar":
      return <BarViz series={series} options={o} />;
    case "table":
      return <TableViz series={series} options={o} />;
    case "state":
      return <StateViz series={series} options={o} start={start} end={end} />;
    case "heatmap":
      return <HeatmapViz series={series} options={o} start={start} end={end} />;
  }
}

function Centered({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("flex h-full items-center justify-center p-2 text-center text-sm text-muted", className)}>
      {children}
    </div>
  );
}

export function exportCsv(title: string, series: SeriesView[]) {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = ["serie,tiempo,valor"];
  for (const s of series)
    for (const [t, v] of s.points) if (v != null) lines.push(`${esc(s.name)},${new Date(t).toISOString()},${v}`);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  a.download = `${title || "panel"}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Tarjeta del panel dentro del dashboard. */
export function PanelCard({
  panel,
  range,
  refresh,
  editing,
  firing = [],
  annotations,
  onZoom,
  onView,
  onEdit,
  onDuplicate,
  onRemove,
  onCreateAlert,
  onAnnotate,
  onAnnotationClick,
}: {
  panel: Panel;
  range: TimeRange;
  refresh: Refresh;
  editing: boolean;
  firing?: AlertRule[];
  annotations?: Annotation[];
  onZoom: (start: number, end: number) => void;
  onView: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onCreateAlert: () => void;
  onAnnotate: (time: number) => void;
  onAnnotationClick: (a: Annotation) => void;
}) {
  const series = useRef<SeriesView[]>([]);
  const missing = panel.targets.some((t, i) =>
    t.expr !== undefined ? !!exprError(panel.targets, i) : !t.device || (panel.type !== "map" && !t.metric),
  );

  return (
    <section
      className={cx(
        "group flex h-full flex-col overflow-hidden rounded-lg border bg-surface",
        firing.length ? "border-danger shadow-[0_0_0_1px_var(--danger)]" : "border-border",
      )}
    >
      <header
        className={cx(
          "flex h-9 shrink-0 items-center gap-2 pr-1 pl-3",
          firing.length > 0 && "bg-danger/10",
          editing && "panel-drag cursor-move hover:bg-surface-2/60",
        )}
        onDoubleClick={editing ? onEdit : onView}
      >
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium" title={panel.title}>
          {panel.title || "Sin título"}
        </h3>
        {firing.length > 0 && (
          <span
            className="flex items-center gap-1 rounded bg-danger px-1.5 py-0.5 text-xs font-semibold text-white"
            title={`Alertas disparadas: ${firing.map((r) => r.name).join(", ")}`}
          >
            <BellRing className="size-3.5" />
            {firing.length}
          </span>
        )}
        {missing && <AlertTriangle className="size-4 text-amber-500" aria-label="Consulta incompleta" />}
        <Dropdown
          trigger={(p) => (
            <Button
              {...p}
              variant="ghost"
              icon={MoreVertical}
              aria-label="Opciones del panel"
              className="opacity-60 group-hover:opacity-100 focus:opacity-100"
            />
          )}
        >
          {(close) => (
            <>
              <MenuItem icon={Maximize2} onClick={() => (close(), onView())}>Ver ampliado</MenuItem>
              <MenuItem icon={Pencil} onClick={() => (close(), onEdit())}>Editar</MenuItem>
              <MenuItem icon={Copy} onClick={() => (close(), onDuplicate())}>Duplicar</MenuItem>
              <MenuItem icon={BellPlus} onClick={() => (close(), onCreateAlert())}>Crear alerta</MenuItem>
              <MenuItem icon={Download} onClick={() => (close(), exportCsv(panel.title, series.current))}>Exportar CSV</MenuItem>
              <div className="my-1 h-px bg-border" />
              <MenuItem icon={Trash2} danger onClick={() => (close(), onRemove())}>Eliminar</MenuItem>
            </>
          )}
        </Dropdown>
      </header>
      <div className="min-h-0 flex-1 px-3 pb-3">
        <PanelData
          panel={panel}
          range={range}
          refresh={refresh}
          annotations={annotations}
          onZoom={onZoom}
          onSeries={(s) => (series.current = s)}
          onAnnotate={onAnnotate}
          onAnnotationClick={onAnnotationClick}
        />
      </div>
    </section>
  );
}
