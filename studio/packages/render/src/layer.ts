import type { Layer } from "@gas/core";
import type { Ctx2D } from "./stroke";

/** Modo de composición de Canvas2D para cada modo de mezcla de capa. */
const BLEND: Record<NonNullable<Layer["blend"]>, string> = {
  normal: "source-over",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  add: "lighter",
};

/** ¿La capa necesita algo más que «dibujarla tal cual»? (opacidad, mezcla, desenfoque o recorte). */
export function layerHasFx(l: Layer): boolean {
  return (l.opacity ?? 1) < 1 || (l.blend ?? "normal") !== "normal" || (l.blur ?? 0) > 0;
}

export type FxCtx = Ctx2D & { filter?: string };

/**
 * Dibuja la imagen de una capa (ya pintada, `w`×`h` px, en identidad) con su opacidad, mezcla y desenfoque.
 * `pxPerUnit` convierte el desenfoque (unidades del lienzo) a píxeles del destino. `dw`×`dh` = tamaño de destino.
 */
export function drawLayerImage(ctx: FxCtx, img: unknown, l: Layer, dw: number, dh: number, pxPerUnit: number): void {
  if (!layerHasFx(l)) {
    ctx.drawImage(img, 0, 0, dw, dh);
    return;
  }
  ctx.save();
  ctx.globalAlpha = l.opacity ?? 1;
  ctx.globalCompositeOperation = BLEND[l.blend ?? "normal"];
  const blur = (l.blur ?? 0) * pxPerUnit;
  if (blur > 0.05) ctx.filter = `blur(${blur.toFixed(2)}px)`;
  ctx.drawImage(img, 0, 0, dw, dh);
  ctx.restore();
}

/** Recorta `tmp` (con la capa ya pintada) a la forma de `mask` (la capa base): `destination-in`. */
export function clipToMask(tmp: Ctx2D, mask: unknown, w: number, h: number): void {
  tmp.save();
  tmp.setTransform(1, 0, 0, 1, 0, 0);
  tmp.globalAlpha = 1;
  tmp.globalCompositeOperation = "destination-in";
  tmp.drawImage(mask, 0, 0, w, h);
  tmp.restore();
}

/** Índice de la capa base de una capa con recorte: la primera por debajo que no recorta. -1 si no hay. */
export function clipBaseIndex(layers: readonly Layer[], i: number): number {
  for (let k = i - 1; k >= 0; k--) if (!layers[k]!.clip) return k;
  return -1;
}
