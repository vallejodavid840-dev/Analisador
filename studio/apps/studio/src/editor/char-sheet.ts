import type { Animation } from "@gas/core";
import { VIEW_LABEL } from "@gas/engine";
import { posedFrame } from "@gas/engine";
import { createCanvas, ctxOf, frameImage } from "./cache";
import { composeFrame } from "@gas/render";

/**
 * Hoja de referencia: las 4 vistas (cada una es su propio dibujo, sin deformar) lado a lado, con rótulos.
 * Se compone con el MISMO `composeFrame` que el lienzo y la exportación.
 */
export async function sheetPng(doc: Animation, title: string): Promise<Blob> {
  const views = doc.character?.views ?? [];
  const cellW = 500, cellH = 650, pad = 28, head = 64;
  const W = pad + views.length * (cellW + pad), H = head + cellH + pad + 36;
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#14141b";
  ctx.font = "700 30px 'Barlow Condensed', 'Arial Narrow', sans-serif";
  ctx.fillText(title.toUpperCase(), pad, 44);
  void frameImage; void composeFrame; void ctxOf;
  views.forEach((v, k) => {
    const idx = doc.frames.findIndex((f) => f.id === v.frameId);
    if (idx < 0) return;
    const img = frameImage(doc, posedFrame(doc, idx), { scale: cellW / doc.width, background: "#ffffff" });
    const x = pad + k * (cellW + pad);
    ctx.strokeStyle = "#cfcfd8";
    ctx.strokeRect(x, head, cellW, cellH);
    ctx.drawImage(img, x, head, cellW, cellH);
    ctx.fillStyle = "#555566";
    ctx.font = "700 20px 'Barlow Condensed', 'Arial Narrow', sans-serif";
    ctx.fillText(VIEW_LABEL[v.kind].toUpperCase(), x, head + cellH + 28);
  });
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("No se pudo crear la imagen"))), "image/png"));
}

/** Una vista (dibujo) a tamaño completo del lienzo de personaje, con o sin fondo, como PNG. Mismo `composeFrame` que la exportación. */
export async function viewPng(doc: Animation, frameIndex: number, transparent: boolean): Promise<Blob> {
  const c = createCanvas(doc.width, doc.height);
  const ctx = c.getContext("2d")!;
  const img = frameImage(doc, posedFrame(doc, frameIndex), { scale: 1, ...(transparent ? {} : { background: "#ffffff" }) });
  ctx.drawImage(img, 0, 0);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("No se pudo crear la imagen"))), "image/png"));
}
