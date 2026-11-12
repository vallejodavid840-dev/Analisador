import type { Frame, Layer, Stroke } from "@gas/core";
import { clipBaseIndex, clipToMask, drawLayerImage, type FxCtx } from "./layer";
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
  /** Copia de la capa base cuando la siguiente recorta a ella (Fase 4). Sin él, las capas con recorte no se recortan. */
  maskScratch?: ScratchProvider;
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
  let mask: unknown | null = null;
  const W = o.pixelWidth;
  const H = o.pixelHeight;
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]!;
    const clipped = layer.clip === true && clipBaseIndex(layers, i) >= 0;
    if (!clipped) mask = null;
    if (!layer.visible) continue;
    const strokes = frame.cells[layer.id];
    if (!strokes || strokes.length === 0) continue;
    const ready = o.layerSource?.(strokes);
    const feedsClip = !clipped && layers[i + 1]?.clip === true;
    if (ready && !clipped) {
      drawLayerImage(ctx as FxCtx, ready, layer, W, H, o.scale);
      if (feedsClip) mask = ready;
      continue;
    }
    const tmp = o.layerScratch(W, H);
    tmp.ctx.setTransform(1, 0, 0, 1, 0, 0);
    tmp.ctx.globalCompositeOperation = "source-over";
    tmp.ctx.globalAlpha = 1;
    tmp.ctx.clearRect(0, 0, W, H);
    if (ready) tmp.ctx.drawImage(ready, 0, 0, W, H);
    else drawStrokes(tmp.ctx, strokes, { pixelWidth: W, pixelHeight: H, scale: o.scale, scratch: o.opacityScratch });
    if (clipped) {
      if (!mask) continue; // la base está vacía u oculta: no hay nada a lo que recortar
      clipToMask(tmp.ctx, mask, W, H);
    } else if (feedsClip && o.maskScratch) {
      const m = o.maskScratch(W, H);
      m.ctx.setTransform(1, 0, 0, 1, 0, 0);
      m.ctx.globalCompositeOperation = "source-over";
      m.ctx.globalAlpha = 1;
      m.ctx.clearRect(0, 0, W, H);
      m.ctx.drawImage(tmp.canvas, 0, 0);
      mask = m.canvas;
    }
    drawLayerImage(ctx as FxCtx, tmp.canvas, layer, W, H, o.scale);
  }
}
