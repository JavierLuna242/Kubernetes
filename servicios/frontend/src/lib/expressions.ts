// Métricas calculadas: fórmulas sobre las consultas del panel (A, B, C… por orden), ej. "A * B" o
// "sensacion_termica(A, B)". Intérprete propio (sin eval): solo números, letras de consulta, + - * / ^ % y
// las funciones de FUNCS. Se evalúa punto a punto sobre los intervalos que comparten todas las consultas.
import type { SeriesResult, Target } from "./api";
import { PALETTE } from "./format";

/** Sensación térmica (índice de calor de la NOAA) en °C, a partir de temperatura en °C y humedad relativa en %. */
export function heatIndex(t: number, rh: number) {
  const f = (t * 9) / 5 + 32;
  let hi = 0.5 * (f + 61 + (f - 68) * 1.2 + rh * 0.094); // fórmula simple, válida con calor bajo
  if ((hi + f) / 2 >= 80) {
    hi = -42.379 + 2.04901523 * f + 10.14333127 * rh - 0.22475541 * f * rh - 0.00683783 * f * f -
      0.05481717 * rh * rh + 0.00122874 * f * f * rh + 0.00085282 * f * rh * rh - 0.00000199 * f * f * rh * rh;
    if (rh < 13 && f >= 80 && f <= 112) hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(f - 95)) / 17);
    else if (rh > 85 && f >= 80 && f <= 87) hi += ((rh - 85) / 10) * ((87 - f) / 5);
  }
  return ((hi - 32) * 5) / 9;
}

/** Punto de rocío en °C (fórmula de Magnus). */
export function dewPoint(t: number, rh: number) {
  const a = 17.62, b = 243.12;
  const g = Math.log(Math.max(rh, 1e-6) / 100) + (a * t) / (b + t);
  return (b * g) / (a - g);
}

const FUNCS: Record<string, [arity: number | "n", fn: (...a: number[]) => number, help: string]> = {
  sensacion_termica: [2, heatIndex, "sensación térmica (°C) de temperatura y humedad"],
  punto_rocio: [2, dewPoint, "punto de rocío (°C) de temperatura y humedad"],
  sqrt: [1, Math.sqrt, "raíz cuadrada"],
  abs: [1, Math.abs, "valor absoluto"],
  round: [1, Math.round, "redondear"],
  floor: [1, Math.floor, "redondear hacia abajo"],
  ceil: [1, Math.ceil, "redondear hacia arriba"],
  exp: [1, Math.exp, "e elevado a x"],
  log: [1, Math.log, "logaritmo natural"],
  log10: [1, Math.log10, "logaritmo base 10"],
  pow: [2, Math.pow, "potencia"],
  min: ["n", Math.min, "mínimo"],
  max: ["n", Math.max, "máximo"],
};
export const FUNCTION_HELP = Object.entries(FUNCS).map(([name, [, , help]]) => ({ name, help }));

type Node =
  | { k: "num"; v: number }
  | { k: "var"; name: string }
  | { k: "neg"; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "call"; fn: string; args: Node[] };

export class ExprError extends Error {}

