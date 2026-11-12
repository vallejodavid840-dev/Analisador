import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { AnimationSchema, NewProjectSchema, ProjectSchema } from "@gas/core";
import { ExportError, type ExportErrorCode, type FfmpegPaths } from "@gas/export";
import { newCharacterDoc } from "@gas/engine";
import { CharacterSheetSchema } from "@gas/core";
import { StorageError, createCharacterStore, createProjectStore, type StorageErrorCode } from "@gas/storage";
import { ExportManager } from "./exports";

export interface AppOptions {
  dataDir: string;
  /** Carpeta con la interfaz compilada (apps/studio/dist). Si no existe, solo se sirve la API. */
  staticDir?: string | undefined;
  logger?: boolean;
  /** Rutas de FFmpeg/ffprobe (por defecto, las del PATH). */
  ffmpeg?: FfmpegPaths | undefined;
}

const EXPORT_STATUS: Record<ExportErrorCode, number> = {
  "invalid-options": 400,
  "file-exists": 409,
  cancelled: 409,
  "ffmpeg-missing": 503,
  "encoder-missing": 503,
  "disk-full": 507,
  permission: 500,
  "ffmpeg-failed": 500,
  "validation-failed": 500,
  "render-failed": 500,
  internal: 500,
};

const MIME: Record<string, string> = { mp4: "video/mp4", webm: "video/webm", zip: "application/zip", png: "image/png" };

