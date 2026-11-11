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

describe("API de animaciones", () => {
  async function episode() {
    const p = (await create({ name: "Serie" })).json();
    const withSeason = { ...p, seasons: [{ id: "t1", name: "T1", episodes: [{ id: "e1", title: "E1" }] }] };
    const saved = (await app.inject({ method: "PUT", url: `/api/projects/${p.id}`, payload: withSeason })).json();
    return { pid: saved.id as string, url: `/api/projects/${saved.id}/episodes/e1/animation` };
  }

  it("carga una animación vacía, guarda y vuelve a cargar", async () => {
    const { url } = await episode();
    const a = (await app.inject({ url })).json();
    expect(a.revision).toBe(0);
    const stroke = { id: "s", kind: "pen", color: "#00ff00", size: 3, opacity: 0.5, sens: 0.5, points: [1, 1, 0.4, 5, 5, 0.9] };
    a.frames[0].cells[a.layers[1].id] = [stroke];
    const put = await app.inject({ method: "PUT", url, payload: a });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ revision: 1 });
    const back = (await app.inject({ url })).json();
    expect(back.frames[0].cells[a.layers[1].id]).toEqual([stroke]);
  });

  it("409 con revisión vieja, 400 con datos inválidos, 404 con episodio inexistente", async () => {
    const { pid, url } = await episode();
    const a = (await app.inject({ url })).json();
    await app.inject({ method: "PUT", url, payload: a });
    expect((await app.inject({ method: "PUT", url, payload: a })).statusCode).toBe(409);
    expect((await app.inject({ method: "PUT", url, payload: { ...a, fps: -3 } })).statusCode).toBe(400);
    expect((await app.inject({ url: `/api/projects/${pid}/episodes/nope/animation` })).statusCode).toBe(404);
  });

  it("acepta cuerpos grandes (más de 1 MB de puntos)", async () => {
    const { url } = await episode();
    const a = (await app.inject({ url })).json();
    const pts: number[] = [];
    for (let i = 0; i < 99_000; i++) pts.push(i % 1900, (i * 7) % 1000, 0.5);
    a.frames[0].cells[a.layers[0].id] = [{ id: "big", kind: "pen", color: "#000000", size: 2, opacity: 1, sens: 0, points: pts }];
    expect(JSON.stringify(a).length).toBeGreaterThan(1_000_000);
    expect((await app.inject({ method: "PUT", url, payload: a })).statusCode).toBe(200);
  });
});
