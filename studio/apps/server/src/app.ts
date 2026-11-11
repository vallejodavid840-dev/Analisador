import { existsSync } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { AnimationSchema, NewProjectSchema, ProjectSchema } from "@gas/core";
import { StorageError, createProjectStore, type StorageErrorCode } from "@gas/storage";

export interface AppOptions {
  dataDir: string;
  /** Carpeta con la interfaz compilada (apps/studio/dist). Si no existe, solo se sirve la API. */
  staticDir?: string | undefined;
  logger?: boolean;
}

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

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof StorageError) {
      return reply.status(STATUS[err.code]).send({ error: err.code, message: err.message });
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

  if (opts.staticDir && existsSync(opts.staticDir)) {
    await app.register(fastifyStatic, { root: opts.staticDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.status(404).send({ error: "not-found", message: "Ruta inexistente" });
      return reply.sendFile("index.html");
    });
  }

  return app;
}
