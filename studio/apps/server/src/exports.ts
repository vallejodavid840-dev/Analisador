import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  ExportOptionsSchema,
  type ExportCapabilitiesDTO,
  type ExportFileDTO,
  type ExportFormat,
  type ExportJobDTO,
  type ExportJobState,
  type ExportPhase,
  type ExportResultDTO,
} from "@gas/core";
import { ExportError, RUNNER_PATH, ffmpegPaths, isVideo, nextFreeName, probeCapabilities, sanitizeFileName, supportsAlpha, type Capabilities, type FfmpegPaths } from "@gas/export";
import { PROJECT_DIR_SUFFIX, type ProjectStore } from "@gas/storage";

interface Job {
  dto: ExportJobDTO;
  options: ReturnType<typeof ExportOptionsSchema.parse>;
  outputDir: string;
  animation: unknown;
  child: ChildProcess | null;
  ffmpegPid: number | null;
  cancelRequested: boolean;
  killTimer: NodeJS.Timeout | null;
}

export interface ExportManagerOptions {
  dataDir: string;
  store: ProjectStore;
  ffmpeg?: FfmpegPaths | undefined;
  /** Exportaciones simultáneas (cada una usa mucha CPU): por defecto 1; el resto espera en cola. */
  maxConcurrent?: number;
}

const FILE_EXT = /\.(mp4|webm|zip|png)$/i;
const MAX_JOBS_KEPT = 100;

/** Gestiona las exportaciones: cola, proceso hijo por trabajo, progreso, cancelación y limpieza. */
export class ExportManager {
  private jobs = new Map<string, Job>();
  private queue: Job[] = [];
  private running = 0;
  private capsCache: { at: number; caps: Capabilities } | null = null;
  private readonly paths: FfmpegPaths;
  private readonly max: number;

  constructor(private readonly o: ExportManagerOptions) {
    this.paths = o.ffmpeg ?? ffmpegPaths();
    this.max = o.maxConcurrent ?? 1;
  }

  exportsDir(projectId: string): string {
    return join(this.o.dataDir, `${projectId}${PROJECT_DIR_SUFFIX}`, "exports");
  }

  /* ───────── capacidades ───────── */
  async capabilities(force = false): Promise<ExportCapabilitiesDTO> {
    if (force || !this.capsCache || Date.now() - this.capsCache.at > 30_000) this.capsCache = { at: Date.now(), caps: await probeCapabilities(this.paths) };
    const c = this.capsCache.caps;
    const need = (ok: boolean, what: string) => (ok && c.ffprobe ? { available: true, reason: null } : { available: false, reason: !c.available ? c.message : !c.ffprobe ? c.message : `Falta el codificador ${what}. ${c.message ?? ""}`.trim() });
    return {
      ffmpeg: { available: c.available, version: c.version, message: c.message },
      formats: { mp4: need(c.h264, "H.264 (libx264)"), webm: need(c.vp9, "VP9 (libvpx)"), "png-seq": { available: true, reason: null }, png: { available: true, reason: null } },
    };
  }

  /** Al arrancar: elimina temporales de exportaciones interrumpidas (un corte, un `kill -9`…). */
  async cleanStaleTemps(): Promise<number> {
    let n = 0;
    let entries: string[];
    try {
      entries = await readdir(this.o.dataDir);
    } catch {
      return 0;
    }
    for (const e of entries.filter((x) => x.endsWith(PROJECT_DIR_SUFFIX))) n += await this.cleanTemps(join(this.o.dataDir, e, "exports"));
    return n;
  }

  private async cleanTemps(dir: string): Promise<number> {
    let n = 0;
    try {
      for (const f of await readdir(dir)) {
        if (f.startsWith(".tmp-")) {
          await rm(join(dir, f), { recursive: true, force: true });
          n++;
        }
      }
    } catch {
      /* no hay carpeta de exportaciones: nada que limpiar */
    }
    return n;
  }

