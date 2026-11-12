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

describe("animaciones por episodio", () => {
  const stroke = { id: "s1", kind: "pen" as const, color: "#ff0000", size: 5, opacity: 1, sens: 0, points: [1, 2, 1, 3, 4, 1] };
  async function withEpisode() {
    let p = await store.create({ name: "S", settings: { fps: 12, width: 640, height: 360 } });
    p = addSeason(p);
    p = addEpisode(p, p.seasons[0]!.id);
    p = await store.save(p);
    return { p, eid: p.seasons[0]!.episodes[0]!.id };
  }

  it("un episodio sin dibujo devuelve uno vacío con los ajustes del proyecto, sin escribir nada", async () => {
    const { p, eid } = await withEpisode();
    const a = await store.loadAnimation(p.id, eid);
    expect(a).toMatchObject({ episodeId: eid, revision: 0, fps: 12, width: 640, height: 360 });
    expect(await readdir(join(root, `${p.id}${PROJECT_DIR_SUFFIX}`, "episodes"))).toEqual([]);
  });

  it("guardar y recargar conserva trazos, capas y fotogramas; la revisión sube", async () => {
    const { p, eid } = await withEpisode();
    const a = await store.loadAnimation(p.id, eid);
    const doc = { ...a, frames: [{ ...a.frames[0]!, hold: 2, cells: { [a.layers[1]!.id]: [stroke] } }], layers: a.layers.map((l, i) => (i === 0 ? { ...l, visible: false, name: "Fondo" } : l)) };
    expect(await store.saveAnimation(p.id, doc)).toEqual({ revision: 1 });
    const back = await store.loadAnimation(p.id, eid);
    expect(back).toEqual({ ...doc, revision: 1 });
    expect(await store.saveAnimation(p.id, back)).toEqual({ revision: 2 });
  });

  it("conflicto si la revisión no coincide", async () => {
    const { p, eid } = await withEpisode();
    const a = await store.loadAnimation(p.id, eid);
    await store.saveAnimation(p.id, a);
    await expect(store.saveAnimation(p.id, a)).rejects.toMatchObject({ code: "conflict" });
  });

  it("conserva la versión anterior en .prev", async () => {
    const { p, eid } = await withEpisode();
    const a = await store.loadAnimation(p.id, eid);
    await store.saveAnimation(p.id, a); // rev 1
    const withStroke = { ...a, revision: 1, frames: [{ ...a.frames[0]!, cells: { [a.layers[0]!.id]: [stroke] } }] };
    await store.saveAnimation(p.id, withStroke); // rev 2, .prev = rev 1 (vacío)
    const prev = JSON.parse(await readFile(join(root, `${p.id}${PROJECT_DIR_SUFFIX}`, "episodes", `${eid}.json.prev`), "utf8"));
    expect(prev.revision).toBe(1);
    expect(prev.frames[0].cells).toEqual({});
  });

  it("rechaza episodios inexistentes, datos inválidos y no deja temporales", async () => {
    const { p, eid } = await withEpisode();
    await expect(store.loadAnimation(p.id, "fantasma")).rejects.toMatchObject({ code: "not-found" });
    const a = await store.loadAnimation(p.id, eid);
    await expect(store.saveAnimation(p.id, { ...a, episodeId: "fantasma" })).rejects.toMatchObject({ code: "not-found" });
    await expect(store.saveAnimation(p.id, { ...a, fps: 0 } as never)).rejects.toMatchObject({ code: "invalid" });
    await store.saveAnimation(p.id, a);
    const files = await readdir(join(root, `${p.id}${PROJECT_DIR_SUFFIX}`, "episodes"));
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("un dibujo dañado se informa sin sobrescribirlo", async () => {
    const { p, eid } = await withEpisode();
    const a = await store.loadAnimation(p.id, eid);
    await store.saveAnimation(p.id, a);
    const file = join(root, `${p.id}${PROJECT_DIR_SUFFIX}`, "episodes", `${eid}.json`);
    await writeFile(file, "{rota");
    await expect(store.loadAnimation(p.id, eid)).rejects.toMatchObject({ code: "corrupt" });
    await expect(store.saveAnimation(p.id, a)).rejects.toMatchObject({ code: "corrupt" });
    expect(await readFile(file, "utf8")).toBe("{rota");
  });

  it("el proyecto de la Fase 0 no cambia al guardar dibujos (compatibilidad)", async () => {
    const { p, eid } = await withEpisode();
    const before = await readFile(join(root, `${p.id}${PROJECT_DIR_SUFFIX}`, "project.json"), "utf8");
    await store.saveAnimation(p.id, await store.loadAnimation(p.id, eid));
    expect(await readFile(join(root, `${p.id}${PROJECT_DIR_SUFFIX}`, "project.json"), "utf8")).toBe(before);
  });
});

describe("compatibilidad con animaciones anteriores (v1 → v3)", () => {
  const v1 = (layers: [string, string], extra: object = {}) => ({
    schemaVersion: 1, episodeId: "ep", revision: 3, fps: 12, width: 640, height: 360,
    layers: [{ id: layers[0], name: "Color", visible: true, locked: false }, { id: layers[1], name: "Líneas", visible: true, locked: true }],
    frames: [
      { id: "f1", hold: 2, cells: { [layers[1]]: [{ id: "s1", kind: "pen", color: "#112233", size: 7, opacity: 0.5, sens: 0.3, points: [1, 2, 0.5, 30, 40, 0.9] }] } },
      { id: "f2", hold: 1, cells: {} },
    ],
    ...extra,
  });

  async function projectWithV1() {
    let p = await store.create({ name: "Antiguo", settings: { fps: 12, width: 640, height: 360 } });
    p = addSeason(p);
    p = addEpisode(p, p.seasons[0]!.id);
    p = await store.save(p);
    const eid = p.seasons[0]!.episodes[0]!.id;
    const file = join(root, `${p.id}${PROJECT_DIR_SUFFIX}`, "episodes", `${eid}.json`);
    const doc = { ...v1(["capa-a", "capa-b"]), episodeId: eid };
    await mkdir(join(root, `${p.id}${PROJECT_DIR_SUFFIX}`, "episodes"), { recursive: true });
    await writeFile(file, JSON.stringify(doc));
    return { p, eid, file, original: JSON.stringify(doc) };
  }

  it("un dibujo v1 se lee igual (capas, fotogramas, trazos, duraciones) y sin rig", async () => {
    const { p, eid } = await projectWithV1();
    const a = await store.loadAnimation(p.id, eid);
    expect(a.schemaVersion).toBe(3);
    expect(a.fps).toBe(12);
    expect(a.layers.map((l) => [l.name, l.locked])).toEqual([["Color", false], ["Líneas", true]]);
    expect(a.frames.map((f) => f.hold)).toEqual([2, 1]);
    expect(a.frames[0]!.cells["capa-b"]![0]).toMatchObject({ id: "s1", color: "#112233", size: 7, opacity: 0.5, points: [1, 2, 0.5, 30, 40, 0.9] });
    expect(a.rigs).toBeUndefined();
    expect(a.frames[0]!.poses).toBeUndefined();
  });

  it("leer NO modifica el archivo; el primer guardado conserva el original en .bak-v1 y guarda como v3", async () => {
    const { p, eid, file, original } = await projectWithV1();
    const a = await store.loadAnimation(p.id, eid);
    expect(await readFile(file, "utf8")).toBe(original); // solo lectura
    await store.saveAnimation(p.id, a);
    expect(await readFile(`${file}.bak-v1`, "utf8")).toBe(original); // original intacto
    const saved = JSON.parse(await readFile(file, "utf8"));
    expect(saved.schemaVersion).toBe(3);
    expect(saved.revision).toBe(4);
    expect(saved.frames[0].cells["capa-b"][0].points).toEqual([1, 2, 0.5, 30, 40, 0.9]); // los datos no cambian
    // un segundo guardado NO sobrescribe el .bak-v1
    await store.saveAnimation(p.id, { ...a, revision: 4 });
    expect(await readFile(`${file}.bak-v1`, "utf8")).toBe(original);
  });

  it("el proyecto (project.json) no cambia al migrar el dibujo", async () => {
    const { p, eid } = await projectWithV1();
    const pj = join(root, `${p.id}${PROJECT_DIR_SUFFIX}`, "project.json");
    const before = await readFile(pj, "utf8");
    await store.saveAnimation(p.id, await store.loadAnimation(p.id, eid));
    expect(await readFile(pj, "utf8")).toBe(before);
  });

  it("un v2 con rig y poses se guarda y se recupera idéntico", async () => {
    const { p, eid } = await projectWithV1();
    const a = await store.loadAnimation(p.id, eid);
    const bone = { id: "b1", name: "Cadera", parent: null, x: 100, y: 200, ax: 1, ay: 0, angle: -90, length: 80, min: -45, max: 45 };
    const rich = {
      ...a,
      rigs: [{ id: "sk1", name: "Héroe", bones: [bone, { ...bone, id: "b2", name: "Torso", parent: "b1", x: 0, y: 0, angle: 0 }], bindings: [{ layerId: "capa-b", mode: "skin" as const, bone: "b1", influences: ["b1", "b2"], softness: 25, sharpness: 3 }] }],
      frames: [{ ...a.frames[0]!, poses: { sk1: { bones: { b1: { r: 10, x: 5, y: -3 }, b2: { r: -20 } }, ease: "smooth" as const } } }, a.frames[1]!],
    };
    await store.saveAnimation(p.id, rich);
    const back = await store.loadAnimation(p.id, eid);
    expect(back.rigs).toEqual(rich.rigs);
    expect(back.frames[0]!.poses).toEqual(rich.frames[0]!.poses);
  });

  it("un rig inválido (padre inexistente o ciclo) se rechaza sin tocar el archivo", async () => {
    const { p, eid } = await projectWithV1();
    const a = await store.loadAnimation(p.id, eid);
    const bad = { id: "b1", name: "X", parent: "fantasma", x: 0, y: 0, ax: 1, ay: 0, angle: 0, length: 10, min: -10, max: 10 };
    await expect(store.saveAnimation(p.id, { ...a, rigs: [{ id: "s", name: "S", bones: [bad], bindings: [] }] })).rejects.toMatchObject({ code: "invalid" });
    await expect(store.saveAnimation(p.id, { ...a, rigs: [{ id: "s", name: "S", bones: [{ ...bad, parent: null, min: 5, max: -5 }], bindings: [] }] })).rejects.toMatchObject({ code: "invalid" });
    expect((await store.loadAnimation(p.id, eid)).rigs).toBeUndefined();
  });
  it("un dibujo v2 con rig se abre igual, y el primer guardado conserva el original en .bak-v2", async () => {
    const { p, eid } = await projectWithV1();
    const a = await store.loadAnimation(p.id, eid);
    const file = join(root, `${p.id}.gangstudio`, "episodes", `${eid}.json`);
    await writeFile(file, JSON.stringify({ ...a, schemaVersion: 2, revision: 1 }));
    const loaded = await store.loadAnimation(p.id, eid);
    expect(loaded.schemaVersion).toBe(3);
    expect(loaded.layers).toEqual(a.layers);
    expect(await readFile(file, "utf8")).toContain('"schemaVersion":2'); // leer no modifica
    await store.saveAnimation(p.id, { ...loaded, revision: 1 });
    expect(JSON.parse(await readFile(`${file}.bak-v2`, "utf8")).schemaVersion).toBe(2);
    expect(JSON.parse(await readFile(file, "utf8")).schemaVersion).toBe(3);
  });
});
