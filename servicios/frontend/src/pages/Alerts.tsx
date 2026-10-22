import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, CalendarClock, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { api, type AlertOp, type AlertRule, type AlertRuleInput, type RuleAction } from "../lib/api";
import { fmtValue } from "../lib/format";
import { toast } from "../lib/hooks";
import { timeAgo } from "../lib/time";
import { Button, cx, Dropdown, EmptyState, Field, inputCls, MenuItem, Modal, Spinner } from "../components/ui";

const FOR_OPTIONS: [number, string][] = [
  [0, "de inmediato"],
  [30, "durante 30 s"],
  [60, "durante 1 min"],
  [300, "durante 5 min"],
  [600, "durante 10 min"],
  [900, "durante 15 min"],
  [1800, "durante 30 min"],
  [3600, "durante 1 h"],
];
const OP_LABEL: Record<AlertOp, string> = {
  ">": "mayor que",
  ">=": "mayor o igual que",
  "<": "menor que",
  "<=": "menor o igual que",
  nodata: "sin datos (dispositivo caído)",
};
const forLabel = (s: number) => FOR_OPTIONS.find(([v]) => v === s)?.[1] ?? `durante ${s} s`;
const targetLabel = (device: string, metric: string) => (metric ? `${device} · ${metric}` : `${device} · cualquier métrica`);
/** Valor mostrado: en "sin datos" son los minutos desde el último dato. */
const valueLabel = (op: AlertOp, v: number | null) =>
  op === "nodata" ? (v == null ? "nunca envió" : `hace ${fmtValue(v, { decimals: 0 })} min`) : fmtValue(v);

export const STATE_STYLE: Record<AlertRule["state"], { label: string; cls: string }> = {
  ok: { label: "Normal", cls: "bg-ok/15 text-ok" },
  pending: { label: "Pendiente", cls: "bg-amber-500/15 text-amber-500" },
  firing: { label: "Disparada", cls: "bg-danger text-white" },
};

export const alertsQuery = { queryKey: ["alerts"], queryFn: api.alerts, refetchInterval: 15_000 };

