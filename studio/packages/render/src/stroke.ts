import type { Stroke } from "@gas/core";

/** Subconjunto de CanvasRenderingContext2D que usamos: sirve tanto en el navegador como en Node (@napi-rs/canvas). */
export interface Ctx2D {
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  strokeStyle: string | object;
  fillStyle: string | object;
  globalAlpha: number;
  globalCompositeOperation: string;
  save(): void;
  restore(): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  fill(): void;
  stroke(): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(image: unknown, ...args: number[]): void;
}

export interface CanvasHandle {
  canvas: unknown;
  ctx: Ctx2D;
}

/** Devuelve un lienzo temporal de al menos w×h píxeles (puede reutilizarse entre llamadas). */
export type ScratchProvider = (w: number, h: number) => CanvasHandle;

export interface DrawOptions {
  /** Tamaño del lienzo en píxeles del dispositivo (no en unidades del proyecto). */
  pixelWidth: number;
  pixelHeight: number;
  /** Píxeles por unidad del proyecto. */
  scale: number;
  scratch: ScratchProvider;
}

const pointCount = (s: Stroke) => s.points.length / 3;

/** Ancho en el punto `i`: size · (1 − sens · (1 − presión)). */
export function widthAt(s: Stroke, i: number): number {
  const p = s.points[i * 3 + 2]!;
  return Math.max(0.1, s.size * (1 - s.sens * (1 - p)));
}