  /* ───────── trabajos ───────── */
  async start(projectId: string, episodeId: string, rawOptions: unknown): Promise<ExportJobDTO> {
    const options = ExportOptionsSchema.parse(rawOptions);
    const animation = await this.o.store.loadAnimation(projectId, episodeId); // del disco: no depende del editor
    if (options.background.transparent && !supportsAlpha(options.format)) {
      throw new ExportError("invalid-options", "MP4 (H.264) no admite fondo transparente. Elige WebM o PNG, o usa un fondo de color.");
    }
    if (options.format === "png" && (options.frameIndex ?? 0) >= animation.frames.length) {
      throw new ExportError("invalid-options", "El fotograma elegido no existe.");
    }
    if (isVideo(options.format)) {
      const caps = await this.capabilities();
      const f = caps.formats[options.format];
      if (!f.available) throw new ExportError(caps.ffmpeg.available ? "encoder-missing" : "ffmpeg-missing", f.reason ?? "FFmpeg no está disponible.");
    }
    const outputDir = this.exportsDir(projectId);
    await mkdir(outputDir, { recursive: true });
    let fileName = sanitizeFileName(options.fileName, options.format);
    const taken = new Set((await readdir(outputDir)).filter((f) => !f.startsWith(".")));
    // También cuenta como ocupado el nombre de un trabajo aún en curso (aunque su archivo no exista todavía)
    for (const j of this.jobs.values()) if (j.dto.projectId === projectId && (j.dto.state === "queued" || j.dto.state === "running")) taken.add(j.dto.fileName);
    if (taken.has(fileName)) {
      if (options.autoRename) fileName = nextFreeName(fileName, (n) => taken.has(n));
      else if (!options.overwrite) {
        const e = new ExportError("file-exists", `Ya existe un archivo llamado «${fileName}». Elige otro nombre o autoriza sustituirlo.`);
        (e as ExportError & { suggestion?: string }).suggestion = nextFreeName(fileName, (n) => taken.has(n));
        throw e;
      }
    }
    const now = new Date().toISOString();
    const job: Job = {
      dto: { id: randomUUID(), projectId, episodeId, format: options.format, fileName, state: "queued", phase: "queued", done: 0, total: 0, createdAt: now, updatedAt: now },
      options, outputDir, animation, child: null, ffmpegPid: null, cancelRequested: false, killTimer: null,
    };
    this.jobs.set(job.dto.id, job);
    this.queue.push(job);
    this.prune();
    this.pump();
    return { ...job.dto };
  }

  get(id: string): ExportJobDTO | undefined {
    const j = this.jobs.get(id);
    return j && { ...j.dto };
  }

  list(projectId: string, episodeId?: string): ExportJobDTO[] {
    return [...this.jobs.values()]
      .filter((j) => j.dto.projectId === projectId && (!episodeId || j.dto.episodeId === episodeId))
      .map((j) => ({ ...j.dto }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20);
  }

  async files(projectId: string): Promise<ExportFileDTO[]> {
    const dir = this.exportsDir(projectId);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return [];
    }
    const out: ExportFileDTO[] = [];
    for (const name of names.filter((n) => !n.startsWith(".") && FILE_EXT.test(n))) {
      const s = await stat(join(dir, name)).catch(() => null);
      if (s?.isFile()) out.push({ name, bytes: s.size, modifiedAt: s.mtime.toISOString() });
    }
    return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }

  private setState(job: Job, state: ExportJobState, patch: Partial<ExportJobDTO> = {}): void {
    job.dto = { ...job.dto, ...patch, state, updatedAt: new Date().toISOString() };
  }

  private prune(): void {
    if (this.jobs.size <= MAX_JOBS_KEPT) return;
    for (const [id, j] of this.jobs) {
      if (this.jobs.size <= MAX_JOBS_KEPT) break;
      if (j.dto.state !== "queued" && j.dto.state !== "running") this.jobs.delete(id);
    }
  }

  private pump(): void {
    while (this.running < this.max && this.queue.length > 0) {
      const job = this.queue.shift()!;
      if (job.dto.state !== "queued") continue;
      this.running++;
      this.launch(job);
    }
  }

