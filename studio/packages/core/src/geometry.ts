import type { Stroke } from "./animation";

/** Matriz afín 2D [a b c d e f]: x' = a·x + c·y + e ; y' = b·x + d·y + f (convención de Canvas2D). */
export interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** m1 · m2: aplica primero m2 y luego m1. */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

export const translation = (dx: number, dy: number): Matrix => ({ ...IDENTITY, e: dx, f: dy });

export function scaleAbout(sx: number, sy: number, cx: number, cy: number): Matrix {
  return { a: sx, b: 0, c: 0, d: sy, e: cx - sx * cx, f: cy - sy * cy };
}

export function rotateAbout(rad: number, cx: number, cy: number): Matrix {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { a: cos, b: sin, c: -sin, d: cos, e: cx - cos * cx + sin * cy, f: cy - sin * cx - cos * cy };
}

export function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Caja que contiene el trazo, incluyendo su grosor. */
export function strokeBounds(s: Stroke): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const p = s.points;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i]!;
    const y = p[i + 1]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const r = s.size / 2;
  return { x: minX - r, y: minY - r, w: maxX - minX + s.size, h: maxY - minY + s.size };
}

export function unionBounds(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** ¿El punto (x,y) toca el trazo? `tolerance` ensancha la zona (útil con el dedo). */
export function hitStroke(s: Stroke, x: number, y: number, tolerance = 0): boolean {
  const p = s.points;
  const r = s.size / 2 + tolerance;
  if (s.kind === "fill") {
    // dentro del contorno (par-impar) o a menos de `tolerance` de su borde
    const n = p.length / 3;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = p[i * 3]!, yi = p[i * 3 + 1]!, xj = p[j * 3]!, yj = p[j * 3 + 1]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      if (!inside && distToSegment(x, y, xi, yi, xj, yj) <= tolerance) return true;
    }
    return inside;
  }
  if (p.length === 3) return Math.hypot(x - p[0]!, y - p[1]!) <= r;
  for (let i = 0; i + 5 < p.length; i += 3) {
    if (distToSegment(x, y, p[i]!, p[i + 1]!, p[i + 3]!, p[i + 4]!) <= r) return true;
  }
  return false;
}

/** Aplica una matriz al trazo. El grosor escala con √|det| (escala media). */
export function transformStroke(s: Stroke, m: Matrix): Stroke {
  const out = new Array<number>(s.points.length);
  for (let i = 0; i < s.points.length; i += 3) {
    const [x, y] = apply(m, s.points[i]!, s.points[i + 1]!);
    out[i] = Math.round(x * 100) / 100;
    out[i + 1] = Math.round(y * 100) / 100;
    out[i + 2] = s.points[i + 2]!;
  }
  const k = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
  return { ...s, points: out, size: Math.min(2000, Math.max(0.1, s.size * k)) };
}
