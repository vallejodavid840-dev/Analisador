import { createWriteStream } from "node:fs";
import { link, mkdir, mkdtemp, open, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Transform } from "node:stream";
import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import { ZipFile } from "yazl";
import type { Animation } from "@gas/core";
import { posedFrame } from "@gas/engine";
import { composeFrame, type CanvasHandle, type Ctx2D, type ScratchProvider } from "@gas/render";
import { ExportError, describeFfmpegFailure } from "./errors";
import { VideoEncoder, buildVideoArgs, ffmpegPaths, probeCapabilities, validateVideo, type FfmpegPaths } from "./ffmpeg";
import { FORMAT_EXT, isVideo, outputSize, planFrames, supportsAlpha, type ExportFormat, type FramePlan, type Quality, type ResolutionSpec } from "./plan";

export interface ExportRequest {
  animation: Animation;
  format: ExportFormat;
  /** Por defecto, los FPS de la animación. */
  fps?: number;
  resolution: ResolutionSpec;
  quality: Quality;
  background: { transparent: boolean; color: string };
  /** Solo para `png`: índice (0-based) del dibujo a exportar. */
  frameIndex?: number;
  outputDir: string;
  /** Nombre final, ya con la extensión del formato (ver `sanitizeFileName`). */
  fileName: string;
  /** Si ya existe un archivo con ese nombre: false = error, true = sustituirlo. */
  overwrite: boolean;
}

export type Phase = "preparing" | "rendering" | "finalizing" | "validating" | "done";
export interface Progress {
  phase: Phase;
  /** Fotogramas de salida ya procesados. */
  done: number;
  total: number;
}

export interface ExportHooks {
  signal?: AbortSignal;
  onProgress?: (p: Progress) => void;
  /** PID de FFmpeg, para poder matarlo desde fuera si hiciera falta. */
  onSpawn?: (pid: number) => void;
  paths?: FfmpegPaths;
}

export interface ExportResult {
  file: string;
  fileName: string;
  bytes: number;
  format: ExportFormat;
  width: number;
  height: number;
  fps: number;
  frames: number;
  durationSec: number;
  /** Dibujos distintos que hubo que renderizar (el resto son repeticiones). */
  drawings: number;
}

const cancelled = () => new ExportError("cancelled", "Exportación cancelada.");
const yieldLoop = () => new Promise<void>((r) => setImmediate(r));

/** Pinta fotogramas con @napi-rs/canvas (Skia) usando el MISMO `composeFrame` que el editor. Sin DOM. */
class FrameRenderer {
  private readonly canvas: Canvas;
  private readonly ctx: SKRSContext2D;
  private readonly pools = new Map<string, Canvas>();
  readonly scale: number;

  constructor(
    private readonly anim: Animation,
    readonly width: number,
    readonly height: number,
    private readonly background: string | null,
  ) {
    this.canvas = createCanvas(width, height);
    this.ctx = this.canvas.getContext("2d");
    this.scale = width / anim.width;
  }

  private scratch(kind: string): ScratchProvider {
    return (w, h): CanvasHandle => {
      const key = `${kind}:${w}x${h}`;
      let c = this.pools.get(key);
      if (!c) {
        if (this.pools.size > 12) this.pools.clear(); // acota la memoria
        c = createCanvas(w, h);
        this.pools.set(key, c);
      }
      return { canvas: c, ctx: c.getContext("2d") as unknown as Ctx2D };
    };
  }

  private draw(drawing: number): void {
    if (!this.anim.frames[drawing]) throw new ExportError("invalid-options", `El fotograma ${drawing + 1} no existe.`);
    // El rig se aplica con LA MISMA función que usa el editor (lienzo, reproducción, miniaturas): lo exportado es lo que se ve.
    const frame = posedFrame(this.anim, drawing);
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.globalCompositeOperation = "source-over";
    this.ctx.globalAlpha = 1;
    this.ctx.clearRect(0, 0, this.width, this.height);
    composeFrame(this.ctx as unknown as Ctx2D, this.anim.layers, frame, {
      pixelWidth: this.width, pixelHeight: this.height, scale: this.scale, background: this.background,
      layerScratch: this.scratch("layer"), opacityScratch: this.scratch("opacity"),
    });
  }

  /** RGBA sin premultiplicar (lo que espera FFmpeg), una copia nueva en cada llamada. */
  rgba(drawing: number): Buffer {
    this.draw(drawing);
    const d = this.ctx.getImageData(0, 0, this.width, this.height).data;
    return Buffer.from(d.buffer, d.byteOffset, d.byteLength);
  }

  png(drawing: number): Promise<Buffer> {
    this.draw(drawing);
    return this.canvas.encode("png");
  }
}