  private launch(job: Job): void {
    this.setState(job, "running", { phase: "preparing" });
    const env = { ...process.env };
    if (this.o.ffmpeg) {
      env["FFMPEG_PATH"] = this.o.ffmpeg.ffmpeg;
      env["FFPROBE_PATH"] = this.o.ffmpeg.ffprobe;
    }
    const child = spawn(process.execPath, ["--import", "tsx", RUNNER_PATH], { stdio: ["ignore", "inherit", "inherit", "ipc"], env });
    job.child = child;
    let terminal = false;
    const finish = (state: ExportJobState, patch: Partial<ExportJobDTO>) => {
      if (terminal) return;
      terminal = true;
      this.setState(job, state, patch);
    };

    child.on("message", (m: Record<string, unknown>) => {
      switch (m["type"]) {
        case "progress":
          if (!terminal) this.setState(job, "running", { phase: m["phase"] as ExportPhase, done: m["done"] as number, total: m["total"] as number });
          break;
        case "spawn":
          job.ffmpegPid = m["pid"] as number;
          break;
        case "result": {
          const r = m["result"] as ExportResultDTO & { fileName: string };
          finish("done", { phase: "done", done: r.frames, total: r.frames, result: { fileName: r.fileName, bytes: r.bytes, width: r.width, height: r.height, fps: r.fps, frames: r.frames, durationSec: r.durationSec, drawings: r.drawings } });
          break;
        }
        case "error":
          if (m["code"] === "cancelled") finish("cancelled", { error: { code: "cancelled", message: "Exportación cancelada." } });
          else finish("error", { error: { code: String(m["code"]), message: String(m["message"]) } });
          break;
      }
    });
    child.on("error", (err) => finish("error", { error: { code: "internal", message: `No se pudo iniciar el proceso de exportación: ${err.message}` } }));
    child.on("exit", () => {
      if (job.killTimer) clearTimeout(job.killTimer);
      // Node puede entregar «exit» antes que el último mensaje IPC: un margen breve evita un falso «terminó mal».
      setTimeout(() => {
        if (job.cancelRequested) finish("cancelled", { error: { code: "cancelled", message: "Exportación cancelada." } });
        else finish("error", { error: { code: "internal", message: "El proceso de exportación terminó de forma inesperada (¿falta de memoria?). Prueba con una resolución menor." } });
        job.child = null;
        this.running--;
        // Sin trabajos activos de este proyecto, no debe quedar ningún temporal.
        const active = [...this.jobs.values()].some((j) => j !== job && j.dto.projectId === job.dto.projectId && j.dto.state === "running");
        void (active ? Promise.resolve(0) : this.cleanTemps(job.outputDir)).then(() => this.pump());
      }, 60);
    });

    child.send({
      type: "start",
      animation: job.animation,
      request: {
        format: job.options.format,
        ...(job.options.fps ? { fps: job.options.fps } : {}),
        resolution: job.options.resolution,
        quality: job.options.quality,
        background: job.options.background,
        ...(job.options.frameIndex !== undefined ? { frameIndex: job.options.frameIndex } : {}),
        outputDir: job.outputDir,
        fileName: job.dto.fileName,
        overwrite: job.options.overwrite,
      },
    });
    job.animation = null; // ya está en el hijo: libera memoria aquí
  }

  /** Cancela: en cola, al instante; en curso, pide al hijo que pare y, si no responde, lo mata a él y a FFmpeg. */
  cancel(id: string): ExportJobDTO | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    if (job.dto.state === "queued") {
      this.queue = this.queue.filter((j) => j !== job);
      job.animation = null;
      this.setState(job, "cancelled", { error: { code: "cancelled", message: "Exportación cancelada." } });
    } else if (job.dto.state === "running" && !job.cancelRequested) {
      job.cancelRequested = true;
      job.child?.send({ type: "cancel" });
      job.killTimer = setTimeout(() => {
        if (job.ffmpegPid) try { process.kill(job.ffmpegPid, "SIGKILL"); } catch { /* ya terminó */ }
        job.child?.kill("SIGKILL");
      }, 4000);
    }
    return { ...job.dto };
  }

  /** Detiene todo (al cerrar el servidor). */
  async dispose(): Promise<void> {
    for (const job of this.jobs.values()) {
      if (job.killTimer) clearTimeout(job.killTimer);
      if (job.ffmpegPid) try { process.kill(job.ffmpegPid, "SIGKILL"); } catch { /* ya terminó */ }
      job.child?.kill("SIGKILL");
    }
    this.queue = [];
    await Promise.all([...new Set([...this.jobs.values()].map((j) => j.outputDir))].map((d) => this.cleanTemps(d)));
  }
}

export type { ExportFormat };