function setupInk(ctx: Ctx2D, s: Stroke): void {
  const color = s.kind === "eraser" ? "#000000" : s.color;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

/**
 * Pinta, sin opacidad ni composición, los tramos [from, to) del trazo.
 * Tramo i = curva cuadrática de mid(p[i-1],p[i]) a mid(p[i],p[i+1]) con control en p[i]
 * (los extremos arrancan/terminan en el primer/último punto). Un trazo de 1 punto es un círculo.
 * El llamador fija la transformación y la composición. Sirve para dibujar el trazo «en vivo» punto a punto.
 */
export function paintPieces(ctx: Ctx2D, s: Stroke, from: number, to: number): void {
  const n = pointCount(s);
  const p = s.points;
  setupInk(ctx, s);
  if (s.kind === "fill") {
    if (from <= 0) paintFill(ctx, s);
    return;
  }
  if (n === 1) {
    if (from <= 0 && to >= 1) {
      ctx.beginPath();
      ctx.arc(p[0]!, p[1]!, widthAt(s, 0) / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  // Los tramos consecutivos con (casi) el mismo grosor se agrupan en UN trazado: mucho más rápido que
  // un stroke() por tramo (un trazo de ratón/dedo, con grosor constante, es una sola llamada).
  const end = Math.min(n, to);
  let i = Math.max(0, from);
  while (i < end) {
    const w = widthAt(s, i);
    let j = i + 1;
    while (j < end && Math.abs(widthAt(s, j) - w) <= WIDTH_TOLERANCE) j++;
    ctx.lineWidth = w;
    ctx.beginPath();
    const sx = i === 0 ? p[0]! : (p[(i - 1) * 3]! + p[i * 3]!) / 2;
    const sy = i === 0 ? p[1]! : (p[(i - 1) * 3 + 1]! + p[i * 3 + 1]!) / 2;
    ctx.moveTo(sx, sy);
    for (let k = i; k < j; k++) {
      const cx = p[k * 3]!;
      const cy = p[k * 3 + 1]!;
      const ex = k === n - 1 ? cx : (cx + p[(k + 1) * 3]!) / 2;
      const ey = k === n - 1 ? cy : (cy + p[(k + 1) * 3 + 1]!) / 2;
      ctx.quadraticCurveTo(cx, cy, ex, ey);
    }
    ctx.stroke();
    i = j;
  }
}

/** Forma cerrada rellena: curva cuadrática por los puntos medios (misma suavidad que los trazos), cerrada. */
export function paintFill(ctx: Ctx2D, s: Stroke): void {
  const p = s.points;
  const n = p.length / 3;
  if (n < 3) return;
  const mx = (i: number) => (p[(i % n) * 3]! + p[((i + 1) % n) * 3]!) / 2;
  const my = (i: number) => (p[(i % n) * 3 + 1]! + p[((i + 1) % n) * 3 + 1]!) / 2;
  ctx.beginPath();
  ctx.moveTo(mx(n - 1), my(n - 1));
  for (let i = 0; i < n; i++) ctx.quadraticCurveTo(p[i * 3]!, p[i * 3 + 1]!, mx(i), my(i));
  ctx.fill();
}

/** Diferencia de grosor (px) por debajo de la cual dos tramos seguidos se dibujan con el mismo trazado. */
export const WIDTH_TOLERANCE = 0.3;

function strokePixelBounds(s: Stroke, scale: number, w: number, h: number) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < s.points.length; i += 3) {
    x0 = Math.min(x0, s.points[i]!);
    x1 = Math.max(x1, s.points[i]!);
    y0 = Math.min(y0, s.points[i + 1]!);
    y1 = Math.max(y1, s.points[i + 1]!);
  }
  const r = s.size / 2 + 2;
  const px0 = Math.max(0, Math.floor((x0 - r) * scale));
  const py0 = Math.max(0, Math.floor((y0 - r) * scale));
  const px1 = Math.min(w, Math.ceil((x1 + r) * scale));
  const py1 = Math.min(h, Math.ceil((y1 + r) * scale));
  return { x: px0, y: py0, w: Math.max(0, px1 - px0), h: Math.max(0, py1 - py0) };
}

/**
 * Compone `source` (un lienzo con SOLO el trazo opaco, ya pintado) sobre `ctx` con la opacidad y
 * el modo del trazo: pluma = source-over, borrador = destination-out. `ctx` en píxeles (identidad).
 */
export function compositeInk(
  ctx: Ctx2D,
  source: unknown,
  s: Pick<Stroke, "kind" | "opacity">,
  region?: { x: number; y: number; w: number; h: number },
  /** Esquina de `source` donde empieza la región (por defecto, la misma posición que en el destino). */
  from: { x: number; y: number } | undefined = region,
): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = s.kind === "eraser" ? "destination-out" : "source-over";
  ctx.globalAlpha = s.opacity;
  if (region && from) ctx.drawImage(source, from.x, from.y, region.w, region.h, region.x, region.y, region.w, region.h);
  else ctx.drawImage(source, 0, 0);
  ctx.restore();
}

/** Tamaño del lienzo temporal: potencia de 2 (pocos tamaños distintos que reutilizar), sin pasar del lienzo. */
const bucket = (n: number, max: number) => Math.min(max, Math.max(64, 2 ** Math.ceil(Math.log2(Math.max(1, n)))));

/** Pinta un trazo completo sobre `ctx`. Si su opacidad < 1 usa un lienzo temporal para que no se acumule al cruzarse. */
export function drawStroke(ctx: Ctx2D, s: Stroke, o: DrawOptions): void {
  const n = pointCount(s);
  if (s.opacity <= 0) return;
  if (s.opacity >= 0.999) {
    ctx.save();
    ctx.setTransform(o.scale, 0, 0, o.scale, 0, 0);
    ctx.globalCompositeOperation = s.kind === "eraser" ? "destination-out" : "source-over";
    ctx.globalAlpha = 1;
    paintPieces(ctx, s, 0, n);
    ctx.restore();
    return;
  }
  const region = strokePixelBounds(s, o.scale, o.pixelWidth, o.pixelHeight);
  if (region.w === 0 || region.h === 0) return;
  // El lienzo temporal solo mide lo que el trazo: copiar un lienzo entero por cada trazo translúcido
  // costaba ~16 ms en un móvil de gama media (el navegador materializa el lienzo origen en cada uso).
  const tmp = o.scratch(bucket(region.w, o.pixelWidth), bucket(region.h, o.pixelHeight));
  tmp.ctx.save();
  tmp.ctx.setTransform(1, 0, 0, 1, 0, 0);
  tmp.ctx.globalCompositeOperation = "source-over";
  tmp.ctx.globalAlpha = 1;
  tmp.ctx.clearRect(0, 0, region.w, region.h);
  tmp.ctx.setTransform(o.scale, 0, 0, o.scale, -region.x, -region.y);
  paintPieces(tmp.ctx, s, 0, n);
  tmp.ctx.restore();
  compositeInk(ctx, tmp.canvas, s, region, { x: 0, y: 0 });
}

/** Pinta una lista de trazos en orden. */
export function drawStrokes(ctx: Ctx2D, strokes: readonly Stroke[], o: DrawOptions): void {
  for (const s of strokes) drawStroke(ctx, s, o);
}
