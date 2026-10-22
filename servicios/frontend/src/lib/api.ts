// Tipos y llamadas al back. Toda la API vive bajo /api (nginx la pasa al back).

export type Agg = "avg" | "min" | "max" | "sum" | "count" | "last";
/** Una fila de consulta del panel. Con `expr` es una métrica calculada (fórmula sobre las demás: A, B, C…). */
export type Target = { device: string; metric: string; agg: Agg; alias?: string; color?: string; expr?: string; hidden?: boolean };
export type Threshold = { value: number; color: string };
export type PanelType = "timeseries" | "stat" | "gauge" | "bar" | "table" | "state" | "heatmap" | "map" | "control";
/** Valor -> texto y color (panel de estado: 0 = Apagado, 1 = Encendido...). */
export type ValueMapping = { value: number; text: string; color: string };
/** Panel de control: envía {comando: valor} a iot/<dispositivo>/cmd. Comando por defecto = la métrica. */
export type ControlOptions = {
  kind: "switch" | "button" | "slider";
  command?: string;
  value?: number; // botón: valor que envía
  min?: number;
  max?: number;
  step?: number;
};

export type PanelOptions = {
  unit?: string;
  decimals?: number;
  min?: number;
  max?: number;
  baseColor?: string;
  thresholds: Threshold[];
  style?: "line" | "area" | "bars";
  legend?: boolean;
  // Análisis (series de tiempo)
  anomalies?: boolean;
  sensitivity?: number; // desviaciones de ruido para marcar anomalía (2.5 alta, 3.5 media, 5 baja)
  forecast?: boolean;
  horizon?: number; // pronóstico: fracción del rango visible (0.25 = un cuarto)
  compare?: number; // comparar con el mismo rango desplazado N ms atrás (1 día, 1 semana...)
  control?: ControlOptions;
  // Estado
  mappings?: ValueMapping[];
  // Mapa
  latMetric?: string;
  lonMetric?: string;
};

export type Panel = {
  id: string;
  type: PanelType;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  targets: Target[];
  options: PanelOptions;
};

export type TimeRange = { from: string; to: string }; // "now-1h" / "now" o ISO absolutos
export type Refresh = "off" | "live" | "5s" | "10s" | "30s" | "1m" | "5m";
/** Variable de dashboard: un selector arriba; los paneles usan $nombre en dispositivo, métrica o título. */
export type Variable = { name: string; type: "device" | "metric" | "custom"; values?: string; current?: string };
export type DashboardSpec = { panels: Panel[]; time: TimeRange; refresh: Refresh; variables?: Variable[] };
export type Dashboard = { id: string; name: string; spec: DashboardSpec; updated_at: string };
export type DashboardSummary = { id: string; name: string; updated_at: string; panels: number };
/** Ficha editable de un dispositivo registrado. */
export type DeviceInfo = { name: string; type: string; location: string; tags: string[] };
/**
 * Dispositivo (registrado o solo con datos). Gemelo digital: `desired` = estado pedido por la plataforma,
 * `reported` = último valor de cada métrica; `twin` dice si cada propiedad deseada ya está sincronizada.
 */
export type Device = Partial<DeviceInfo> & {
  device: string;
  metrics: string[];
  last_seen: string | null;
  readings: number;
  registered: boolean;
  desired: Record<string, number> | null;
  reported: Record<string, number> | null;
  reported_at: string | null;
  connected: boolean | null;
  connected_at: string | null;
  created_at: string | null;
  twin: Record<string, "sincronizado" | "pendiente">;
};
/** Credencial MQTT de un dispositivo: el token solo se ve al registrarlo o regenerarlo. */
export type DeviceCredentials = { id: string; username: string; token: string };
/** Acción de una regla: enviar un comando a un dispositivo. */
export type RuleAction = { type: "command"; device: string; name: string; value: number };
export type Reading = { time: string; device: string; metric: string; value: number };
export type SeriesResult = { device: string; metric: string; agg: Agg; points: [string, number | null][] };

/** Reporte diario por Telegram: hora local (zona tz) y última fecha enviada. */
export type ReportSettings = { enabled: boolean; hour: number; last: string | null; tz: string; telegram: boolean };

export type AlertOp = ">" | "<" | ">=" | "<=" | "nodata";
export type AlertRuleInput = {
  name: string;
  device: string;
  metric: string;
  op: AlertOp;
  threshold: number;
  for_s: number;
  enabled: boolean;
  /** Motor de reglas: avisar por Telegram y/o ejecutar acciones al dispararse y al resolverse. */
  notify: boolean;
  on_fire: RuleAction[];
  on_resolve: RuleAction[];
};
export type AlertRule = AlertRuleInput & {
  id: string;
  state: "ok" | "pending" | "firing";
  since: string | null;
  last_value: number | null;
};
export type AlertsInfo = { rules: AlertRule[]; telegram: boolean; eval_s: number };
export type AlertEvent = {
  time: string;
  rule_id: string;
  rule_name: string;
  device: string;
  metric: string;
  state: "firing" | "resolved";
  value: number | null;
  op: AlertOp;
  actions: string; // acciones ejecutadas por la regla, separadas por "; "
};

export type AnnotationInput = { dashboard_id: string | null; time: string; time_end: string | null; text: string; color: string };
export type Annotation = AnnotationInput & { id: string | null; kind: "manual" | "alert" };

