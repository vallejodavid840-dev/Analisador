import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";

let dir: string;
let app: FastifyInstance;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gas-api-"));
  app = await buildApp({ dataDir: dir });
});
afterEach(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

const create = (payload: unknown) => app.inject({ method: "POST", url: "/api/projects", payload: payload as object });

describe("API de proyectos", () => {
  it("crea, lista, obtiene y guarda", async () => {
    const res = await create({ name: "Serie", settings: { fps: 12 } });
    expect(res.statusCode).toBe(201);
    const p = res.json();
    expect(p.settings.fps).toBe(12);

    const list = (await app.inject({ url: "/api/projects" })).json();
    expect(list.projects[0].summary.name).toBe("Serie");

    const put = await app.inject({ method: "PUT", url: `/api/projects/${p.id}`, payload: { ...p, name: "Serie 2" } });
    expect(put.statusCode).toBe(200);
    const got = (await app.inject({ url: `/api/projects/${p.id}` })).json();
    expect(got.name).toBe("Serie 2");
  });

  it("valida el cuerpo (400) con mensaje útil", async () => {
    const res = await create({ name: "" });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("name");
    expect((await create({ name: "x", settings: { fps: 500 } })).statusCode).toBe(400);
  });

  it("404 para proyecto inexistente y 400 para id con ruta", async () => {
    expect((await app.inject({ url: "/api/projects/nada" })).statusCode).toBe(404);
    expect((await app.inject({ url: "/api/projects/..%2F..%2Fetc" })).statusCode).toBeGreaterThanOrEqual(400);
  });

  it("409 ante guardado concurrente", async () => {
    const p = (await create({ name: "x" })).json();
    expect((await app.inject({ method: "PUT", url: `/api/projects/${p.id}`, payload: p })).statusCode).toBe(200);
    const stale = await app.inject({ method: "PUT", url: `/api/projects/${p.id}`, payload: p });
    expect(stale.statusCode).toBe(409);
  });

  it("rechaza PUT con id distinto al de la URL", async () => {
    const a = (await create({ name: "a" })).json();
    const b = (await create({ name: "b" })).json();
    expect((await app.inject({ method: "PUT", url: `/api/projects/${a.id}`, payload: b })).statusCode).toBe(400);
  });
});
