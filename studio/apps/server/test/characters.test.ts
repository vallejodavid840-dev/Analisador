import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMPTY_SHEET } from "@gas/core";
import { buildApp } from "../src/app";

let dir: string;
let app: FastifyInstance;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gas-char-"));
  app = await buildApp({ dataDir: dir });
});
afterEach(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

const mk = async (name: string, folder?: string) => (await app.inject({ method: "POST", url: "/api/characters", payload: { name, ...(folder ? { folder } : {}) } })).json();

describe("API de la biblioteca de personajes", () => {
  it("crea un personaje con 4 vistas independientes y su ficha vacía", async () => {
    const res = await app.inject({ method: "POST", url: "/api/characters", payload: { name: "Kenji Aoyama" } });
    expect(res.statusCode).toBe(201);
    const m = res.json();
    expect(m.sheet.name).toBe("Kenji Aoyama");
    const d = (await app.inject({ url: `/api/characters/${m.id}/drawing` })).json();
    expect(d.episodeId).toBe(m.id);
    expect(d.frames).toHaveLength(4);
    expect(d.character.views.map((v: { kind: string }) => v.kind)).toEqual(["front", "threeQuarter", "side", "back"]);
    expect(d.width).toBe(1000);
  });

  it("valida el nombre y los identificadores", async () => {
    expect((await app.inject({ method: "POST", url: "/api/characters", payload: { name: "   " } })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/characters/no..valido" })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/characters/00000000-0000-4000-8000-000000000000" })).statusCode).toBe(404);
  });

  it("edita la ficha libremente y la persiste (campos largos, saltos de línea, acentos)", async () => {
    const m = await mk("Ryu");
    const sheet = { ...EMPTY_SHEET("Ryu «el Perro»"), age: "17", height: "181 cm", description: "Alto y ancho de hombros.\nCicatriz en la ceja.", personality: "Callado, leal", gang: "Los Cuervos de Shibuya", rank: "Segundo al mando", history: "Llegó a la ciudad a los 12…", relations: "Hermano de Aiko", design: "Chaqueta roja oversized", outfit: "Baggy azul, zapatillas blancas" };
    const r = await app.inject({ method: "PATCH", url: `/api/characters/${m.id}`, payload: { sheet } });
    expect(r.statusCode).toBe(200);
    expect((await app.inject({ url: `/api/characters/${m.id}` })).json().sheet).toEqual(sheet);
    // un campo desconocido o demasiado largo se rechaza sin tocar nada
    expect((await app.inject({ method: "PATCH", url: `/api/characters/${m.id}`, payload: { sheet: { ...sheet, history: "x".repeat(9000) } } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: `/api/characters/${m.id}`, payload: { id: "otro" } })).statusCode).toBe(400);
    expect((await app.inject({ url: `/api/characters/${m.id}` })).json().sheet.history).toBe("Llegó a la ciudad a los 12…");
  });

  it("lista, organiza en carpetas y busca (sin distinguir acentos ni mayúsculas, por ficha y etiquetas)", async () => {
    const a = await mk("Kenji", "Cuervos");
    const b = await mk("Aiko", "Cuervos");
    await mk("Tomás", "Rivales");
    await app.inject({ method: "PATCH", url: `/api/characters/${a.id}`, payload: { sheet: { ...EMPTY_SHEET("Kenji"), gang: "Los Cuervos", outfit: "Chaqueta bomber" }, tags: ["líder", "líder", "  "] } });
    const all = (await app.inject({ url: "/api/characters" })).json();
    expect(all.characters).toHaveLength(3);
    expect(all.folders).toEqual(["Cuervos", "Rivales"]);
    expect((await app.inject({ url: "/api/characters?folder=Cuervos" })).json().characters).toHaveLength(2);
    expect((await app.inject({ url: "/api/characters?q=TOMAS" })).json().characters.map((c: { sheet: { name: string } }) => c.sheet.name)).toEqual(["Tomás"]);
    expect((await app.inject({ url: "/api/characters?q=bomber" })).json().characters).toHaveLength(1);
    expect((await app.inject({ url: "/api/characters?q=lider" })).json().characters[0].tags).toEqual(["líder"]);
    expect((await app.inject({ url: "/api/characters?q=nadie" })).json().characters).toHaveLength(0);
    void b;
  });

  it("renombra (ficha), duplica con su dibujo y elimina solo el elegido", async () => {
    const m = await mk("Original");
    const d = (await app.inject({ url: `/api/characters/${m.id}/drawing` })).json();
    const dup = (await app.inject({ method: "POST", url: `/api/characters/${m.id}/duplicate`, payload: {} })).json();
    expect(dup.id).not.toBe(m.id);
    expect(dup.sheet.name).toBe("Original (copia)");
    const dd = (await app.inject({ url: `/api/characters/${dup.id}/drawing` })).json();
    expect(dd.episodeId).toBe(dup.id);
    expect(dd.layers.map((l: { name: string }) => l.name)).toEqual(d.layers.map((l: { name: string }) => l.name));
    expect((await app.inject({ method: "DELETE", url: `/api/characters/${m.id}` })).statusCode).toBe(204);
    expect((await app.inject({ url: `/api/characters/${m.id}` })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/characters/${dup.id}` })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: `/api/characters/${m.id}` })).statusCode).toBe(404);
  });

  it("guarda el dibujo con control de revisión y conserva .prev; un guardado viejo da 409", async () => {
    const m = await mk("Rev");
    const d = (await app.inject({ url: `/api/characters/${m.id}/drawing` })).json();
    const r1 = await app.inject({ method: "PUT", url: `/api/characters/${m.id}/drawing`, payload: { ...d, layers: [...d.layers, { id: "capa-extra", name: "Extra", visible: true, locked: false }] } });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().revision).toBe(d.revision + 1);
    const stale = await app.inject({ method: "PUT", url: `/api/characters/${m.id}/drawing`, payload: d });
    expect(stale.statusCode).toBe(409);
    expect((await app.inject({ url: `/api/characters/${m.id}/drawing` })).json().layers.map((l: { name: string }) => l.name)).toContain("Extra");
    // el id del cuerpo debe ser el de la URL
    const other = await mk("Otro");
    expect((await app.inject({ method: "PUT", url: `/api/characters/${other.id}/drawing`, payload: { ...d, revision: 1 } })).statusCode).toBe(400);
  });

  it("persiste tras reiniciar el servidor (cerrar y abrir el programa)", async () => {
    const m = await mk("Persistente", "Carpeta");
    await app.inject({ method: "PATCH", url: `/api/characters/${m.id}`, payload: { sheet: { ...EMPTY_SHEET("Persistente"), history: "Sigue aquí" } } });
    await app.close();
    app = await buildApp({ dataDir: dir });
    const back = (await app.inject({ url: `/api/characters/${m.id}` })).json();
    expect(back.sheet.history).toBe("Sigue aquí");
    expect(back.folder).toBe("Carpeta");
    expect((await app.inject({ url: "/api/characters" })).json().characters).toHaveLength(1);
  });

  it("guarda y sirve imágenes de referencia; rechaza nombres y tipos peligrosos", async () => {
    const m = await mk("Refs");
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082", "hex");
    const put = await app.inject({ method: "PUT", url: `/api/characters/${m.id}/files/frontal.png`, payload: png, headers: { "content-type": "image/png" } });
    expect(put.statusCode).toBe(201);
    const got = await app.inject({ url: `/api/characters/${m.id}/files/frontal.png` });
    expect(got.statusCode).toBe(200);
    expect(got.headers["content-type"]).toBe("image/png");
    expect(Buffer.compare(got.rawPayload, png)).toBe(0);
    expect((await app.inject({ url: `/api/characters/${m.id}/files` })).json().files).toEqual(["frontal.png"]);
    for (const bad of ["..%2Fx.png", "a.exe", ".oculto.png"]) {
      const r = await app.inject({ method: "PUT", url: `/api/characters/${m.id}/files/${bad}`, payload: png, headers: { "content-type": "image/png" } });
      expect(r.statusCode, bad).toBeGreaterThanOrEqual(400);
    }
    expect((await app.inject({ method: "DELETE", url: `/api/characters/${m.id}/files/frontal.png` })).statusCode).toBe(204);
    expect((await app.inject({ url: `/api/characters/${m.id}/files/frontal.png` })).statusCode).toBe(404);
  });
});
