import { useState } from "react";
import { CalendarClock, ChevronDown, Clock } from "lucide-react";
import type { TimeRange } from "../lib/api";
import { QUICK_RANGES, rangeLabel, resolveRange, toLocalInput } from "../lib/time";
import { Button, cx, Dropdown, Field, inputCls } from "./ui";

export function TimeRangePicker({ value, onChange }: { value: TimeRange; onChange: (r: TimeRange) => void }) {
  return (
    <Dropdown
      className="w-[min(36rem,calc(100vw-2rem))]"
      trigger={(p) => (
        <Button {...p} icon={Clock} className="max-w-72">
          <span className="truncate">{rangeLabel(value)}</span>
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      )}
    >
      {(close) => (
        <div className="grid gap-4 p-2 sm:grid-cols-[1fr_13rem]">
          <AbsoluteForm value={value} onApply={(r) => (onChange(r), close())} />
          <ul className="max-h-80 overflow-auto sm:border-l sm:border-border sm:pl-3">
            {QUICK_RANGES.map(([from, label]) => (
              <li key={from}>
                <button
                  onClick={() => (onChange({ from, to: "now" }), close())}
                  className={cx(
                    "w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-2",
                    value.from === from && value.to === "now" && "bg-accent/15 text-accent",
                  )}
                >
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dropdown>
  );
}

function AbsoluteForm({ value, onApply }: { value: TimeRange; onApply: (r: TimeRange) => void }) {
  const { start, end } = resolveRange(value);
  const [from, setFrom] = useState(toLocalInput(start));
  const [to, setTo] = useState(toLocalInput(end));
  const valid = from && to && new Date(from) < new Date(to);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onApply({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
      }}
    >
      <p className="flex items-center gap-2 text-sm font-medium">
        <CalendarClock className="size-4 text-muted" /> Rango absoluto
      </p>
      <Field label="Desde">
        <input type="datetime-local" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
      </Field>
      <Field label="Hasta">
        <input type="datetime-local" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
      </Field>
      {!valid && <p className="text-xs text-danger">"Desde" debe ser anterior a "Hasta".</p>}
      <Button type="submit" variant="primary" disabled={!valid}>
        Aplicar rango
      </Button>
    </form>
  );
}