function checkOptions(req: ExportRequest): void {
  const ext = FORMAT_EXT[req.format];
  if (!ext) throw new ExportError("invalid-options", "Formato de exportación no válido.");
  if (basename(req.fileName) !== req.fileName || !req.fileName.toLowerCase().endsWith(`.${ext}`) || req.fileName.startsWith(".")) {
    throw new ExportError("invalid-options", "El nombre del archivo no es válido.");
  }
  if (req.background.transparent && !supportsAlpha(req.format)) {
    throw new ExportError("invalid-options", "MP4 (H.264) no admite fondo transparente. Elige WebM o PNG, o usa un fondo de color.");
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(req.background.color)) throw new ExportError("invalid-options", "El color de fondo no es válido.");
  if (!["low", "medium", "high", "max"].includes(req.quality)) throw new ExportError("invalid-options", "La calidad elegida no es válida.");
  if (req.format === "png") {
    const i = req.frameIndex ?? 0;
    if (!Number.isInteger(i) || i < 0 || i >= req.animation.frames.length) throw new ExportError("invalid-options", "El fotograma elegido no existe.");
  }
}

/** Publica el archivo terminado. Sin `overwrite`, falla si apareció otro con el mismo nombre (sin carreras). */
async function publish(tmpFile: string, finalFile: string, overwrite: boolean): Promise<void> {
  if (overwrite) {
    await rename(tmpFile, finalFile).catch(async (e: NodeJS.ErrnoException) => {
      if (e.code !== "EEXIST" && e.code !== "EPERM") throw e;
      await rm(finalFile, { force: true }); // Windows no permite renombrar sobre un archivo existente
      await rename(tmpFile, finalFile);
    });
    return;
  }
  try {
    await link(tmpFile, finalFile); // atómico: falla con EEXIST si ya existe
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new ExportError("file-exists", `Ya existe un archivo llamado «${basename(finalFile)}».`);
    throw e;
  }
  await unlink(tmpFile);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/* ───────── comprobaciones de salida ───────── */
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function readHead(file: string, n: number): Promise<Buffer> {
  const fh = await open(file, "r");
  try {
    const b = Buffer.alloc(n);
    const { bytesRead } = await fh.read(b, 0, n, 0);
    return b.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

async function validatePng(file: string, width: number, height: number): Promise<void> {
  const h = await readHead(file, 24);
  if (h.length < 24 || !h.subarray(0, 8).equals(PNG_SIG)) throw new ExportError("validation-failed", "El PNG generado no es válido.");
  if (h.readUInt32BE(16) !== width || h.readUInt32BE(20) !== height) throw new ExportError("validation-failed", "El PNG generado no tiene el tamaño esperado.");
}

async function validateZip(file: string, entries: number): Promise<void> {
  const buf = await readFile(file);
  const bad = (m: string) => new ExportError("validation-failed", `El ZIP generado no es válido: ${m}`);
  if (buf.length < 30 || buf.readUInt32LE(0) !== 0x04034b50) throw bad("falta la cabecera.");
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw bad("está incompleto (sin directorio central).");
  const total = buf.readUInt16LE(eocd + 10);
  if (total !== 0xffff && total !== entries) throw bad(`contiene ${total} imágenes y debería contener ${entries}.`);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  if (!buf.subarray(30 + nameLen + extraLen, 38 + nameLen + extraLen).equals(PNG_SIG)) throw bad("la primera imagen no es un PNG.");
}

/**
 * Exporta una animación. NO depende del editor: recibe el documento guardado y produce el archivo.
 * Seguridad: trabaja en una carpeta temporal, valida el resultado y solo entonces lo publica; ante un error o una
 * cancelación no deja nada a medias y siempre limpia los temporales.
 */
export async function runExport(req: ExportRequest, hooks: ExportHooks = {}): Promise<ExportResult> {
  const { signal } = hooks;
  const paths = hooks.paths ?? ffmpegPaths();
  const progress = (p: Progress) => hooks.onProgress?.(p);
  const throwIfCancelled = () => {
    if (signal?.aborted) throw cancelled();
  };

  checkOptions(req);
  const anim = req.animation;
  const fps = req.fps ?? anim.fps;
  const { width, height } = outputSize(anim, req.resolution, req.format);
  const plan: FramePlan = req.format === "png"
    ? { fps, totalFrames: 1, durationSec: 0, runs: [{ drawing: req.frameIndex ?? 0, count: 1 }] }
    : planFrames(anim, fps);
  const finalFile = join(req.outputDir, req.fileName);
  progress({ phase: "preparing", done: 0, total: plan.totalFrames });

  if (isVideo(req.format)) {
    const caps = await probeCapabilities(paths);
    if (!caps.available) throw new ExportError("ffmpeg-missing", caps.message ?? "No se encontró FFmpeg.");
    if (!caps.ffprobe) throw new ExportError("ffmpeg-missing", caps.message ?? "No se encontró ffprobe.");
    if ((req.format === "mp4" && !caps.h264) || (req.format === "webm" && !caps.vp9)) throw new ExportError("encoder-missing", caps.message ?? "Falta un codificador de FFmpeg.");
  }
  if (!req.overwrite && (await pathExists(finalFile))) {
    throw new ExportError("file-exists", `Ya existe un archivo llamado «${req.fileName}».`);
  }

  await mkdir(req.outputDir, { recursive: true });
  const tmpDir = await mkdtemp(join(req.outputDir, ".tmp-"));
  let encoder: VideoEncoder | null = null;
  const onAbort = () => encoder?.kill();
  signal?.addEventListener("abort", onAbort);
  try {
    throwIfCancelled();
    const renderer = new FrameRenderer(anim, width, height, req.background.transparent ? null : req.background.color);
    const tmpFile = join(tmpDir, `salida.${FORMAT_EXT[req.format]}`);
    let done = 0;
    let lastReport = 0;
    const tick = (force = false) => {
      const now = Date.now();
      if (force || now - lastReport >= 80) {
        lastReport = now;
        progress({ phase: "rendering", done, total: plan.totalFrames });
      }
    };
    const drawingsRendered = plan.runs.length;

    if (req.format === "mp4" || req.format === "webm") {
      encoder = new VideoEncoder(paths, buildVideoArgs({ format: req.format, width, height, fps, quality: req.quality, alpha: req.background.transparent, out: tmpFile }));
      if (encoder.pid) hooks.onSpawn?.(encoder.pid);
      for (const run of plan.runs) {
        throwIfCancelled();
        const buf = renderer.rgba(run.drawing);
        for (let i = 0; i < run.count; i++) {
          throwIfCancelled();
          await encoder.write(buf);
          done++;
          tick();
        }
        await yieldLoop();
      }
      tick(true);
      progress({ phase: "finalizing", done, total: plan.totalFrames });
      await encoder.finish();
      throwIfCancelled();
      progress({ phase: "validating", done, total: plan.totalFrames });
      await validateVideo(paths, tmpFile, { codec: req.format === "mp4" ? "h264" : "vp9", width, height, fps, frames: plan.totalFrames, alpha: req.background.transparent });
    } else if (req.format === "png") {
      await writeFile(tmpFile, await renderer.png(plan.runs[0]!.drawing));
      done = 1;
      tick(true);
      progress({ phase: "validating", done, total: 1 });
      await validatePng(tmpFile, width, height);
    } else {
      // Secuencia PNG en un ZIP. Con contrapresión: nunca hay más de ~64 MB de imágenes esperando al disco.
      const zip = new ZipFile();
      let added = 0;
      let flowed = 0;
      const counter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          flowed += chunk.length;
          cb(null, chunk);
        },
      });
      const out = createWriteStream(tmpFile);
      const written = new Promise<void>((resolve, reject) => {
        out.on("close", resolve);
        out.on("error", reject);
        counter.on("error", reject);
        zip.outputStream.on("error", reject);
      });
      zip.outputStream.pipe(counter).pipe(out);
      const stem = req.fileName.replace(/\.zip$/i, "");
      const digits = Math.max(5, String(plan.totalFrames).length);
      try {
        for (const run of plan.runs) {
          throwIfCancelled();
          const png = await renderer.png(run.drawing);
          for (let i = 0; i < run.count; i++) {
            throwIfCancelled();
            while (added - flowed > 64 * 1024 * 1024) {
              throwIfCancelled();
              await new Promise((r) => setTimeout(r, 5));
            }
            zip.addBuffer(png, `${stem}/${stem}_${String(done + 1).padStart(digits, "0")}.png`, { compress: false });
            added += png.length;
            done++;
            tick();
            if (done % 8 === 0) await yieldLoop();
          }
        }
        tick(true);
        progress({ phase: "finalizing", done, total: plan.totalFrames });
        zip.end();
        await written;
      } catch (e) {
        zip.outputStream.unpipe();
        out.destroy();
        throw e;
      }
      progress({ phase: "validating", done, total: plan.totalFrames });
      await validateZip(tmpFile, plan.totalFrames);
    }

    throwIfCancelled();
    await publish(tmpFile, finalFile, req.overwrite);
    const { size } = await stat(finalFile);
    progress({ phase: "done", done: plan.totalFrames, total: plan.totalFrames });
    return { file: finalFile, fileName: req.fileName, bytes: size, format: req.format, width, height, fps, frames: plan.totalFrames, durationSec: plan.durationSec, drawings: drawingsRendered };
  } catch (err) {
    encoder?.kill();
    if (signal?.aborted) throw cancelled();
    if (err instanceof ExportError) throw err;
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOSPC") throw describeFfmpegFailure("No space left on device", null);
    if (e.code === "EACCES" || e.code === "EPERM" || e.code === "EROFS") throw describeFfmpegFailure("permission denied", null);
    throw new ExportError("render-failed", `No se pudo renderizar la animación: ${e.message}`, e.stack);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (encoder) await encoder.waitExit();
    await rm(tmpDir, { recursive: true, force: true });
  }
}