/** Resultado del análisis por serie: anomalías [ms, valor, puntaje] y pronóstico [ms, estimado, mín, máx]. */
export type AnalysisResult = { anomalies: [number, number, number][]; forecast: [number, number, number, number][] };

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try {
      const j = await r.json();
      // Errores de validación de FastAPI: lista de {msg}; se muestra solo el texto.
      msg = typeof j.detail === "string" ? j.detail : j.detail.map((d: { msg: string }) => d.msg.replace(/^Value error, /, "")).join(". ");
    } catch {
      /* respuesta sin JSON */
    }
    // Sesión vencida en cualquier llamada -> App vuelve a la pantalla de login.
    if (r.status === 401 && url !== "/api/login" && url !== "/api/me") window.dispatchEvent(new Event("unauthorized"));
    throw new HttpError(r.status, msg);
  }
  return r.json();
}

export const api = {
  me: () => req<{ user: string }>("GET", "/api/me"),
  login: (username: string, password: string) => req<{ user: string }>("POST", "/api/login", { username, password }),
  logout: () => req("POST", "/api/logout"),

  config: () => req<{ mqtt_tcp: string; mqtt_wss: string }>("GET", "/api/config"),
  devices: () => req<Device[]>("GET", "/api/devices"),
  deleteDevice: (device: string) => req<{ deleted: number }>("DELETE", `/api/devices/${encodeURIComponent(device)}`),
  registerDevice: (d: DeviceInfo & { id: string }) => req<DeviceCredentials>("POST", "/api/devices", d),
  updateDevice: (id: string, d: DeviceInfo) => req("PUT", `/api/devices/${encodeURIComponent(id)}`, d),
  rotateToken: (id: string) => req<DeviceCredentials>("POST", `/api/devices/${encodeURIComponent(id)}/token`),
  clearDesired: (id: string, name: string) =>
    req("DELETE", `/api/devices/${encodeURIComponent(id)}/desired/${encodeURIComponent(name)}`),
  /** momentary: acción puntual (botón), no queda en el estado deseado del gemelo. */
  command: (device: string, name: string, value: number, momentary = false) =>
    req<{ topic: string; payload: string }>("POST", `/api/devices/${encodeURIComponent(device)}/command`, { name, value, momentary }),

  /** bucketS: intervalo exacto en segundos (ej. 3600 = por hora); si no, ~points intervalos. */
  query: (start: Date, end: Date, points: number, targets: Pick<Target, "device" | "metric" | "agg">[], bucketS?: number) =>
    req<SeriesResult[]>("POST", "/api/query", {
      start: start.toISOString(),
      end: end.toISOString(),
      points,
      bucket_s: bucketS,
      targets: targets.map(({ device, metric, agg }) => ({ device, metric, agg })),
    }),

  analyze: (body: {
    series: { points: [number, number | null][] }[];
    anomalies: boolean;
    forecast: boolean;
    sensitivity: number;
    horizon_ms: number;
  }) => req<AnalysisResult[]>("POST", "/api/analysis", body),

  alerts: () => req<AlertsInfo>("GET", "/api/alerts"),
  createAlert: (a: AlertRuleInput) => req<{ id: string }>("POST", "/api/alerts", a),
  updateAlert: (id: string, a: AlertRuleInput) => req("PUT", `/api/alerts/${id}`, a),
  deleteAlert: (id: string) => req("DELETE", `/api/alerts/${id}`),
  alertEvents: () => req<AlertEvent[]>("GET", "/api/alerts/events"),
  testNotification: () => req("POST", "/api/alerts/test"),

  report: () => req<ReportSettings>("GET", "/api/report"),
  saveReport: (s: { enabled: boolean; hour: number }) => req("PUT", "/api/report", s),
  sendReport: (day: "today" | "yesterday") => req<{ text: string }>("POST", `/api/report/send?day=${day}`),

  annotations: (start: Date, end: Date, dashboard: string) =>
    req<Annotation[]>(
      "GET",
      `/api/annotations?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}&dashboard=${dashboard}`,
    ),
  createAnnotation: (a: AnnotationInput) => req<{ id: string }>("POST", "/api/annotations", a),
  updateAnnotation: (id: string, a: AnnotationInput) => req("PUT", `/api/annotations/${id}`, a),
  deleteAnnotation: (id: string) => req("DELETE", `/api/annotations/${id}`),

  dashboards: () => req<DashboardSummary[]>("GET", "/api/dashboards"),
  dashboard: (id: string) => req<Dashboard>("GET", `/api/dashboards/${id}`),
  createDashboard: (name: string, spec: DashboardSpec) => req<{ id: string }>("POST", "/api/dashboards", { name, spec }),
  saveDashboard: (id: string, name: string, spec: DashboardSpec) => req("PUT", `/api/dashboards/${id}`, { name, spec }),
  deleteDashboard: (id: string) => req("DELETE", `/api/dashboards/${id}`),
};

// crypto.randomUUID solo existe en HTTPS; el sitio corre en HTTP, así que basta con esto.
export const newId = () => Math.random().toString(36).slice(2, 10);

export const AGG_LABEL: Record<Agg, string> = {
  avg: "Promedio",
  min: "Mínimo",
  max: "Máximo",
  sum: "Suma",
  count: "Conteo",
  last: "Último",
};

export const emptySpec = (): DashboardSpec => ({ panels: [], time: { from: "now-1h", to: "now" }, refresh: "live" });
