import type { Frame, Layer, Stroke } from "@gas/core";
import { drawStrokes, type Ctx2D, type ScratchProvider } from "./stroke";

export interface ComposeOptions {
  /** Tamaño del lienzo de destino en píxeles. */
  pixelWidth: number;
  pixelHeight: number;
  /** Píxeles por unidad del proyecto. */
  scale: number;
  /** Color de fondo opaco, o null para dejar el fondo transparente. */
  background: string | null;
  /** Lienzos temporales: uno para aislar cada capa y otro para los trazos translúcidos. */
  layerScratch: ScratchProvider;
  opacityScratch: ScratchProvider;
  /** Opcional: si devuelve un mapa de bits ya pintado de la capa, se reduce en vez de volver a pintar los vectores. */
  layerSource?: (strokes: readonly Stroke[]) => unknown | null;
}

/**
 * Compone un fotograma: fondo, y después cada capa VISIBLE de abajo a arriba, con sus trazos en orden.
 * Cada capa se pinta aislada (el borrador solo afecta a su capa) y luego se compone con el resto.
 * Es la ÚNICA implementación de «cómo se ve un fotograma»: la usan el editor (miniaturas, papel cebolla)
 * y el exportador, de modo que lo exportado se pinta con el mismo código que lo que ves.
 * `ctx` debe tener la transformación identidad.
 */
export function composeFrame(ctx: Ctx2D, layers: readonly Layer[], frame: Frame, o: ComposeOptions): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  if (o.background) {
    ctx.fillStyle = o.background;
    ctx.fillRect(0, 0, o.pixelWidth, o.pixelHeight);
  }
  ctx.restore();
  for (const layer of layers) {
    if (!layer.visible) continue;
    const strokes = frame.cells[layer.id];
    if (!strokes || strokes.length === 0) continue;
    const ready = o.layerSource?.(strokes);
    if (ready) {
      ctx.drawImage(ready, 0, 0, o.pixelWidth, o.pixelHeight);
      continue;
    }
    const tmp = o.layerScratch(o.pixelWidth, o.pixelHeight);
    tmp.ctx.setTransform(1, 0, 0, 1, 0, 0);
    tmp.ctx.globalCompositeOperation = "source-over";
    tmp.ctx.globalAlpha = 1;
    tmp.ctx.clearRect(0, 0, o.pixelWidth, o.pixelHeight);
    drawStrokes(tmp.ctx, strokes, { pixelWidth: o.pixelWidth, pixelHeight: o.pixelHeight, scale: o.scale, scratch: o.opacityScratch });
    ctx.drawImage(tmp.canvas, 0, 0);
  }
}
