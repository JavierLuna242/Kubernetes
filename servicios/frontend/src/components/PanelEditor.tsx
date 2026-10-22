import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye, EyeOff, Plus, Sigma, Trash2 } from "lucide-react";
import { AGG_LABEL, api, type Agg, type Panel, type PanelOptions, type PanelType, type Refresh, type Target, type TimeRange } from "../lib/api";
import { PALETTE, UNITS } from "../lib/format";
import { applyVars } from "../lib/variables";
import { exprError, FUNCTION_HELP, letter } from "../lib/expressions";
import { COMPARE_OPTIONS, PANEL_TYPES, PanelData } from "./Panel";
import { Button, cx, Field, inputCls, Modal } from "./ui";

const THRESHOLD_COLORS = ["#f2cc0c", "#ff9830", "#f2495c", "#b877d9"];
const num = (s: string) => (s === "" ? undefined : Number(s));
const DEFAULT_MAPPINGS = [
  { value: 0, text: "Apagado", color: "#6e7681" },
  { value: 1, text: "Encendido", color: "#73bf69" },
];

export function PanelEditor({
  panel,
  range,
  refresh,
  vars = {},
  onApply,
  onClose,
}: {
  panel: Panel;
  range: TimeRange;
  refresh: Refresh;
  vars?: Record<string, string>;
  onApply: (p: Panel) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(panel);
  const devices = useQuery({ queryKey: ["devices"], queryFn: api.devices });

  const set = (p: Partial<Panel>) => setDraft((d) => ({ ...d, ...p }));
  const setType = (type: PanelType) =>
    setDraft((d) =>
      type === "state" || type === "control"
        ? // Un estado se lee mejor con el último valor de cada intervalo (el promedio de 0 y 1 no es un estado).
          {
            ...d,
            type,
            targets: d.targets.map((t) => ({ ...t, agg: "last" })),
            options: {
              ...d.options,
              mappings: d.options.mappings?.length ? d.options.mappings : DEFAULT_MAPPINGS,
              control: type === "control" ? (d.options.control ?? { kind: "switch" }) : d.options.control,
            },
          }
        : { ...d, type },
    );
  const ctl = draft.options.control ?? { kind: "switch" as const };
  const setCtl = (p: Partial<typeof ctl>) => setOpt({ control: { ...ctl, ...p } });
  const setOpt = (p: Partial<PanelOptions>) => setDraft((d) => ({ ...d, options: { ...d.options, ...p } }));
  const setTarget = (i: number, p: Partial<Target>) =>
    set({ targets: draft.targets.map((t, j) => (j === i ? { ...t, ...p } : t)) });

  const o = draft.options;
  const canFormula = draft.type !== "map" && draft.type !== "control";
  const metricsOf = (device: string) => devices.data?.find((d) => d.device === device)?.metrics ?? [];

  return (
    <Modal
      open
      size="xl"
      onClose={onClose}
      title={panel.title ? `Editar panel: ${panel.title}` : "Nuevo panel"}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={() => onApply(draft)}>
            Aplicar
          </Button>
        </>
      }
    >
      <div className="grid gap-6 lg:h-full lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-h-0 flex-col gap-5">
          {/* Vista previa */}
          <div className="flex h-80 shrink-0 flex-col rounded-lg border border-border bg-bg/50 lg:h-[46%]">
            <p className="truncate px-3 pt-2.5 text-sm font-medium">{draft.title || "Sin título"}</p>
            <div className="min-h-0 flex-1 p-3">
              <PanelData panel={applyVars(draft, vars)} range={range} refresh={refresh} />
            </div>
          </div>

          {/* Consultas */}
          <section className="min-h-0 lg:overflow-auto">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Consultas</h3>
              <div className="flex gap-2">
                {canFormula && (
                  <Button
                    icon={Sigma}
                    disabled={draft.targets.length >= 20}
                    title="Métrica calculada a partir de las consultas (A, B…)"
                    onClick={() => set({ targets: [...draft.targets, { device: "", metric: "", agg: "avg", expr: "" }] })}
                  >
                    Agregar fórmula
                  </Button>
                )}
                <Button
                  icon={Plus}
                  disabled={draft.targets.length >= 20}
                  onClick={() => {
                    const lastQuery = draft.targets.filter((t) => t.expr === undefined).at(-1);
                    set({ targets: [...draft.targets, { device: lastQuery?.device ?? "", metric: "", agg: "avg" }] });
                  }}
                >
                  Agregar consulta
                </Button>
              </div>
            </div>
            {draft.type === "heatmap" && (
              <p className="mb-3 text-xs text-muted">El mapa de calor usa solo la primera consulta: promedio por hora (filas) y día (columnas).</p>
            )}
            {draft.type === "control" && (
              <p className="mb-3 text-xs text-muted">
                Cada consulta es un control. La métrica es el estado que reporta el dispositivo y, salvo que indiques otro, el
                nombre del comando: se publica <code className="text-accent">{"{\"<comando>\": valor}"}</code> en{" "}
                <code className="text-accent">iot/&lt;dispositivo&gt;/cmd</code>.
              </p>
            )}
            {draft.type === "map" && (
              <p className="mb-3 text-xs text-muted">
                Cada consulta es un dispositivo en el mapa. La métrica es opcional: su valor se muestra en el marcador y lo
                colorean los umbrales.
              </p>
            )}
            {Object.keys(vars).length > 0 && (
              <p className="mb-3 text-xs text-muted">
                Variables disponibles: {Object.keys(vars).map((v) => <code key={v} className="mr-2 text-accent">${v}</code>)}
              </p>
            )}
            {devices.data?.length === 0 && (
              <p className="mb-3 rounded-md border border-dashed border-border p-3 text-xs text-muted">
                Todavía no hay dispositivos enviando datos. Puedes escribir el nombre del dispositivo y la métrica que
                usarán; el panel mostrará los datos en cuanto lleguen.
              </p>
            )}
            <datalist id="devices-list">
              {devices.data?.map((d) => <option key={d.device} value={d.device} />)}
            </datalist>
            <div className="flex flex-col gap-2">
              {draft.targets.map((t, i) => {
                const hide = (
                  <Button
                    variant="ghost"
                    icon={t.hidden ? EyeOff : Eye}
                    aria-label={t.hidden ? "Mostrar en el panel" : "Ocultar en el panel"}
                    title={t.hidden ? "Oculta: solo se usa en fórmulas" : "Ocultar (por ejemplo, si solo se usa en una fórmula)"}
                    onClick={() => setTarget(i, { hidden: !t.hidden || undefined })}
                  />
                );
                const remove = (
                  <Button
                    variant="ghost"
                    icon={Trash2}
                    aria-label="Quitar consulta"
                    onClick={() => set({ targets: draft.targets.filter((_, j) => j !== i) })}
                  />
                );
                const color = (
                  <Field label="Color">
                    <input
                      type="color"
                      className="h-8 w-10 cursor-pointer rounded-md border border-border bg-surface-2 p-1"
                      value={t.color ?? PALETTE[i % PALETTE.length]}
                      onChange={(e) => setTarget(i, { color: e.target.value })}
                    />
                  </Field>
                );
                const isFormula = t.expr !== undefined;
                const badge = (
                  <span
                    className={cx(
                      "flex size-8 items-center justify-center rounded-md text-sm font-semibold",
                      isFormula ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted",
                    )}
                    title={isFormula ? "Fórmula" : `Consulta ${letter(i)}: úsala en fórmulas como ${letter(i)}`}
                  >
                    {isFormula ? "ƒ" : letter(i)}
                  </span>
                );
                if (isFormula) {
                  const err = t.expr!.trim() ? exprError(draft.targets, i) : null;
                  return (
                    <div
                      key={i}
                      className={cx(
                        "grid grid-cols-[auto_1fr] items-end gap-2 rounded-lg border bg-surface-2/40 p-3 md:grid-cols-[auto_minmax(0,2fr)_1fr_auto_auto_auto]",
                        err ? "border-danger" : "border-accent/40",
                        t.hidden && "opacity-60",
                      )}
                    >
                      {badge}
                      <Field label="Fórmula">
                        <input
                          className={cx(inputCls, "font-mono")}
                          value={t.expr}
                          placeholder="A * B   ·   sensacion_termica(A, B)"
                          onChange={(e) => setTarget(i, { expr: e.target.value })}
                        />
                      </Field>
                      <Field label="Nombre (opcional)">
                        <input
                          className={inputCls}
                          value={t.alias ?? ""}
                          placeholder={t.expr || "Potencia"}
                          onChange={(e) => setTarget(i, { alias: e.target.value || undefined })}
                        />
                      </Field>
                      {color}
                      {hide}
                      {remove}
                      {err && <p className="col-span-full text-xs text-danger">{err}</p>}
                    </div>
                  );
                }
                return (
                  <div
                    key={i}
                    className={cx(
                      "grid grid-cols-[auto_1fr_1fr] items-end gap-2 rounded-lg border border-border bg-surface-2/40 p-3 md:grid-cols-[auto_1fr_1fr_8rem_1fr_auto_auto_auto]",
                      t.hidden && "opacity-60",
                    )}
                  >
                    {badge}
                    <Field label="Dispositivo">
                      <input
                        className={inputCls}
                        list="devices-list"
                        value={t.device}
                        placeholder="sensor-1"
                        onChange={(e) => setTarget(i, { device: e.target.value })}
                      />
                    </Field>
                    <Field label={draft.type === "map" ? "Métrica (opcional)" : "Métrica"}>
                      <input
                        className={inputCls}
                        list={`metrics-${i}`}
                        value={t.metric}
                        placeholder={draft.type === "map" ? "ninguna" : "temperatura"}
                        onChange={(e) => setTarget(i, { metric: e.target.value })}
                      />
                      <datalist id={`metrics-${i}`}>
                        {metricsOf(t.device).map((m) => <option key={m} value={m} />)}
                      </datalist>
                    </Field>
                    <Field label="Agregación">
                      <select className={inputCls} value={t.agg} onChange={(e) => setTarget(i, { agg: e.target.value as Agg })}>
                        {Object.entries(AGG_LABEL).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Nombre (opcional)">
                      <input
                        className={inputCls}
                        value={t.alias ?? ""}
                        placeholder={t.device && t.metric ? `${t.device} · ${t.metric}` : ""}
                        onChange={(e) => setTarget(i, { alias: e.target.value || undefined })}
                      />
                    </Field>
                    {color}
                    {canFormula ? hide : <span />}
                    {remove}
                  </div>
                );
              })}
            </div>
            {canFormula && draft.targets.some((t) => t.expr !== undefined) && (
              <details className="mt-3 text-xs text-muted">
                <summary className="cursor-pointer text-accent">Cómo escribir fórmulas</summary>
                <div className="mt-2 space-y-2">
                  <p>
                    Usa las letras de las consultas (A, B, C…), números con punto decimal y <code>+ - * / ^ %</code> con
                    paréntesis. Se calcula en cada intervalo donde todas las consultas usadas tienen dato. Ejemplos:{" "}
                    <code className="text-fg">A * B</code> (potencia = voltaje × corriente),{" "}
                    <code className="text-fg">sensacion_termica(A, B)</code>, <code className="text-fg">A * 9 / 5 + 32</code> (°C → °F).
                  </p>
                  <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
                    {FUNCTION_HELP.map((f) => (
                      <li key={f.name}>
                        <code className="text-fg">{f.name}()</code> {f.help}
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            )}
          </section>
        </div>

        {/* Opciones */}
        <aside className="flex flex-col gap-6 lg:overflow-auto lg:border-l lg:border-border lg:pl-6">
          <section>
            <h3 className="mb-2 text-sm font-semibold">Visualización</h3>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(PANEL_TYPES).map(([type, { label, icon: Icon }]) => (
                <button
                  key={type}
                  onClick={() => setType(type as PanelType)}
                  aria-pressed={draft.type === type}
                  className={cx(
                    "flex flex-col items-center gap-1.5 rounded-lg border p-2.5 text-xs transition",
                    draft.type === type ? "border-accent bg-accent/10 text-accent" : "border-border hover:border-muted/60",
                  )}
                >
                  <Icon className="size-5" />
                  {label}
                </button>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">General</h3>
            <Field label="Título">
              <input className={inputCls} value={draft.title} onChange={(e) => set({ title: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Unidad">
                <input
                  className={inputCls}
                  list="units-list"
                  value={o.unit ?? ""}
                  placeholder="°C, %, V…"
                  onChange={(e) => setOpt({ unit: e.target.value || undefined })}
                />
                <datalist id="units-list">
                  {UNITS.map((u) => <option key={u} value={u} />)}
                </datalist>
              </Field>
              <Field label="Decimales">
                <input
                  type="number"
                  min={0}
                  max={6}
                  className={inputCls}
                  value={o.decimals ?? ""}
                  placeholder="auto"
                  onChange={(e) => setOpt({ decimals: num(e.target.value) })}
                />
              </Field>
              <Field label="Mínimo">
                <input type="number" className={inputCls} value={o.min ?? ""} placeholder="auto" onChange={(e) => setOpt({ min: num(e.target.value) })} />
              </Field>
              <Field label="Máximo">
                <input type="number" className={inputCls} value={o.max ?? ""} placeholder="auto" onChange={(e) => setOpt({ max: num(e.target.value) })} />
              </Field>
            </div>
            {draft.type === "timeseries" && (
              <>
                <Field label="Estilo">
                  <div className="grid grid-cols-3 overflow-hidden rounded-md border border-border text-sm">
                    {(["line", "area", "bars"] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setOpt({ style: s })}
                        aria-pressed={(o.style ?? "line") === s}
                        className={cx("py-1.5", (o.style ?? "line") === s ? "bg-accent text-accent-fg" : "hover:bg-surface-2")}
                      >
                        {{ line: "Línea", area: "Área", bars: "Barras" }[s]}
                      </button>
                    ))}
                  </div>
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--accent)]"
                    checked={o.legend !== false}
                    onChange={(e) => setOpt({ legend: e.target.checked })}
                  />
                  Mostrar leyenda
                </label>
              </>
            )}
            {draft.type === "map" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Métrica de latitud">
                  <input className={inputCls} value={o.latMetric ?? ""} placeholder="lat" onChange={(e) => setOpt({ latMetric: e.target.value || undefined })} />
                </Field>
                <Field label="Métrica de longitud">
                  <input className={inputCls} value={o.lonMetric ?? ""} placeholder="lon" onChange={(e) => setOpt({ lonMetric: e.target.value || undefined })} />
                </Field>
              </div>
            )}
          </section>

          {draft.type === "control" && (
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold">Control</h3>
              <div className="grid grid-cols-3 overflow-hidden rounded-md border border-border text-sm">
                {(["switch", "button", "slider"] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setCtl({ kind: k })}
                    aria-pressed={ctl.kind === k}
                    className={cx("py-1.5", ctl.kind === k ? "bg-accent text-accent-fg" : "hover:bg-surface-2")}
                  >
                    {{ switch: "Interruptor", button: "Botón", slider: "Deslizador" }[k]}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted">
                {
                  {
                    switch: "Envía 1 (encender) o 0 (apagar) y espera a que el dispositivo confirme el nuevo estado.",
                    button: "Envía siempre el mismo valor (ej. reiniciar, abrir una puerta).",
                    slider: "Envía el valor elegido al soltar (ej. velocidad, brillo, temperatura objetivo).",
                  }[ctl.kind]
                }
              </p>
              <Field label="Comando (opcional)">
                <input
                  className={inputCls}
                  value={ctl.command ?? ""}
                  placeholder="igual a la métrica"
                  onChange={(e) => setCtl({ command: e.target.value.replace(/[^A-Za-z0-9_-]/g, "") || undefined })}
                />
              </Field>
              {ctl.kind === "button" && (
                <Field label="Valor que envía">
                  <input type="number" step="any" className={inputCls} value={ctl.value ?? 1} onChange={(e) => setCtl({ value: Number(e.target.value) })} />
                </Field>
              )}
              {ctl.kind === "slider" && (
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Mínimo">
                    <input type="number" step="any" className={inputCls} value={ctl.min ?? 0} onChange={(e) => setCtl({ min: Number(e.target.value) })} />
                  </Field>
                  <Field label="Máximo">
                    <input type="number" step="any" className={inputCls} value={ctl.max ?? 100} onChange={(e) => setCtl({ max: Number(e.target.value) })} />
                  </Field>
                  <Field label="Paso">
                    <input type="number" step="any" min={0} className={inputCls} value={ctl.step ?? 1} onChange={(e) => setCtl({ step: Number(e.target.value) || 1 })} />
                  </Field>
                </div>
              )}
            </section>
          )}

          {draft.type === "timeseries" && (
            <section className="flex flex-col gap-3">
              <div>
                <h3 className="text-sm font-semibold">Comparar</h3>
                <p className="text-xs text-muted">Dibuja el mismo rango de un período anterior, punteado, sobre el actual.</p>
              </div>
              <select className={inputCls} value={o.compare ?? 0} onChange={(e) => setOpt({ compare: Number(e.target.value) || undefined })}>
                <option value={0}>No comparar</option>
                {COMPARE_OPTIONS.map(([ms, l]) => (
                  <option key={ms} value={ms}>Con {l}</option>
                ))}
              </select>
            </section>
          )}

          {draft.type === "timeseries" && (
            <section className="flex flex-col gap-3">
              <div>
                <h3 className="text-sm font-semibold">Análisis</h3>
                <p className="text-xs text-muted">Lo calcula el servicio de análisis sobre los datos visibles.</p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={!!o.anomalies} onChange={(e) => setOpt({ anomalies: e.target.checked })} />
                Detectar anomalías
              </label>
              {o.anomalies && (
                <Field label="Sensibilidad">
                  <select className={inputCls} value={o.sensitivity ?? 3.5} onChange={(e) => setOpt({ sensitivity: Number(e.target.value) })}>
                    <option value={2.5}>Alta (marca más puntos)</option>
                    <option value={3.5}>Media</option>
                    <option value={5}>Baja (solo saltos grandes)</option>
                  </select>
                </Field>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={!!o.forecast} onChange={(e) => setOpt({ forecast: e.target.checked })} />
                Pronóstico
              </label>
              {o.forecast && (
                <Field label="Horizonte">
                  <select className={inputCls} value={o.horizon ?? 0.25} onChange={(e) => setOpt({ horizon: Number(e.target.value) })}>
                    <option value={0.1}>10 % del rango visible</option>
                    <option value={0.25}>25 % del rango visible</option>
                    <option value={0.5}>50 % del rango visible</option>
                    <option value={1}>100 % del rango visible</option>
                  </select>
                </Field>
              )}
            </section>
          )}

          {(draft.type === "state" || draft.type === "control") && (
            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Estados</h3>
                <Button
                  icon={Plus}
                  onClick={() => {
                    const ms = o.mappings ?? [];
                    const next = ms.length ? Math.max(...ms.map((m) => m.value)) + 1 : 0;
                    setOpt({ mappings: [...ms, { value: next, text: `Estado ${next}`, color: PALETTE[ms.length % PALETTE.length] }] });
                  }}
                >
                  Agregar
                </Button>
              </div>
              <p className="text-xs text-muted">Valor exacto → texto y color. Los valores sin asignar usan los umbrales.</p>
              {(o.mappings ?? []).map((m, i) => {
                const upd = (p: Partial<typeof m>) => setOpt({ mappings: o.mappings!.map((x, j) => (j === i ? { ...x, ...p } : x)) });
                return (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="color"
                      className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-border bg-surface-2 p-1"
                      value={m.color}
                      onChange={(e) => upd({ color: e.target.value })}
                    />
                    <input type="number" className={cx(inputCls, "w-20 shrink-0")} value={m.value} aria-label="Valor" onChange={(e) => upd({ value: Number(e.target.value) })} />
                    <span className="text-sm text-muted">→</span>
                    <input className={cx(inputCls, "min-w-0")} value={m.text} aria-label="Texto" onChange={(e) => upd({ text: e.target.value })} />
                    <Button
                      variant="ghost"
                      icon={Trash2}
                      aria-label="Quitar estado"
                      onClick={() => setOpt({ mappings: o.mappings!.filter((_, j) => j !== i) })}
                    />
                  </div>
                );
              })}
            </section>
          )}

          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Umbrales</h3>
              <Button
                icon={Plus}
                onClick={() => {
                  const top = Math.max(0, ...o.thresholds.map((t) => t.value));
                  const color = THRESHOLD_COLORS[o.thresholds.length % THRESHOLD_COLORS.length];
                  setOpt({ thresholds: [...o.thresholds, { value: o.thresholds.length ? top + 10 : 80, color }] });
                }}
              >
                Agregar
              </Button>
            </div>
            <p className="text-xs text-muted">Colorean valores, medidores y barras; en series de tiempo se dibujan como líneas.</p>
            {[...o.thresholds]
              .map((t, i) => ({ t, i }))
              .sort((a, b) => b.t.value - a.t.value)
              .map(({ t, i }) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="color"
                    className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-border bg-surface-2 p-1"
                    value={t.color}
                    onChange={(e) =>
                      setOpt({ thresholds: o.thresholds.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) })
                    }
                  />
                  <span className="text-sm text-muted">≥</span>
                  <input
                    type="number"
                    className={cx(inputCls, "min-w-0")}
                    value={t.value}
                    onChange={(e) =>
                      setOpt({ thresholds: o.thresholds.map((x, j) => (j === i ? { ...x, value: Number(e.target.value) } : x)) })
                    }
                  />
                  <Button
                    variant="ghost"
                    icon={Trash2}
                    aria-label="Quitar umbral"
                    onClick={() => setOpt({ thresholds: o.thresholds.filter((_, j) => j !== i) })}
                  />
                </div>
              ))}
            <div className="flex items-center gap-2">
              <input
                type="color"
                className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-border bg-surface-2 p-1"
                value={o.baseColor ?? "#73bf69"}
                onChange={(e) => setOpt({ baseColor: e.target.value })}
              />
              <span className="text-sm text-muted">Base (por debajo de todos)</span>
            </div>
          </section>
        </aside>
      </div>
    </Modal>
  );
}