export function AlertsPage() {
  const qc = useQueryClient();
  const alerts = useQuery(alertsQuery);
  const events = useQuery({ queryKey: ["alert-events"], queryFn: api.alertEvents, refetchInterval: 15_000 });
  const [editing, setEditing] = useState<{ id?: string; rule: AlertRuleInput } | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["alerts"] });
    qc.invalidateQueries({ queryKey: ["alert-events"] });
  };
  const toggle = useMutation({
    mutationFn: (r: AlertRule) => api.updateAlert(r.id, { ...r, enabled: !r.enabled }),
    onSuccess: invalidate,
    onError: (e) => toast(e.message, "error"),
  });
  const remove = useMutation({
    mutationFn: api.deleteAlert,
    onSuccess: () => (invalidate(), toast("Alerta eliminada")),
    onError: (e) => toast(e.message, "error"),
  });
  const test = useMutation({
    mutationFn: api.testNotification,
    onSuccess: () => toast("Mensaje de prueba enviado a Telegram"),
    onError: (e) => toast(e.message, "error"),
  });

  const rules = alerts.data?.rules ?? [];

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Alertas y reglas</h1>
          <p className="mt-1 text-sm text-muted">
            Se evalúan cada {alerts.data?.eval_s ?? 15} s con el último dato de los últimos 5 minutos. Una alerta disparada pone
            en rojo los paneles que muestran esa métrica y puede ejecutar acciones automáticas: “si… entonces…”.
          </p>
        </div>
        <Button
          variant="primary"
          icon={Plus}
          onClick={() => setEditing({ rule: { name: "", device: "", metric: "", op: ">", threshold: 0, for_s: 60, enabled: true, notify: true, on_fire: [], on_resolve: [] } })}
        >
          Nueva regla
        </Button>
      </div>

      <TelegramCard configured={alerts.data?.telegram} onTest={() => test.mutate()} testing={test.isPending} />
      <DailyReportCard />

      {alerts.isPending ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : alerts.isError ? (
        <p className="text-danger">Error: {alerts.error.message}</p>
      ) : rules.length === 0 ? (
        <EmptyState icon={Bell} title="Todavía no hay alertas">
          Crea una regla como “temperatura mayor que 30 durante 5 min”. También puedes crearla desde el menú de un panel.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Estado</th>
                <th className="px-4 py-2.5 font-medium">Alerta</th>
                <th className="px-4 py-2.5 font-medium">Condición</th>
                <th className="px-4 py-2.5 text-right font-medium">Último valor</th>
                <th className="w-32" />
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className={cx("border-b border-border/60 last:border-0", !r.enabled && "opacity-50")}>
                  <td className="px-4 py-3">
                    <span className={cx("rounded px-2 py-0.5 text-xs font-semibold whitespace-nowrap", r.enabled ? STATE_STYLE[r.state].cls : "bg-surface-2 text-muted")}>
                      {r.enabled ? STATE_STYLE[r.state].label : "Pausada"}
                    </span>
                    {r.enabled && r.since && r.state !== "ok" && <p className="mt-1 text-xs text-muted">{timeAgo(r.since)}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{r.name}</p>
                    <p className="text-xs text-muted">{targetLabel(r.device, r.metric)}</p>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {r.op === "nodata" ? (
                      <>
                        sin datos durante más de <b className="text-fg">{fmtValue(r.threshold)} min</b>
                      </>
                    ) : (
                      <>
                        {OP_LABEL[r.op]} <b className="text-fg">{fmtValue(r.threshold)}</b> {forLabel(r.for_s)}
                      </>
                    )}
                    {(r.on_fire.length > 0 || r.on_resolve.length > 0 || !r.notify) && (
                      <p className="mt-1 flex flex-wrap gap-1 text-xs">
                        {r.on_fire.map((a, i) => (
                          <span key={`f${i}`} className="rounded bg-accent/10 px-1.5 py-0.5 text-accent" title="Al dispararse">
                            ⚙ {a.device} ← {a.name} = {fmtValue(a.value)}
                          </span>
                        ))}
                        {r.on_resolve.map((a, i) => (
                          <span key={`r${i}`} className="rounded bg-ok/10 px-1.5 py-0.5 text-ok" title="Al resolverse">
                            ↺ {a.device} ← {a.name} = {fmtValue(a.value)}
                          </span>
                        ))}
                        {!r.notify && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-muted">sin aviso</span>}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.enabled ? valueLabel(r.op, r.last_value) : "—"}</td>
                  <td className="px-2">
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        icon={r.enabled ? BellOff : Bell}
                        aria-label={r.enabled ? "Pausar" : "Reanudar"}
                        title={r.enabled ? "Pausar" : "Reanudar"}
                        onClick={() => toggle.mutate(r)}
                      />
                      <Button variant="ghost" icon={Pencil} aria-label="Editar" onClick={() => setEditing({ id: r.id, rule: r })} />
                      <Button
                        variant="ghost"
                        icon={Trash2}
                        aria-label="Eliminar"
                        onClick={() => confirm(`¿Eliminar la alerta "${r.name}" y su historial?`) && remove.mutate(r.id)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-10 mb-3 font-semibold">Historial</h2>
      {events.data?.length ? (
        <ol className="divide-y divide-border/60 rounded-lg border border-border bg-surface">
          {events.data.map((e, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
              <span className={cx("rounded px-2 py-0.5 text-xs font-semibold", e.state === "firing" ? "bg-danger text-white" : "bg-ok/15 text-ok")}>
                {e.state === "firing" ? "Disparada" : "Resuelta"}
              </span>
              <span className="font-medium">{e.rule_name}</span>
              <span className="text-muted">
                {targetLabel(e.device, e.metric)}: {valueLabel(e.op, e.value)}
              </span>
              {e.actions && <span className="text-xs text-accent">⚙ {e.actions}</span>}
              <span className="ml-auto text-xs text-muted" title={new Date(e.time).toLocaleString("es")}>
                {timeAgo(e.time)}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted">Sin eventos todavía. Aquí aparecerá cada vez que una alerta se dispare o se resuelva.</p>
      )}

      {editing && <AlertRuleModal id={editing.id} initial={editing.rule} onClose={() => setEditing(null)} />}
    </div>
  );
}

function DailyReportCard() {
  const qc = useQueryClient();
  const report = useQuery({ queryKey: ["report"], queryFn: api.report });
  const [preview, setPreview] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: api.saveReport,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["report"] }),
    onError: (e) => toast(e.message, "error"),
  });
  const send = useMutation({
    mutationFn: api.sendReport,
    onSuccess: (r) => (setPreview(r.text), toast("Reporte enviado a Telegram")),
    onError: (e) => toast(e.message, "error"),
  });
  const r = report.data;
  if (!r) return null;
  const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

  return (
    <div className="mb-6 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <CalendarClock className={cx("size-4 shrink-0", r.enabled ? "text-ok" : "text-muted")} />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-[var(--accent)]"
            checked={r.enabled}
            disabled={!r.telegram || save.isPending}
            onChange={(e) => save.mutate({ enabled: e.target.checked, hour: r.hour })}
          />
          <span>
            <b>Reporte diario</b> por Telegram: mínimo, máximo y promedio de cada métrica del día anterior, alertas
            disparadas y dispositivos sin datos.
          </span>
        </label>
        <div className="ml-auto flex items-center gap-2">
          <span className="whitespace-nowrap text-muted">a las</span>
          <select
            className={cx(inputCls, "w-auto")}
            value={r.hour}
            disabled={!r.telegram || save.isPending}
            onChange={(e) => save.mutate({ enabled: r.enabled, hour: Number(e.target.value) })}
            aria-label="Hora del reporte"
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{hourLabel(h)}</option>
            ))}
          </select>
          <Dropdown
            trigger={(p) => (
              <Button {...p} icon={Send} loading={send.isPending} disabled={!r.telegram}>
                Enviar ahora
              </Button>
            )}
          >
            {(close) => (
              <>
                <MenuItem onClick={() => (close(), send.mutate("today"))}>Hoy hasta ahora</MenuItem>
                <MenuItem onClick={() => (close(), send.mutate("yesterday"))}>Ayer completo</MenuItem>
              </>
            )}
          </Dropdown>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">
        {!r.telegram
          ? "Primero configura Telegram (arriba)."
          : r.enabled
            ? `Se envía todos los días a las ${hourLabel(r.hour)} (hora de ${r.tz.split("/").pop()?.replace("_", " ")}).${r.last ? ` Último envío: ${r.last}.` : ""}`
            : "Desactivado."}
      </p>
      {preview && <pre className="mt-3 max-h-72 overflow-auto rounded-md bg-surface-2 p-3 text-xs whitespace-pre-wrap">{preview}</pre>}
    </div>
  );
}

function TelegramCard({ configured, onTest, testing }: { configured?: boolean; onTest: () => void; testing: boolean }) {
  if (configured === undefined) return null;
  return (
    <div className="mb-6 flex flex-wrap items-start gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
      <Send className={cx("mt-0.5 size-4 shrink-0", configured ? "text-ok" : "text-muted")} />
      {configured ? (
        <>
          <p className="flex-1">Las alertas se notifican por Telegram cuando se disparan y cuando se resuelven.</p>
          <Button icon={Send} loading={testing} onClick={onTest}>
            Enviar prueba
          </Button>
        </>
      ) : (
        <details className="flex-1">
          <summary className="cursor-pointer">
            Notificaciones por Telegram: <b>no configuradas</b>. Las alertas se ven aquí y en los paneles.{" "}
            <span className="text-accent">Cómo activarlas</span>
          </summary>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-muted">
            <li>En Telegram, habla con <b className="text-fg">@BotFather</b>, envía <code>/newbot</code> y copia el token.</li>
            <li>Escríbele cualquier mensaje a tu bot nuevo.</li>
            <li>
              Abre <code>https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code> y copia el número de <code>"chat":{"{"}"id"</code>.
            </li>
            <li>
              Guárdalos en el clúster y reinicia el back:
              <pre className="mt-2 overflow-x-auto rounded-md bg-surface-2 p-3 text-xs text-fg">{`kubectl -n iot create secret generic telegram --from-literal=token=<TOKEN> --from-literal=chat-id=<CHAT_ID>
kubectl -n iot rollout restart deploy/back`}</pre>
            </li>
          </ol>
        </details>
      )}
    </div>
  );
}

/** Crear o editar una regla de alerta. Se usa en esta página y desde el menú de un panel. */
export function AlertRuleModal({ id, initial, onClose }: { id?: string; initial: AlertRuleInput; onClose: () => void }) {
  const qc = useQueryClient();
  const [r, setR] = useState(initial);
  const devices = useQuery({ queryKey: ["devices"], queryFn: api.devices });
  const set = (p: Partial<AlertRuleInput>) => setR((x) => ({ ...x, ...p }));

  const save = useMutation({
    mutationFn: () => {
      const auto = nodata ? `${r.device} sin datos` : `${r.device} · ${r.metric} ${r.op} ${r.threshold}`;
      const body = { ...r, name: r.name.trim() || auto, for_s: nodata ? 0 : r.for_s, metric: r.metric.trim() };
      return id ? api.updateAlert(id, body) : api.createAlert(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alerts"] });
      toast(id ? "Regla actualizada" : "Regla creada");
      onClose();
    },
    onError: (e) => toast(e.message, "error"),
  });

  const metrics = devices.data?.find((d) => d.device === r.device)?.metrics ?? [];
  const nodata = r.op === "nodata";
  const actionsOk = [...r.on_fire, ...r.on_resolve].every(
    (a) => /^[a-z0-9][a-z0-9_-]{1,62}$/.test(a.device) && /^[A-Za-z0-9_-]+$/.test(a.name) && Number.isFinite(a.value),
  );
  const valid = r.device.trim() && (nodata || r.metric.trim()) && Number.isFinite(r.threshold) && (!nodata || r.threshold > 0) && actionsOk;

  return (
    <Modal
      open
      onClose={onClose}
      title={id ? "Editar regla" : "Nueva regla"}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>
            Guardar
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save.mutate();
        }}
      >
        <Field label="Nombre">
          <input className={inputCls} value={r.name} placeholder="Temperatura alta en el laboratorio" onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Dispositivo">
            <input className={inputCls} list="alert-devices" value={r.device} placeholder="sensor-1" onChange={(e) => set({ device: e.target.value })} />
            <datalist id="alert-devices">{devices.data?.map((d) => <option key={d.device} value={d.device} />)}</datalist>
          </Field>
          <Field label={nodata ? "Métrica (opcional)" : "Métrica"}>
            <input
              className={inputCls}
              list="alert-metrics"
              value={r.metric}
              placeholder={nodata ? "cualquiera" : "temperatura"}
              onChange={(e) => set({ metric: e.target.value })}
            />
            <datalist id="alert-metrics">{metrics.map((m) => <option key={m} value={m} />)}</datalist>
          </Field>
        </div>
        <div className="grid grid-cols-[1fr_8rem] gap-3">
          <Field label="Se dispara si">
            <select
              className={inputCls}
              value={r.op}
              onChange={(e) => {
                const op = e.target.value as AlertOp;
                set(op === "nodata" ? { op, threshold: r.threshold > 0 ? r.threshold : 5 } : { op });
              }}
            >
              {Object.entries(OP_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{v === "nodata" ? l : `el valor es ${l}`}</option>
              ))}
            </select>
          </Field>
          <Field label={nodata ? "Minutos sin datos" : "Umbral"}>
            <input
              type="number"
              step="any"
              min={nodata ? 1 : undefined}
              className={inputCls}
              value={r.threshold}
              onChange={(e) => set({ threshold: Number(e.target.value) })}
            />
          </Field>
        </div>
        {nodata ? (
          <p className="text-xs text-muted">
            Se dispara si <b>{r.device || "el dispositivo"}</b> no envía {r.metric ? <b>{r.metric}</b> : "ningún dato"} durante más
            de {r.threshold > 0 ? r.threshold : "N"} minutos, y se resuelve sola cuando vuelve a enviar. Ideal para saber si un
            dispositivo se desconectó o se quedó sin energía.
          </p>
        ) : (
          <>
            <Field label="Durante">
              <select className={inputCls} value={r.for_s} onChange={(e) => set({ for_s: Number(e.target.value) })}>
                {FOR_OPTIONS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </Field>
            <p className="text-xs text-muted">
              Con “durante”, la alerta queda <b>pendiente</b> al cumplirse la condición y se <b>dispara</b> solo si se sigue
              cumpliendo todo ese tiempo. Así se evitan avisos por picos aislados.
            </p>
          </>
        )}
        <section className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <h3 className="text-sm font-semibold">Entonces…</h3>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={r.notify} onChange={(e) => set({ notify: e.target.checked })} />
            Avisar por Telegram al dispararse y al resolverse
          </label>
          <ActionList
            title="Al dispararse, enviar comando"
            actions={r.on_fire}
            devices={devices.data?.filter((d) => d.registered).map((d) => d.device) ?? []}
            onChange={(on_fire) => set({ on_fire })}
          />
          <ActionList
            title="Al resolverse, enviar comando"
            actions={r.on_resolve}
            devices={devices.data?.filter((d) => d.registered).map((d) => d.device) ?? []}
            onChange={(on_resolve) => set({ on_resolve })}
          />
          <p className="text-xs text-muted">
            Ejemplo: si la temperatura supera 30 °C durante 1 min, enviar <code>encendido = 1</code> al ventilador; al
            resolverse, <code>encendido = 0</code>. El comando pasa al estado deseado del dispositivo, así lo recibe aunque
            esté desconectado en ese momento.
          </p>
        </section>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={r.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          Activa
        </label>
      </form>
    </Modal>
  );
}

/** Lista editable de acciones (comando a un dispositivo) de una regla. */
function ActionList({
  title,
  actions,
  devices,
  onChange,
}: {
  title: string;
  actions: RuleAction[];
  devices: string[];
  onChange: (a: RuleAction[]) => void;
}) {
  const upd = (i: number, p: Partial<RuleAction>) => onChange(actions.map((a, j) => (j === i ? { ...a, ...p } : a)));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted">{title}</p>
        <Button
          variant="ghost"
          icon={Plus}
          disabled={actions.length >= 10}
          onClick={() => onChange([...actions, { type: "command", device: devices[0] ?? "", name: "encendido", value: 1 }])}
        >
          Acción
        </Button>
      </div>
      <datalist id="rule-devices">{devices.map((d) => <option key={d} value={d} />)}</datalist>
      {actions.map((a, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_5rem_auto] items-center gap-2">
          <input className={inputCls} list="rule-devices" value={a.device} placeholder="dispositivo" aria-label="Dispositivo" onChange={(e) => upd(i, { device: e.target.value })} />
          <input className={cx(inputCls, "font-mono")} value={a.name} placeholder="comando" aria-label="Comando" onChange={(e) => upd(i, { name: e.target.value })} />
          <input type="number" step="any" className={inputCls} value={a.value} aria-label="Valor" onChange={(e) => upd(i, { value: Number(e.target.value) })} />
          <Button variant="ghost" icon={Trash2} aria-label="Quitar acción" onClick={() => onChange(actions.filter((_, j) => j !== i))} />
        </div>
      ))}
    </div>
  );
}
