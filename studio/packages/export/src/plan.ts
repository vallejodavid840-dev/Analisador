import { frameIndexAtTick, totalTicks } from "@gas/engine";
import type { Animation } from "@gas/core";
import type { ExportFormat, Quality, ResolutionSpec } from "@gas/core";
import { ExportError } from "./errors";

export type { ExportFormat, Quality, ResolutionSpec };

export const MIN_SIDE = 16;
export const MAX_SIDE = 7680;

export const FORMAT_EXT: Record<ExportFormat, string> = { mp4: "mp4", webm: "webm", "png-seq": "zip", png: "png" };
export const isVideo = (f: ExportFormat) => f === "mp4" || f === "webm";
/** ¿El formato admite fondo transparente? (H.264 no tiene canal alfa.) */
export const supportsAlpha = (f: ExportFormat) => f !== "mp4";

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Tamaño de salida en píxeles. Los vídeos usan dimensiones PARES (requisito de yuv420p). Mantiene la proporción. */
export function outputSize(doc: Pick<Animation, "width" | "height">, res: ResolutionSpec, format: ExportFormat): { width: number; height: number } {
  let w = doc.width;
  let h = doc.height;
  if (res.kind === "short-side") {
    if (!Number.isInteger(res.px) || res.px < MIN_SIDE || res.px > MAX_SIDE) {
      throw new ExportError("invalid-options", `La resolución debe estar entre ${MIN_SIDE} y ${MAX_SIDE} píxeles.`);
    }
    const k = res.px / Math.min(doc.width, doc.height);
    w = doc.width * k;
    h = doc.height * k;
  }
  if (isVideo(format)) return { width: even(w), height: even(h) };
  return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) };
}

export interface Run {
  /** Índice del dibujo (fotograma del documento) que se muestra. */
  drawing: number;
  /** Cuántos fotogramas CONSECUTIVOS del vídeo lo muestran. */
  count: number;
}

export interface FramePlan {
  fps: number;
  /** Fotogramas totales de la salida. */
  totalFrames: number;
  durationSec: number;
  runs: Run[];
}

/**
 * Qué dibujo se ve en cada fotograma de la salida.
 * Usa LAS MISMAS funciones que el reproductor del editor (`@gas/engine/playback`): el fotograma k de salida
 * se muestra en el instante k/fps, que corresponde al tick floor(k · fpsProyecto / fps) del documento.
 * Si fps coincide con el del proyecto, la salida tiene exactamente un fotograma por tick, igual que al reproducir.
 */
export function planFrames(anim: Pick<Animation, "frames" | "fps">, outFps: number): FramePlan {
  if (!Number.isInteger(outFps) || outFps < 1 || outFps > 120) throw new ExportError("invalid-options", "Los FPS deben ser un entero entre 1 y 120.");
  const ticks = totalTicks(anim);
  const seconds = ticks / anim.fps;
  const total = Math.max(1, Math.round(seconds * outFps));
  const runs: Run[] = [];
  for (let k = 0; k < total; k++) {
    const tick = Math.floor((k * anim.fps) / outFps + 1e-9);
    const drawing = frameIndexAtTick(anim, tick, false);
    const last = runs[runs.length - 1];
    if (last && last.drawing === drawing) last.count++;
    else runs.push({ drawing, count: 1 });
  }
  return { fps: outFps, totalFrames: total, durationSec: total / outFps, runs };
}

export const CRF: Record<ExportFormat & ("mp4" | "webm"), Record<Quality, number>> = {
  mp4: { low: 28, medium: 23, high: 18, max: 14 },
  webm: { low: 42, medium: 33, high: 26, max: 18 },
};

/** Nombre de archivo seguro: sin rutas, sin caracteres peligrosos, con la extensión del formato. */
export function sanitizeFileName(name: string, format: ExportFormat): string {
  const ext = FORMAT_EXT[format];
  let base = name.normalize("NFC").replace(/\.(mp4|webm|zip|png)$/i, "");
  base = base.replace(/[^\p{L}\p{N} _.()-]+/gu, "_").replace(/\s+/g, " ").trim().replace(/^[.\s_-]+/, "").replace(/[.\s]+$/, "");
  base = base.slice(0, 80);
  if (!base) throw new ExportError("invalid-options", "Escribe un nombre para el archivo.");
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) base = `${base}_`;
  return `${base}.${ext}`;
}

/** «nombre.mp4» → «nombre (2).mp4» → «nombre (3).mp4»… para no sobrescribir. */
export function nextFreeName(fileName: string, exists: (n: string) => boolean): string {
  if (!exists(fileName)) return fileName;
  const dot = fileName.lastIndexOf(".");
  const base = fileName.slice(0, dot);
  const ext = fileName.slice(dot);
  for (let i = 2; i < 10_000; i++) {
    const c = `${base} (${i})${ext}`;
    if (!exists(c)) return c;
  }
  throw new ExportError("invalid-options", "Hay demasiados archivos con ese nombre.");
}
