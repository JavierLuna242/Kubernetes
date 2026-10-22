// Chequeos de lógica pura del front: cortes en las series, variables de dashboard y métricas calculadas. Correr:  npx tsx src/lib/tests.check.ts
import assert from "node:assert/strict";
import { toSeriesViews } from "./series";
import { interpolate } from "./variables";
import { dewPoint, evalExpr, ExprError, exprError, heatIndex, parseExpr, withExpressions } from "./expressions";

const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();
const series = (secs: number[]) => [{ device: "d", metric: "m", agg: "avg" as const, points: secs.map((s) => [at(s), 1] as [string, number]) }];
const nulls = (secs: number[], bucketMs: number) =>
  toSeriesViews(series(secs), [], bucketMs)[0].points.filter(([, v]) => v === null).length;

// Dispositivo cada 3 s con bucket de 112 ms: no hay cortes (antes se cortaba entre cada punto).
assert.equal(nulls([0, 3, 6, 9, 12], 112), 0);
// Mismo dispositivo que se calla 60 s: un corte.
assert.equal(nulls([0, 3, 6, 66, 69, 72], 112), 1);
// Bucket grande (1 min) y datos cada minuto con un hueco de 5 min: un corte.
assert.equal(nulls([0, 60, 120, 420, 480], 60_000), 1);
// Último valor, mín y máx.
const v = toSeriesViews([{ device: "d", metric: "m", agg: "avg", points: [[at(0), 5], [at(1), null], [at(2), 2]] }], [], 1000)[0];
assert.deepEqual([v.last, v.min, v.max], [2, 2, 5]);

// Variables de dashboard: $x y ${x}; las desconocidas quedan tal cual.
assert.equal(interpolate("$disp · ${met}s · $otra", { disp: "sensor-1", met: "temperatura" }), "sensor-1 · temperaturas · $otra");
// Métricas calculadas: precedencia, unario, potencia a la derecha, funciones y errores (decimal con punto: la coma separa argumentos).
const ev = (s: string, vars: Record<string, number> = {}) => evalExpr(parseExpr(s), vars);
assert.equal(ev("2 + 3 * 4"), 14);
assert.equal(ev("(2 + 3) * 4"), 20);
assert.equal(ev("-2 ^ 2"), -4);
assert.equal(ev("2 ^ 3 ^ 2"), 512);
assert.equal(ev("A * B", { A: 220, B: 0.5 }), 110); // potencia = voltaje × corriente
assert.equal(ev("1.5 + max(A,2,7) - abs(-1)", { A: 3 }), 7.5);
for (const bad of ["", "A +", "(A", "foo(A)", "temp * 2", "max()", "sqrt(1, 2)", "A $ B", "2 2"])
  assert.throws(() => parseExpr(bad), ExprError, bad);
// Índice de calor de la NOAA: 90 °F y 70 % -> 106 °F (41,1 °C); con calor bajo ≈ la temperatura.
assert.ok(Math.abs(heatIndex(32.22, 70) - 41.1) < 0.4, String(heatIndex(32.22, 70)));
assert.ok(Math.abs(heatIndex(20, 50) - 20) < 1, String(heatIndex(20, 50)));
assert.ok(Math.abs(dewPoint(25, 60) - 16.7) < 0.1, String(dewPoint(25, 60)));
// Fórmula sobre dos consultas: solo donde ambas tienen dato; división por cero -> sin dato; consulta oculta.
const ts = [at(0), at(60), at(120)];
const { results: rs, targets: tg } = withExpressions(
  [
    { device: "d", metric: "v", agg: "avg", hidden: true },
    { device: "d", metric: "i", agg: "avg" },
    { device: "", metric: "", agg: "avg", expr: "A / B", alias: "R" },
  ],
  [0, 1],
  [
    { device: "d", metric: "v", agg: "avg", points: [[ts[0], 10], [ts[1], 12], [ts[2], 9]] },
    { device: "d", metric: "i", agg: "avg", points: [[ts[0], 2], [ts[1], 0]] },
  ],
);
assert.deepEqual(tg.map((t) => t.alias ?? t.metric), ["i", "R"]);
assert.deepEqual(rs[1].points, [[ts[0], 5], [ts[1], null], [ts[2], null]]);
assert.equal(exprError([{ device: "", metric: "", agg: "avg", expr: "A + C" }, { device: "d", metric: "m", agg: "avg" }], 0), "A es esta misma fórmula");
console.log("ok");
