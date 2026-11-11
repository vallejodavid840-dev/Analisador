import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addEpisode, addSeason } from "@gas/core";
import { PROJECT_DIR_SUFFIX, StorageError, createProjectStore, type ProjectStore } from "../src";

let root: string;
let store: ProjectStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "gas-store-"));
  store = createProjectStore(root);
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("almacenamiento de proyectos", () => {
  it("crea la estructura de carpetas del formato", async () => {
    const p = await store.create({ name: "Serie" });
    const names = (await readdir(join(root, `${p.id}${PROJECT_DIR_SUFFIX}`))).sort();
    expect(names).toEqual(["assets", "characters", "episodes", "gangs", "project.json", "scenes"]);
  });

  it("guardar y recargar produce un proyecto idéntico (ida y vuelta)", async () => {
    let p = await store.create({ name: "Serie", settings: { fps: 30 } });
    p = addSeason(p, "Temporada ñandú");
    p = addEpisode(p, p.seasons[0]!.id, "Episodio 1: «El barrio»");
    const saved = await store.save(p);
    const loaded = await store.load(p.id);
    expect(loaded).toEqual(saved);
    expect(loaded.seasons[0]!.episodes[0]!.title).toBe("Episodio 1: «El barrio»");
    expect(loaded.settings.fps).toBe(30);
  });

  it("no deja archivos temporales tras guardar", async () => {
    const p = await store.create({ name: "x" });
    await store.save(p);
    const files = await readdir(join(root, `${p.id}${PROJECT_DIR_SUFFIX}`));
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("updatedAt aumenta estrictamente en cada guardado", async () => {
    const p0 = await store.create({ name: "x" });
    const p1 = await store.save(p0);
    const p2 = await store.save(p1);
    expect(Date.parse(p1.updatedAt)).toBeGreaterThan(Date.parse(p0.updatedAt));
    expect(Date.parse(p2.updatedAt)).toBeGreaterThan(Date.parse(p1.updatedAt));
  });

  it("detecta conflicto si otro dispositivo guardó antes", async () => {
    const p = await store.create({ name: "x" });
    await store.save(p); // "otro dispositivo"
    await expect(store.save(p)).rejects.toMatchObject({ code: "conflict" });
  });

  it("lista proyectos, más reciente primero, con resumen", async () => {
    const a = await store.create({ name: "A" });
    const b = await store.create({ name: "B" });
    let b2 = addSeason(b);
    b2 = addEpisode(b2, b2.seasons[0]!.id);
    await store.save(b2);
    const list = await store.list();
    expect(list.map((e) => e.summary?.name)).toEqual(["B", "A"]);
    expect(list[0]!.summary).toMatchObject({ seasons: 1, episodes: 1, fps: 24 });
    expect(list[1]!.summary!.id).toBe(a.id);
  });

  it("un proyecto dañado se informa y NO se modifica ni oculta al resto", async () => {
    const good = await store.create({ name: "bueno" });
    const dir = join(root, `dañado${PROJECT_DIR_SUFFIX}`.replace("ñ", "n"));
    await mkdir(dir);
    await writeFile(join(dir, "project.json"), "{ esto no es json");
    const list = await store.list();
    expect(list.find((e) => e.summary)?.summary?.id).toBe(good.id);
    expect(list.find((e) => e.error)?.error?.id).toBe("danado");
    expect(await readFile(join(dir, "project.json"), "utf8")).toBe("{ esto no es json");
    await expect(store.load("danado")).rejects.toMatchObject({ code: "corrupt" });
  });

  it("rechaza ids con recorrido de rutas", async () => {
    await expect(store.load("../../etc")).rejects.toMatchObject({ code: "invalid-id" });
    await expect(store.load("a/b")).rejects.toBeInstanceOf(StorageError);
  });

  it("proyecto inexistente -> not-found", async () => {
    await expect(store.load("nada")).rejects.toMatchObject({ code: "not-found" });
  });

  it("rechaza un proyecto de una versión más nueva sin tocarlo", async () => {
    const p = await store.create({ name: "futuro" });
    const file = join(root, `${p.id}${PROJECT_DIR_SUFFIX}`, "project.json");
    const future = JSON.stringify({ ...p, schemaVersion: 99 });
    await writeFile(file, future);
    await expect(store.load(p.id)).rejects.toMatchObject({ code: "corrupt" });
    expect(await readFile(file, "utf8")).toBe(future);
  });
});
