import { execFile, spawn, type ChildProcessByStdio } from "node:child_process";
import { dirname, join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { ExportError, describeFfmpegFailure } from "./errors";
import { CRF, type Quality } from "./plan";

export interface FfmpegPaths {
  ffmpeg: string;
  ffprobe: string;
}

/** FFmpeg se busca en el PATH, o en `FFMPEG_PATH` / `FFPROBE_PATH`. Es un programa externo: no se enlaza ni se copia. */
export function ffmpegPaths(env: NodeJS.ProcessEnv = process.env): FfmpegPaths {
  const ffmpeg = env["FFMPEG_PATH"] || "ffmpeg";
  const ffprobe = env["FFPROBE_PATH"] || (env["FFMPEG_PATH"] ? join(dirname(env["FFMPEG_PATH"]), "ffprobe") : "ffprobe");
  return { ffmpeg, ffprobe };
}

export interface Capabilities {
  /** ¿Hay un FFmpeg ejecutable? */
  available: boolean;
  version: string | null;
  ffprobe: boolean;
  /** Codificadores que necesitamos. */
  h264: boolean;
  vp9: boolean;
  /** Explicación para el usuario cuando algo falta. */
  message: string | null;
}

function run(cmd: string, args: string[], timeoutMs = 15_000): Promise<{ code: number; stdout: string; stderr: string; spawnError?: NodeJS.ErrnoException }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && (err as NodeJS.ErrnoException).code === "ENOENT") return resolve({ code: 127, stdout: "", stderr: "", spawnError: err as NodeJS.ErrnoException });
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

const INSTALL_HELP = "Instala FFmpeg (gratuito): en Linux `sudo apt install ffmpeg`, en macOS `brew install ffmpeg`, en Windows `winget install ffmpeg`. También puedes indicar su ruta con la variable FFMPEG_PATH.";

export async function probeCapabilities(paths: FfmpegPaths = ffmpegPaths()): Promise<Capabilities> {
  const v = await run(paths.ffmpeg, ["-hide_banner", "-version"]);
  if (v.spawnError || v.code !== 0) {
    return { available: false, version: null, ffprobe: false, h264: false, vp9: false, message: `No se encontró FFmpeg en este equipo. ${INSTALL_HELP}` };
  }
  const version = /ffmpeg version (\S+)/.exec(v.stdout)?.[1] ?? null;
  const enc = await run(paths.ffmpeg, ["-hide_banner", "-encoders"]);
  const h264 = /\blibx264\b/.test(enc.stdout);
  const vp9 = /\blibvpx-vp9\b/.test(enc.stdout);
  const probe = await run(paths.ffprobe, ["-hide_banner", "-version"]);
  const ffprobe = !probe.spawnError && probe.code === 0;
  const missing: string[] = [];
  if (!h264) missing.push("H.264 (libx264)");
  if (!vp9) missing.push("VP9 (libvpx)");
  if (!ffprobe) missing.push("ffprobe (necesario para comprobar los vídeos)");
  return { available: true, version, ffprobe, h264, vp9, message: missing.length ? `A esta instalación de FFmpeg le falta: ${missing.join(", ")}. ${INSTALL_HELP}` : null };
}

export interface VideoArgs {
  format: "mp4" | "webm";
  width: number;
  height: number;
  fps: number;
  quality: Quality;
  alpha: boolean;
  out: string;
}

/**
 * Argumentos de FFmpeg: entrada = vídeo crudo RGBA por la entrada estándar.
 * - MP4: H.264, yuv420p (reproducible en móviles, navegadores y editores), BT.709, `faststart`.
 * - WebM: VP9, con canal alfa (yuva420p) si se pide fondo transparente.
 */
