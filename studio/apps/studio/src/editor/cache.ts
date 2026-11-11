import type { Animation, Frame, Stroke } from "@gas/core";
import { strokesOf } from "@gas/engine";
import { drawStrokes, type CanvasHandle, type Ctx2D, type ScratchProvider } from "@gas/render";

export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export const ctxOf = (c: HTMLCanvasElement): Ctx2D => c.getContext("2d") as unknown as Ctx2D;

/** Lienzos temporales reutilizables, uno por (uso, tamaño). Evita crear megapíxeles en cada trazo. */
function pooled(kind: string): ScratchProvider {
  const pool = new Map<string, CanvasHandle>();
  return (w, h) => {
    const key = `${kind}:${w}x${h}`;
    let hnd = pool.get(key);
    if (!hnd) {
      const canvas = createCanvas(w, h);
      hnd = { canvas, ctx: ctxOf(canvas) };
      pool.set(key, hnd);
    }
    return hnd;
  };
}
/** Para trazos con opacidad < 1 (dentro de drawStrokes). */
export const opacityScratch = pooled("opacity");
/** Para aislar cada capa al componer un fotograma (el borrador solo afecta a su capa). */
export const layerScratch = pooled("layer");
/** Para el borrador en vivo. */
export const liveScratch = pooled("live");
/** Lienzo del trazo en vivo (se reutiliza entre trazos). */
export const liveInk = pooled("ink");

/** Resolución interna de los mapas de bits: la del proyecto, con tope de 2048 px en el lado largo. */
export const cacheScaleFor = (doc: Pick<Animation, "width" | "height">) => Math.min(1, 2048 / Math.max(doc.width, doc.height));

const isMobile = () => matchMedia("(pointer: coarse)").matches;

/**
 * Caché de mapas de bits por capa y fotograma, con presupuesto de memoria (LRU).
 * La clave es la IDENTIDAD del array de trazos: como el motor es inmutable, array nuevo = contenido nuevo.
 */
export class LayerCache {
  private map = new Map<readonly Stroke[], { canvas: HTMLCanvasElement; bytes: number }>();
  private total = 0;
  constructor(private readonly budgetBytes = isMobile() ? 128 * 2 ** 20 : 320 * 2 ** 20) {}

  get size(): number {
    return this.map.size;
  }

  private put(strokes: readonly Stroke[], canvas: HTMLCanvasElement): void {
    const bytes = canvas.width * canvas.height * 4;
    this.map.set(strokes, { canvas, bytes });
    this.total += bytes;
    for (const [k, v] of this.map) {
      if (this.total <= this.budgetBytes || k === strokes) break;
      this.map.delete(k);
      this.total -= v.bytes;
    }
  }

  /** Mapa de bits ya existente (sin crearlo ni alterar el orden de uso). */
  peek(strokes: readonly Stroke[]): HTMLCanvasElement | null {
    return this.map.get(strokes)?.canvas ?? null;
  }

  /** Mapa de bits de la capa (null si no tiene trazos). Lo crea si no está en caché. */
  get(strokes: readonly Stroke[], doc: Animation): HTMLCanvasElement | null {
    if (strokes.length === 0) return null;
    const hit = this.map.get(strokes);
    if (hit) {
      this.map.delete(strokes);
      this.map.set(strokes, hit); // más reciente
      return hit.canvas;
    }
    const cs = cacheScaleFor(doc);
    const canvas = createCanvas(doc.width * cs, doc.height * cs);
    drawStrokes(ctxOf(canvas), strokes, { pixelWidth: canvas.width, pixelHeight: canvas.height, scale: cs, scratch: opacityScratch });
    this.put(strokes, canvas);
    return canvas;
  }

  /** Mapa de bits editable de `strokes` (en blanco si estaba vacío). Se reutiliza como el de `next`. */
  adopt(strokes: readonly Stroke[], next: readonly Stroke[], doc: Animation): HTMLCanvasElement {
    let canvas: HTMLCanvasElement;
    const hit = this.map.get(strokes);
    if (hit) {
      this.map.delete(strokes);
      this.total -= hit.bytes;
      canvas = hit.canvas;
    } else if (strokes.length > 0) {
      canvas = this.get(strokes, doc)!;
      this.map.delete(strokes);
      this.total -= canvas.width * canvas.height * 4;
    } else {
      const cs = cacheScaleFor(doc);
      canvas = createCanvas(doc.width * cs, doc.height * cs);
    }
    this.put(next, canvas);
    return canvas;
  }

  clear(): void {
    this.map.clear();
    this.total = 0;
  }
}

const frameImages = new WeakMap<Frame, Map<string, HTMLCanvasElement>>();

export interface FrameImageOptions {
  scale: number;
  /** Recolorea todo lo dibujado con este color (papel cebolla). */
  tint?: string;
  /** Fondo opaco (miniaturas). */
  background?: string;
  /** Si devuelve el mapa de bits ya dibujado de una capa, se reduce en vez de volver a pintar los vectores. */
  layerSource?: (strokes: readonly Stroke[]) => HTMLCanvasElement | null;
}

/** Fotograma completo (capas visibles) como imagen, cacheado por identidad del fotograma. */
export function frameImage(doc: Animation, frame: Frame, o: FrameImageOptions): HTMLCanvasElement {
  const sig = `${doc.layers.map((l) => (l.visible ? l.id : "-")).join(",")}|${o.scale}|${o.tint ?? ""}|${o.background ?? ""}`;
  let per = frameImages.get(frame);
  if (!per) frameImages.set(frame, (per = new Map()));
  const hit = per.get(sig);
  if (hit) return hit;
  if (per.size >= 4) per.clear();

  const w = Math.ceil(doc.width * o.scale);
  const h = Math.ceil(doc.height * o.scale);
  const out = createCanvas(w, h);
  const octx = ctxOf(out);
  if (o.background) {
    octx.fillStyle = o.background;
    (octx as unknown as CanvasRenderingContext2D).fillRect(0, 0, w, h);
  }
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    const strokes = strokesOf(frame, layer.id);
    if (strokes.length === 0) continue;
    const ready = o.layerSource?.(strokes);
    if (ready) {
      octx.drawImage(ready, 0, 0, w, h);
      continue;
    }
    const tmp = layerScratch(w, h);
    tmp.ctx.setTransform(1, 0, 0, 1, 0, 0);
    tmp.ctx.globalCompositeOperation = "source-over";
    tmp.ctx.globalAlpha = 1;
    tmp.ctx.clearRect(0, 0, w, h);
    drawStrokes(tmp.ctx, strokes, { pixelWidth: w, pixelHeight: h, scale: o.scale, scratch: opacityScratch });
    octx.drawImage(tmp.canvas, 0, 0);
  }
  if (o.tint) {
    octx.globalCompositeOperation = "source-in";
    octx.fillStyle = o.tint;
    (octx as unknown as CanvasRenderingContext2D).fillRect(0, 0, w, h);
    octx.globalCompositeOperation = "source-over";
  }
  per.set(sig, out);
  return out;
}
