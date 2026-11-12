import { shortId, type Stroke } from "@gas/core";

export type P = [number, number];

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Forma cerrada rellena. */
export function fill(color: string, pts: readonly P[], opacity = 1): Stroke {
  return { id: shortId(), kind: "fill", color, size: 1, opacity, sens: 0, points: pts.flatMap(([x, y]) => [r1(x), r1(y), 1]) };
}

export type Taper = "none" | "both" | "start" | "end";

/** Línea de tinta. `taper` afina los extremos con la presión (como una pluma real); `size` es el grosor máximo. */
export function line(color: string, size: number, pts: readonly P[], o: { taper?: Taper; opacity?: number; closed?: boolean } = {}): Stroke {
  const taper = o.taper ?? "none";
  const src = o.closed && pts.length > 0 ? [...pts, pts[0]!] : pts;
  const n = src.length;
  const flat: number[] = [];
  src.forEach(([x, y], i) => {
    const t = n <= 1 ? 0.5 : i / (n - 1);
    let p = 1;
    if (taper === "both") p = Math.max(0.12, Math.pow(Math.sin(Math.PI * t), 0.55));
    else if (taper === "start") p = Math.max(0.12, Math.pow(Math.sin((Math.PI * t) / 2), 0.8));
    else if (taper === "end") p = Math.max(0.12, Math.pow(Math.cos((Math.PI * t) / 2), 0.8));
    flat.push(r1(x), r1(y), Math.round(p * 100) / 100);
  });
  if (n === 1) flat.push(r1(src[0]![0]) + 0.01, r1(src[0]![1]), flat[2]!);
  return { id: shortId(), kind: "pen", color, size, opacity: o.opacity ?? 1, sens: taper === "none" ? 0 : 1, points: flat };
}

/** Catmull-Rom: pasa por los puntos dados. `per` = subdivisiones por tramo. */
export function spline(pts: readonly P[], closed = false, per = 6): P[] {
  const n = pts.length;
  if (n < 3) return [...pts];
  const at = (i: number): P => (closed ? pts[((i % n) + n) % n]! : pts[Math.min(n - 1, Math.max(0, i))]!);
  const out: P[] = [];
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  if (!closed) out.push(pts[n - 1]!);
  return out;
}

export const mirror = (pts: readonly P[], cx: number): P[] => pts.map(([x, y]) => [2 * cx - x, y]);
export const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
export const mul = (a: P, k: number): P => [a[0] * k, a[1] * k];
export const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const len = (a: P) => Math.hypot(a[0], a[1]);
export const norm = (a: P): P => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
export const perp = (a: P): P => [-a[1], a[0]];
export const rot = (a: P, rad: number): P => [a[0] * Math.cos(rad) - a[1] * Math.sin(rad), a[0] * Math.sin(rad) + a[1] * Math.cos(rad)];

/** Elipse (polígono). */
export function ellipse(cx: number, cy: number, rx: number, ry: number, n = 28, rotRad = 0): P[] {
  const out: P[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * rx, y = Math.sin(a) * ry;
    out.push([cx + x * Math.cos(rotRad) - y * Math.sin(rotRad), cy + x * Math.sin(rotRad) + y * Math.cos(rotRad)]);
  }
  return out;
}

/** Generador pseudoaleatorio determinista (mulberry32): el mismo número da el mismo peinado. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ───── Color ───── */
export function parseHex(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
export function toHex(c: readonly [number, number, number]): string {
  return `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
}
export function mix(a: string, b: string, t: number): string {
  const x = parseHex(a), y = parseHex(b);
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}
/** Tono de sombra: más oscuro y desplazado a un frío violeta (acabado de anime), no simplemente negro. */
export const shade = (c: string, k = 0.35) => mix(mix(c, "#2a2350", 0.28), "#000000", k * 0.5);
export const tint = (c: string, k = 0.3) => mix(c, "#ffffff", k);
/** Color de la línea de contorno de una zona: versión muy oscura de su propio color. */
export const outlineOf = (c: string) => mix(c, "#14101a", 0.78);

/** Contorno de un «tubo»: polilínea central con semianchos (px) → polígono cerrado. */
export function tubePoly(center: readonly P[], half: readonly number[]): { poly: P[]; left: P[]; right: P[] } {
  const left: P[] = [], right: P[] = [];
  center.forEach((c, i) => {
    const a = center[Math.max(0, i - 1)]!, b = center[Math.min(center.length - 1, i + 1)]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / l, ny = (b[0] - a[0]) / l;
    left.push([c[0] + nx * half[i]!, c[1] + ny * half[i]!]);
    right.push([c[0] - nx * half[i]!, c[1] - ny * half[i]!]);
  });
  return { poly: [...left, ...[...right].reverse()], left, right };
}