export function buildVideoArgs(a: VideoArgs): string[] {
  const input = ["-y", "-hide_banner", "-loglevel", "error", "-nostats", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${a.width}x${a.height}`, "-framerate", String(a.fps), "-i", "pipe:0"];
  const color = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];
  const vf = a.alpha
    ? "scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuva420p"
    : "scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p";
  if (a.format === "mp4") {
    return [...input, "-vf", vf, "-c:v", "libx264", "-preset", "medium", "-crf", String(CRF.mp4[a.quality]), "-profile:v", "high", "-pix_fmt", "yuv420p", ...color, "-movflags", "+faststart", "-r", String(a.fps), "-an", a.out];
  }
  return [
    ...input, "-vf", vf, "-c:v", "libvpx-vp9", "-crf", String(CRF.webm[a.quality]), "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "4",
    "-pix_fmt", a.alpha ? "yuva420p" : "yuv420p", ...(a.alpha ? ["-auto-alt-ref", "0"] : []), ...color, "-r", String(a.fps), "-an", a.out,
  ];
}

type Child = ChildProcessByStdio<Writable, null, Readable>;

/** Un proceso de FFmpeg al que se le envían fotogramas crudos RGBA. */
export class VideoEncoder {
  private child: Child;
  private stderr = "";
  private failure: ExportError | null = null;
  private exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  killed = false;

  constructor(paths: FfmpegPaths, args: string[]) {
    this.child = spawn(paths.ffmpeg, args, { stdio: ["pipe", "ignore", "pipe"] }) as Child;
    this.child.stderr.on("data", (d: Buffer) => {
      if (this.stderr.length < 64 * 1024) this.stderr += d.toString();
    });
    this.child.stdin.on("error", () => undefined); // EPIPE si FFmpeg termina antes: se informa por `exit`
    this.exit = new Promise((resolve) => {
      this.child.on("error", (err: NodeJS.ErrnoException) => {
        this.failure = err.code === "ENOENT" ? new ExportError("ffmpeg-missing", `No se encontró FFmpeg. ${INSTALL_HELP}`) : new ExportError("ffmpeg-failed", `No se pudo iniciar FFmpeg: ${err.message}`);
        resolve({ code: null, signal: null });
      });
      this.child.on("close", (code, signal) => resolve({ code, signal }));
    });
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  /** Error real cuando FFmpeg ya terminó de forma anómala. */
  private async explain(): Promise<ExportError> {
    const { code, signal } = await this.exit;
    return this.failure ?? describeFfmpegFailure(this.stderr, code, signal);
  }

  async write(buf: Buffer): Promise<void> {
    if (this.failure) throw this.failure;
    const stdin = this.child.stdin;
    if (stdin.destroyed || stdin.writableEnded) throw await this.explain();
    if (stdin.write(buf)) return;
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        stdin.off("drain", onDrain);
        stdin.off("close", onClose);
      };
      const onDrain = () => (done(), resolve());
      const onClose = () => (done(), void this.explain().then(reject));
      stdin.once("drain", onDrain);
      stdin.once("close", onClose);
    });
  }

  /** Cierra la entrada y espera a que FFmpeg termine de escribir el archivo. */
  async finish(): Promise<void> {
    this.child.stdin.end();
    const { code, signal } = await this.exit;
    if (this.failure) throw this.failure;
    if (code !== 0) throw describeFfmpegFailure(this.stderr, code, signal);
  }

  kill(): void {
    this.killed = true;
    this.child.stdin.destroy();
    this.child.kill("SIGKILL");
  }

  waitExit(): Promise<unknown> {
    return this.exit;
  }
}

export interface VideoExpectation {
  codec: "h264" | "vp9";
  width: number;
  height: number;
  fps: number;
  frames: number;
  alpha: boolean;
}

export interface VideoInfo {
  frames: number;
  duration: number;
  codec: string;
  width: number;
  height: number;
  pixFmt: string;
  fps: number;
}

const parseFraction = (s: string | undefined): number => {
  const [a, b] = (s ?? "").split("/").map(Number);
  return a && b ? a / b : Number.NaN;
};

/**
 * Comprueba que el archivo es un vídeo VÁLIDO y es el que se pidió: ffprobe DECODIFICA todos los fotogramas
 * (`-count_frames`), así que un archivo truncado o corrupto falla aquí. Verifica códec, tamaño, FPS,
 * nº de fotogramas, duración y (si se pidió) el canal alfa.
 */
export async function validateVideo(paths: FfmpegPaths, file: string, exp: VideoExpectation): Promise<VideoInfo> {
  const r = await run(
    paths.ffprobe,
    ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,avg_frame_rate,nb_read_frames,pix_fmt:stream_tags=alpha_mode:format=duration", "-of", "json", file],
    10 * 60_000,
  );
  const bad = (m: string, d?: string) => new ExportError("validation-failed", `El vídeo generado no es válido: ${m}`, d ?? r.stderr);
  if (r.spawnError) throw new ExportError("ffmpeg-missing", `No se encontró ffprobe, necesario para comprobar el vídeo. ${INSTALL_HELP}`);
  if (r.code !== 0 || r.stderr.trim()) throw bad("no se pudo leer o decodificar el archivo.", r.stderr);
  interface ProbeStream {
    codec_name?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    nb_read_frames?: string;
    pix_fmt?: string;
    duration?: string;
    tags?: Record<string, string>;
  }
  let j: { streams?: ProbeStream[]; format?: { duration?: string } };
  try {
    j = JSON.parse(r.stdout);
  } catch {
    throw bad("ffprobe no devolvió datos legibles.");
  }
  const s = j.streams?.[0];
  if (!s) throw bad("no contiene una pista de vídeo.");
  const info: VideoInfo = {
    frames: Number(s.nb_read_frames),
    duration: Number(j.format?.duration ?? s.duration),
    codec: String(s.codec_name),
    width: Number(s.width),
    height: Number(s.height),
    pixFmt: String(s.pix_fmt),
    fps: parseFraction(s.avg_frame_rate),
  };
  if (info.codec !== exp.codec) throw bad(`el códec es ${info.codec} y debería ser ${exp.codec}.`);
  if (info.width !== exp.width || info.height !== exp.height) throw bad(`el tamaño es ${info.width}×${info.height} y debería ser ${exp.width}×${exp.height}.`);
  if (info.frames !== exp.frames) throw bad(`tiene ${info.frames} fotogramas y debería tener ${exp.frames}.`);
  if (!(Math.abs(info.fps - exp.fps) < 0.01)) throw bad(`los FPS son ${info.fps.toFixed(3)} y deberían ser ${exp.fps}.`);
  if (!(Math.abs(info.duration - exp.frames / exp.fps) <= 1.5 / exp.fps)) throw bad(`dura ${info.duration.toFixed(3)} s y debería durar ${(exp.frames / exp.fps).toFixed(3)} s.`);
  if (exp.alpha && s.tags?.["alpha_mode"] !== "1") throw bad("se pidió fondo transparente pero el archivo no tiene canal alfa.");
  return info;
}