const STATUS: Record<StorageErrorCode, number> = {
  "not-found": 404,
  corrupt: 422,
  "invalid-id": 400,
  conflict: 409,
  invalid: 400,
};

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 10 * 1024 * 1024 });
  const store = createProjectStore(opts.dataDir);
  const characters = createCharacterStore(opts.dataDir);
  const exportManager = new ExportManager({ dataDir: opts.dataDir, store, ffmpeg: opts.ffmpeg });
  await exportManager.cleanStaleTemps();
  app.addHook("onClose", async () => exportManager.dispose());

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof StorageError) {
      return reply.status(STATUS[err.code]).send({ error: err.code, message: err.message });
    }
    if (err instanceof ExportError) {
      const suggestion = (err as ExportError & { suggestion?: string }).suggestion;
      return reply.status(EXPORT_STATUS[err.code]).send({ error: err.code, message: err.message, ...(suggestion ? { suggestion } : {}) });
    }
    if (err instanceof z.ZodError) {
      return reply.status(400).send({
        error: "invalid",
        message: err.issues.map((i) => `${i.path.join(".") || "cuerpo"}: ${i.message}`).join("; "),
      });
    }
    app.log.error(err);
    return reply.status(500).send({ error: "internal", message: "Error interno del servidor" });
  });

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/projects", async () => ({ projects: await store.list() }));

  app.post("/api/projects", async (req, reply) => {
    const project = await store.create(NewProjectSchema.parse(req.body));
    return reply.status(201).send(project);
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id", async (req) => store.load(req.params.id));

  app.put<{ Params: { id: string } }>("/api/projects/:id", async (req) => {
    const project = ProjectSchema.parse(req.body);
    if (project.id !== req.params.id) {
      throw new StorageError("El id del cuerpo no coincide con la URL", "invalid");
    }
    return store.save(project);
  });

  const ANIMATION_BODY_LIMIT = 64 * 1024 * 1024;
  app.get<{ Params: { id: string; eid: string } }>("/api/projects/:id/episodes/:eid/animation", async (req) =>
    store.loadAnimation(req.params.id, req.params.eid),
  );
  app.put<{ Params: { id: string; eid: string } }>(
    "/api/projects/:id/episodes/:eid/animation",
    { bodyLimit: ANIMATION_BODY_LIMIT },
    async (req) => {
      const animation = AnimationSchema.parse(req.body);
      if (animation.episodeId !== req.params.eid) {
        throw new StorageError("El episodio del cuerpo no coincide con la URL", "invalid");
      }
      return store.saveAnimation(req.params.id, animation);
    },
  );

  /* ───────── Biblioteca de personajes (Fase 4) ───────── */
  const CharCreate = z.object({ name: z.string().trim().min(1).max(80), folder: z.string().max(60).optional() });
  const CharPatch = z.object({ sheet: CharacterSheetSchema.optional(), folder: z.string().max(60).optional(), tags: z.array(z.string().max(30)).max(20).optional(), thumbnail: z.string().max(200_000).nullable().optional() }).strict();
  const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

  app.get<{ Querystring: { q?: string; folder?: string } }>("/api/characters", async (req) => {
    const list = await characters.list(clean({ q: req.query.q, folder: req.query.folder }) as { q?: string; folder?: string });
    return { characters: list, folders: [...new Set((await characters.list()).map((c) => c.folder).filter(Boolean))].sort() };
  });
  app.post("/api/characters", async (req, reply) => {
    const body = CharCreate.parse(req.body);
    return reply.status(201).send(await characters.create({ name: body.name, ...(body.folder ? { folder: body.folder } : {}), drawing: (id) => newCharacterDoc(id) }));
  });
  app.get<{ Params: { id: string } }>("/api/characters/:id", async (req) => characters.getMeta(req.params.id));
  app.patch<{ Params: { id: string } }>("/api/characters/:id", async (req) => characters.updateMeta(req.params.id, clean(CharPatch.parse(req.body)) as never));
  app.delete<{ Params: { id: string } }>("/api/characters/:id", async (req, reply) => {
    await characters.remove(req.params.id);
    return reply.status(204).send();
  });
  app.post<{ Params: { id: string } }>("/api/characters/:id/duplicate", async (req, reply) => {
    const name = z.object({ name: z.string().trim().min(1).max(80).optional() }).parse(req.body ?? {}).name;
    return reply.status(201).send(await characters.duplicate(req.params.id, name));
  });
  app.get<{ Params: { id: string } }>("/api/characters/:id/drawing", async (req) => characters.loadDrawing(req.params.id));
  app.put<{ Params: { id: string } }>("/api/characters/:id/drawing", { bodyLimit: ANIMATION_BODY_LIMIT }, async (req) => {
    const drawing = AnimationSchema.parse(req.body);
    if (drawing.episodeId !== req.params.id) throw new StorageError("El personaje del cuerpo no coincide con la URL", "invalid");
    return characters.saveDrawing(drawing);
  });
  app.get<{ Params: { id: string } }>("/api/characters/:id/files", async (req) => ({ files: await characters.listFiles(req.params.id) }));
  app.addContentTypeParser(["image/png", "image/jpeg", "image/webp"], { parseAs: "buffer", bodyLimit: 13 * 1024 * 1024 }, (_req, body, done) => done(null, body));
  app.put<{ Params: { id: string; name: string } }>("/api/characters/:id/files/:name", { bodyLimit: 13 * 1024 * 1024 }, async (req, reply) => {
    await characters.putFile(req.params.id, req.params.name, req.body as Buffer);
    return reply.status(201).send({ ok: true });
  });
  app.get<{ Params: { id: string; name: string } }>("/api/characters/:id/files/:name", async (req, reply) => {
    const file = await characters.filePath(req.params.id, req.params.name);
    const ext = /\.(png|jpe?g|webp)$/i.exec(req.params.name)?.[1]?.toLowerCase() ?? "png";
    return reply.header("content-type", ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg").header("x-content-type-options", "nosniff").header("cache-control", "private, max-age=0, must-revalidate").send(createReadStream(file));
  });
  app.delete<{ Params: { id: string; name: string } }>("/api/characters/:id/files/:name", async (req, reply) => {
    await characters.deleteFile(req.params.id, req.params.name);
    return reply.status(204).send();
  });

  /* ───────── Exportación (Fase 2) ───────── */
  app.get("/api/export/capabilities", async () => exportManager.capabilities());

  app.post<{ Params: { id: string; eid: string } }>("/api/projects/:id/episodes/:eid/exports", async (req, reply) => {
    const job = await exportManager.start(req.params.id, req.params.eid, req.body);
    return reply.status(202).send(job);
  });

  app.get<{ Params: { jobId: string } }>("/api/exports/:jobId", async (req, reply) => {
    const job = exportManager.get(req.params.jobId);
    return job ?? reply.status(404).send({ error: "not-found", message: "Exportación no encontrada." });
  });

  app.post<{ Params: { jobId: string } }>("/api/exports/:jobId/cancel", async (req, reply) => {
    const job = exportManager.cancel(req.params.jobId);
    return job ?? reply.status(404).send({ error: "not-found", message: "Exportación no encontrada." });
  });

  app.get<{ Params: { id: string }; Querystring: { episode?: string } }>("/api/projects/:id/exports", async (req) => {
    await store.load(req.params.id); // 404 si el proyecto no existe
    return { files: await exportManager.files(req.params.id), jobs: exportManager.list(req.params.id, req.query.episode) };
  });

  /** Descarga (o reproducción con `?inline=1`) de un archivo exportado, con soporte de rangos para vídeo. */
  app.get<{ Params: { id: string; name: string }; Querystring: { inline?: string } }>("/api/projects/:id/exports/files/:name", async (req, reply) => {
    await store.load(req.params.id);
    const { name } = req.params;
    const ext = /\.(mp4|webm|zip|png)$/i.exec(name)?.[1]?.toLowerCase();
    if (!ext || name.startsWith(".") || /[/\\\0]/.test(name)) return reply.status(400).send({ error: "invalid", message: "Nombre de archivo no válido." });
    const file = join(exportManager.exportsDir(req.params.id), name);
    const st = await stat(file).catch(() => null);
    if (!st?.isFile()) return reply.status(404).send({ error: "not-found", message: "Archivo no encontrado." });

    let start = 0;
    let end = st.size - 1;
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
    if (range && (range[1] || range[2])) {
      if (range[1]) {
        start = Number(range[1]);
        if (range[2]) end = Math.min(end, Number(range[2]));
      } else {
        start = Math.max(0, st.size - Number(range[2]));
      }
      if (start > end || start >= st.size) return reply.status(416).header("content-range", `bytes */${st.size}`).send();
      reply.status(206).header("content-range", `bytes ${start}-${end}/${st.size}`);
    }
    reply
      .header("content-type", MIME[ext]!)
      .header("content-length", end - start + 1)
      .header("accept-ranges", "bytes")
      .header("x-content-type-options", "nosniff")
      .header("cache-control", "private, max-age=0, must-revalidate");
    if (req.query.inline !== "1") reply.header("content-disposition", `attachment; filename="${encodeURIComponent(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    return reply.send(createReadStream(file, { start, end }));
  });

  if (opts.staticDir && existsSync(opts.staticDir)) {
    await app.register(fastifyStatic, { root: opts.staticDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.status(404).send({ error: "not-found", message: "Ruta inexistente" });
      return reply.sendFile("index.html");
    });
  }

  return app;
}
