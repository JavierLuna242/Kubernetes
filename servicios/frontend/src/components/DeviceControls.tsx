// Panel de control: interruptor, botón o deslizador que envía comandos al dispositivo por MQTT
// (iot/<dispositivo>/cmd). El estado que se muestra es el que el dispositivo reporta en su telemetría:
// tras enviar, el control queda "esperando" hasta que el dispositivo confirma el nuevo valor.
import { useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { api, type ControlOptions, type PanelOptions, type Target } from "../lib/api";
import { fmtValue } from "../lib/format";
import { toast } from "../lib/hooks";
import type { SeriesView } from "../lib/series";
import { Button, cx } from "./ui";

const CONFIRM_MS = 10_000;

export function DeviceControls({ targets, series, options: o }: { targets: Target[]; series: SeriesView[]; options: PanelOptions }) {
  const c: ControlOptions = o.control ?? { kind: "switch" };
  return (
    <div className="flex h-full flex-col justify-center gap-3 overflow-auto">
      {targets.map((t, i) => (
        <ControlRow key={`${t.device}/${t.metric}/${i}`} target={t} current={series[i]?.last ?? null} c={c} o={o} />
      ))}
    </div>
  );
}

function ControlRow({ target: t, current, c, o }: { target: Target; current: number | null; c: ControlOptions; o: PanelOptions }) {
  const command = c.command || t.metric;
  const [waiting, setWaiting] = useState<number | null>(null); // valor enviado que falta confirmar
  const timer = useRef<number | undefined>(undefined);

  // Confirmado cuando el dispositivo reporta el valor enviado.
  useEffect(() => {
    if (waiting !== null && current !== null && Math.abs(current - waiting) < 1e-9) {
      clearTimeout(timer.current);
      setWaiting(null);
    }
  }, [current, waiting]);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function send(value: number, confirm = true) {
    try {
      await api.command(t.device, command, value, !confirm);
      if (!confirm) return toast(`Enviado ${command} = ${value} a ${t.device}`);
      setWaiting(value);
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        setWaiting(null);
        toast(`${t.device} no confirmó ${command} = ${value}. ¿Está conectado y suscrito a iot/${t.device}/cmd?`, "error");
      }, CONFIRM_MS);
    } catch (e) {
      toast(`No se pudo enviar: ${(e as Error).message}`, "error");
    }
  }

  const label = t.alias || `${t.device} · ${command}`;
  const mapped = (v: number | null) => (v == null ? null : o.mappings?.find((m) => Math.abs(m.value - v) < 1e-9));

  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{label}</p>
        <p className="flex items-center gap-1.5 text-xs text-muted">
          {waiting !== null && <Loader2 className="size-3 animate-spin" />}
          {waiting !== null
            ? `Esperando confirmación (${fmtValue(waiting, o)})…`
            : current === null
              ? "Sin estado reportado"
              : `Estado: ${mapped(current)?.text ?? fmtValue(current, o)}`}
        </p>
      </div>
      {c.kind === "switch" && <Switch on={current !== null && current >= 0.5} busy={waiting !== null} onToggle={(on) => send(on ? 1 : 0)} />}
      {c.kind === "button" && (
        <Button variant="primary" icon={Send} onClick={() => send(c.value ?? 1, false)}>
          {mapped(c.value ?? 1)?.text ?? `Enviar ${fmtValue(c.value ?? 1)}`}
        </Button>
      )}
      {c.kind === "slider" && <Slider current={current} c={c} o={o} busy={waiting !== null} onCommit={send} />}
    </div>
  );
}

function Switch({ on, busy, onToggle }: { on: boolean; busy: boolean; onToggle: (on: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={busy}
      onClick={() => onToggle(!on)}
      className={cx(
        "relative h-8 w-14 shrink-0 rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        on ? "bg-ok" : "bg-surface-2 ring-1 ring-border",
        busy && "opacity-60",
      )}
    >
      <span className={cx("absolute top-1 size-6 rounded-full bg-white shadow transition-all", on ? "left-7" : "left-1")} />
    </button>
  );
}

function Slider({
  current,
  c,
  o,
  busy,
  onCommit,
}: {
  current: number | null;
  c: ControlOptions;
  o: PanelOptions;
  busy: boolean;
  onCommit: (v: number) => void;
}) {
  const min = c.min ?? 0;
  const max = c.max ?? 100;
  const [v, setV] = useState(current ?? min);
  const dragging = useRef(false);
  // Sigue al valor reportado mientras el usuario no lo está moviendo.
  useEffect(() => {
    if (!dragging.current && current !== null) setV(current);
  }, [current]);

  const commit = () => {
    dragging.current = false;
    if (v !== current) onCommit(v);
  };

  return (
    <div className="flex w-1/2 max-w-72 min-w-36 shrink-0 items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={c.step ?? 1}
        value={v}
        disabled={busy}
        aria-label="Valor a enviar"
        className="h-2 flex-1 cursor-pointer accent-[var(--accent)]"
        onPointerDown={() => (dragging.current = true)}
        onChange={(e) => setV(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
      />
      <span className="w-16 text-right text-sm font-semibold tabular-nums">{fmtValue(v, o)}</span>
    </div>
  );
}