function tokenize(src: string) {
  const out: string[] = [];
  const re = /\s*(\d+(?:\.\d+)?(?:e[+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|[-+*/^%(),])/y;
  let m: RegExpExecArray | null;
  while (re.lastIndex < src.length && (m = re.exec(src))) out.push(m[1]);
  if (src.slice(re.lastIndex).trim()) throw new ExprError(`Carácter no válido: "${src.slice(re.lastIndex).trim()[0]}"`);
  return out;
}

/** Convierte la fórmula en un árbol. Lanza ExprError con un mensaje legible si está mal escrita. */
export function parseExpr(src: string): Node {
  const toks = tokenize(src);
  if (!toks.length) throw new ExprError("La fórmula está vacía");
  let i = 0;
  const peek = () => toks[i];
  const take = (t?: string) => {
    if (t && toks[i] !== t) throw new ExprError(toks[i] ? `Se esperaba "${t}" y hay "${toks[i]}"` : `Falta "${t}" al final`);
    return toks[i++];
  };
  // Precedencia: + - < * / % < unario < ^ (asociativo a la derecha)
  const expr = (): Node => {
    let a = term();
    while (peek() === "+" || peek() === "-") a = { k: "bin", op: take(), a, b: term() };
    return a;
  };
  const term = (): Node => {
    let a = unary();
    while (peek() === "*" || peek() === "/" || peek() === "%") a = { k: "bin", op: take(), a, b: unary() };
    return a;
  };
  const unary = (): Node => (peek() === "-" ? (take(), { k: "neg", a: unary() }) : peek() === "+" ? (take(), unary()) : power());
  const power = (): Node => {
    const a = atom();
    return peek() === "^" ? (take(), { k: "bin", op: "^", a, b: unary() }) : a;
  };
  const atom = (): Node => {
    const t = take();
    if (t === undefined) throw new ExprError("La fórmula termina antes de tiempo");
    if (/^\d/.test(t)) return { k: "num", v: Number(t) };
    if (t === "(") {
      const e = expr();
      take(")");
      return e;
    }
    if (/^[A-Za-z_]/.test(t)) {
      if (peek() === "(") {
        const fn = t.toLowerCase();
        if (!FUNCS[fn]) throw new ExprError(`Función desconocida: ${t}`);
        take("(");
        const args: Node[] = [];
        if (peek() !== ")") {
          args.push(expr());
          while (peek() === ",") (take(), args.push(expr()));
        }
        take(")");
        const arity = FUNCS[fn][0];
        if (arity === "n" ? args.length < 1 : args.length !== arity)
          throw new ExprError(`${fn} necesita ${arity === "n" ? "al menos 1" : arity} argumento${arity === 1 ? "" : "s"}`);
        return { k: "call", fn, args };
      }
      if (t === "pi" || t === "PI") return { k: "num", v: Math.PI };
      if (!/^[A-Z]$/.test(t)) throw new ExprError(`"${t}" no es una consulta: usa letras mayúsculas (A, B, C…)`);
      return { k: "var", name: t };
    }
    throw new ExprError(`No se esperaba "${t}"`);
  };
  const tree = expr();
  if (i < toks.length) throw new ExprError(`No se esperaba "${toks[i]}"`);
  return tree;
}

export function exprVars(n: Node, out = new Set<string>()): Set<string> {
  if (n.k === "var") out.add(n.name);
  else if (n.k === "neg") exprVars(n.a, out);
  else if (n.k === "bin") (exprVars(n.a, out), exprVars(n.b, out));
  else if (n.k === "call") n.args.forEach((a) => exprVars(a, out));
  return out;
}

export function evalExpr(n: Node, vars: Record<string, number>): number {
  switch (n.k) {
    case "num":
      return n.v;
    case "var":
      return vars[n.name];
    case "neg":
      return -evalExpr(n.a, vars);
    case "call":
      return FUNCS[n.fn][1](...n.args.map((a) => evalExpr(a, vars)));
    case "bin": {
      const a = evalExpr(n.a, vars), b = evalExpr(n.b, vars);
      return n.op === "+" ? a + b : n.op === "-" ? a - b : n.op === "*" ? a * b : n.op === "/" ? a / b : n.op === "%" ? a % b : a ** b;
    }
  }
}

/** Letra de la consulta i (A, B, … Z). */
export const letter = (i: number) => String.fromCharCode(65 + i);

/** Error de una fórmula del panel, o null si es válida (incluye consultas inexistentes o recursivas). */
export function exprError(targets: Target[], i: number): string | null {
  try {
    const used = exprVars(parseExpr(targets[i].expr ?? ""));
    for (const v of used) {
      const j = v.charCodeAt(0) - 65;
      if (j === i) return `${v} es esta misma fórmula`;
      if (!targets[j]) return `No existe la consulta ${v}`;
      if (targets[j].expr) return `${v} es otra fórmula: solo se pueden usar consultas de datos`;
    }
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/**
 * Resultados del back (de las consultas de datos, en orden) -> resultados de todas las filas del panel
 * (consultas y fórmulas), en el orden del panel y sin las ocultas. Devuelve también sus Target para la leyenda.
 */
export function withExpressions(targets: Target[], queryIdx: number[], results: SeriesResult[]) {
  const byLetter = new Map<string, Map<string, number | null>>();
  queryIdx.forEach((ti, k) => results[k] && byLetter.set(letter(ti), new Map(results[k].points)));
  const outResults: SeriesResult[] = [];
  const outTargets: Target[] = [];
  targets.forEach((t, i) => {
    let r: SeriesResult | undefined;
    if (t.expr !== undefined) {
      if (exprError(targets, i)) return;
      const tree = parseExpr(t.expr);
      const used = [...exprVars(tree)];
      const series = used.map((v) => byLetter.get(v)).filter((s): s is Map<string, number | null> => !!s);
      if (series.length !== used.length) return; // alguna consulta de la fórmula no es válida todavía
      const times = [...new Set(series.flatMap((s) => [...s.keys()]))].sort();
      const points = times.map((ts): [string, number | null] => {
        const vars: Record<string, number> = {};
        for (const [k, v] of used.entries()) {
          const x = series[k].get(ts);
          if (x == null) return [ts, null];
          vars[v] = x;
        }
        const y = evalExpr(tree, vars);
        return [ts, Number.isFinite(y) ? y : null];
      });
      r = { device: "ƒ", metric: t.expr, agg: "avg", points };
    } else {
      const k = queryIdx.indexOf(i);
      r = k >= 0 ? results[k] : undefined;
    }
    if (r && !t.hidden) {
      outResults.push(r);
      // Color por la posición en el panel (como en el editor), aunque haya filas ocultas antes.
      outTargets.push({ ...t, color: t.color ?? PALETTE[i % PALETTE.length], alias: t.alias || (t.expr !== undefined ? t.expr : undefined) });
    }
  });
  return { results: outResults, targets: outTargets };
}
