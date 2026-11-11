import { describe, expect, it } from "vitest";
import { createAnimation, type Animation, type Stroke } from "@gas/core";
import {
  EngineError,
  History,
  addFrame,
  addLayer,
  addStroke,
  deleteFrame,
  duplicateFrame,
  frameIndexAtTick,
  moveLayer,
  removeLayer,
  removeStrokes,
  renameLayer,
  replaceStrokes,
  setFps,
  setHold,
  setLayerLocked,
  setLayerVisible,
  strokesOf,
  tickAtElapsed,
  tickOfFrame,
  totalTicks,
} from "../src";

const mk = (id: string, x = 0): Stroke => ({ id, kind: "pen", color: "#112233", size: 4, opacity: 1, sens: 0, points: [x, 0, 1, x + 10, 0, 1] });
const base = (): Animation => createAnimation({ episodeId: "e", fps: 24, width: 640, height: 360 });

describe("capas", () => {
  it("añade encima de otra y por defecto arriba del todo", () => {
    const a = base();
    const [c, l] = a.layers;
    const r1 = addLayer(a, "Boceto", c!.id);
    expect(r1.doc.layers.map((x) => x.name)).toEqual(["Color", "Boceto", "Líneas"]);
    const r2 = addLayer(a);
    expect(r2.doc.layers.at(-1)!.name).toBe("Capa 3");
    expect(l).toBeDefined();
  });
  it("renombra, oculta y bloquea sin mutar", () => {
    const a = base();
    const id = a.layers[0]!.id;
    expect(renameLayer(a, id, "  Fondo ").layers[0]!.name).toBe("Fondo");
    expect(() => renameLayer(a, id, "  ")).toThrowError(EngineError);
    expect(setLayerVisible(a, id, false).layers[0]!.visible).toBe(false);
    expect(setLayerLocked(a, id, true).layers[0]!.locked).toBe(true);
    expect(a.layers[0]!.visible).toBe(true);
  });
  it("reordena y respeta los bordes", () => {
    const a = base();
    const [c, l] = a.layers.map((x) => x.id) as [string, string];
    expect(moveLayer(a, c, 1).layers.map((x) => x.id)).toEqual([l, c]);
    expect(moveLayer(a, l, 1)).toBe(a);
    expect(moveLayer(a, c, -1)).toBe(a);
  });
  it("eliminar una capa borra sus trazos en todos los fotogramas, pero no la última capa", () => {
    let a = base();
    const [c, l] = a.layers.map((x) => x.id) as [string, string];
    a = addStroke(a, a.frames[0]!.id, c, mk("a"));
    a = addStroke(a, a.frames[0]!.id, l, mk("b"));
    a = removeLayer(a, c);
    expect(a.frames[0]!.cells).toEqual({ [l]: [mk("b")] });
    expect(() => removeLayer(a, l)).toThrowError(/al menos una capa/);
  });
});

describe("fotogramas", () => {
  it("añade tras el actual, duplica y elimina", () => {
    let a = base();
    const l = a.layers[1]!.id;
    a = addStroke(a, a.frames[0]!.id, l, mk("a"));
    const d = duplicateFrame(a, 0);
    expect(d.doc.frames).toHaveLength(2);
    expect(strokesOf(d.doc.frames[1]!, l)).toBe(strokesOf(d.doc.frames[0]!, l)); // compartido
    const n = addFrame(d.doc, 0);
    expect(n.doc.frames[1]!.id).toBe(n.frameId);
    expect(n.doc.frames).toHaveLength(3);
    const del = deleteFrame(n.doc, 1);
    expect(del.frames).toHaveLength(2);
    expect(() => deleteFrame(base(), 0)).toThrowError(/al menos un fotograma/);
  });
  it("editar un fotograma duplicado no altera el original", () => {
    let a = base();
    const l = a.layers[1]!.id;
    a = addStroke(a, a.frames[0]!.id, l, mk("a"));
    const d = duplicateFrame(a, 0);
    const edited = addStroke(d.doc, d.frameId, l, mk("b"));
    expect(strokesOf(edited.frames[0]!, l).map((s) => s.id)).toEqual(["a"]);
    expect(strokesOf(edited.frames[1]!, l).map((s) => s.id)).toEqual(["a", "b"]);
  });
  it("duración y fps validados", () => {
    const a = base();
    expect(setHold(a, a.frames[0]!.id, 2).frames[0]!.hold).toBe(2);
    expect(() => setHold(a, a.frames[0]!.id, 0)).toThrowError(EngineError);
    expect(() => setHold(a, a.frames[0]!.id, 1.5)).toThrowError(EngineError);
    expect(setFps(a, 30).fps).toBe(30);
    expect(() => setFps(a, 0)).toThrowError(EngineError);
  });
});

describe("trazos", () => {
  it("añade, reemplaza conservando el orden y elimina", () => {
    let a = base();
    const [f, l] = [a.frames[0]!.id, a.layers[1]!.id];
    for (const id of ["a", "b", "c"]) a = addStroke(a, f, l, mk(id));
    a = replaceStrokes(a, f, l, new Map([["b", mk("b", 99)]]));
    expect(strokesOf(a.frames[0]!, l).map((s) => [s.id, s.points[0]])).toEqual([["a", 0], ["b", 99], ["c", 0]]);
    a = removeStrokes(a, f, l, new Set(["a", "c"]));
    expect(strokesOf(a.frames[0]!, l).map((s) => s.id)).toEqual(["b"]);
    a = removeStrokes(a, f, l, new Set(["b"]));
    expect(a.frames[0]!.cells).toEqual({}); // sin celdas vacías
  });
  it("no deja editar capas bloqueadas, ocultas o inexistentes", () => {
    const a = base();
    const [f, l] = [a.frames[0]!.id, a.layers[1]!.id];
    expect(() => addStroke(setLayerLocked(a, l, true), f, l, mk("x"))).toThrowError(/bloqueada/);
    expect(() => addStroke(setLayerVisible(a, l, false), f, l, mk("x"))).toThrowError(/oculta/);
    expect(() => addStroke(a, f, "nope", mk("x"))).toThrowError(EngineError);
    expect(() => addStroke(a, "nope", l, mk("x"))).toThrowError(EngineError);
  });
  it("las operaciones no mutan el documento anterior", () => {
    const a = base();
    const snap = JSON.stringify(a);
    addStroke(a, a.frames[0]!.id, a.layers[0]!.id, mk("z"));
    addFrame(a, 0);
    addLayer(a);
    expect(JSON.stringify(a)).toBe(snap);
  });
});

describe("historial", () => {
  it("deshacer/rehacer recupera exactamente los trazos, también tras cambiar capa y fotograma", () => {
    const h = new History(base());
    const l0 = h.present.layers[0]!.id;
    const l1 = h.present.layers[1]!.id;
    h.commit(addStroke(h.present, h.present.frames[0]!.id, l1, mk("a")));
    const f2 = addFrame(h.present, 0);
    h.commit(f2.doc); // cambia de fotograma
    h.commit(addStroke(h.present, f2.frameId, l0, mk("b"))); // y de capa
    const afterAll = h.present;
    expect(h.undo()).toBe(true);
    expect(h.undo()).toBe(true);
    expect(h.present.frames).toHaveLength(1);
    expect(strokesOf(h.present.frames[0]!, l1).map((s) => s.id)).toEqual(["a"]);
    expect(h.redo()).toBe(true);
    expect(h.redo()).toBe(true);
    expect(h.present).toBe(afterAll);
    expect(h.canRedo).toBe(false);
  });
  it("un cambio nuevo descarta el futuro; no registra cambios nulos", () => {
    const h = new History(base());
    const l = h.present.layers[0]!.id;
    h.commit(h.present);
    expect(h.canUndo).toBe(false);
    h.commit(addStroke(h.present, h.present.frames[0]!.id, l, mk("a")));
    h.undo();
    expect(h.canRedo).toBe(true);
    h.commit(addStroke(h.present, h.present.frames[0]!.id, l, mk("b")));
    expect(h.canRedo).toBe(false);
  });
  it("operación transitoria: una sola entrada y cancelable", () => {
    const h = new History(base());
    const [f, l] = [h.present.frames[0]!.id, h.present.layers[0]!.id];
    h.commit(addStroke(h.present, f, l, mk("a")));
    h.beginTransient();
    for (let i = 1; i <= 10; i++) h.setTransient(replaceStrokes(h.present, f, l, new Map([["a", mk("a", i * 10)]])));
    h.commitTransient();
    expect(strokesOf(h.present.frames[0]!, l)[0]!.points[0]).toBe(100);
    h.undo();
    expect(strokesOf(h.present.frames[0]!, l)[0]!.points[0]).toBe(0); // un solo undo revierte todo el arrastre
    h.redo();
    h.beginTransient();
    h.setTransient(removeStrokes(h.present, f, l, new Set(["a"])));
    h.cancelTransient();
    expect(strokesOf(h.present.frames[0]!, l)).toHaveLength(1);
  });
  it("respeta el límite sin perder el estado presente", () => {
    const h = new History(base(), 3);
    const [f, l] = [h.present.frames[0]!.id, h.present.layers[0]!.id];
    for (let i = 0; i < 10; i++) h.commit(addStroke(h.present, f, l, mk(`s${i}`)));
    let n = 0;
    while (h.undo()) n++;
    expect(n).toBe(3);
    expect(strokesOf(h.present.frames[0]!, l)).toHaveLength(7);
  });
  it("version aumenta con cada cambio", () => {
    const h = new History(base());
    const v0 = h.version;
    h.commit(addLayer(h.present).doc);
    expect(h.version).toBeGreaterThan(v0);
    const v1 = h.version;
    h.undo();
    expect(h.version).toBeGreaterThan(v1);
  });
});

describe("reproducción", () => {
  const a = (() => {
    let d = base();
    d = addFrame(d, 0).doc;
    d = addFrame(d, 1).doc;
    return setHold(setHold(d, d.frames[0]!.id, 2), d.frames[2]!.id, 3);
  })(); // duraciones 2,1,3
  it("suma duraciones y mapea ticks a dibujos (con «dobles»)", () => {
    expect(totalTicks(a)).toBe(6);
    expect([0, 1, 2, 3, 4, 5].map((t) => frameIndexAtTick(a, t))).toEqual([0, 0, 1, 2, 2, 2]);
    expect(tickOfFrame(a, 2)).toBe(3);
  });
  it("bucle y modo sin bucle", () => {
    expect(frameIndexAtTick(a, 6)).toBe(0);
    expect(frameIndexAtTick(a, -1)).toBe(2);
    expect(frameIndexAtTick(a, 99, false)).toBe(2);
  });
  it.each([12, 24, 30])("a %i FPS pasan exactamente %i ticks por segundo", (fps) => {
    expect(tickAtElapsed(1000, fps)).toBe(fps);
    expect(tickAtElapsed(999, fps)).toBe(fps - 1);
    expect(tickAtElapsed(0, fps)).toBe(0);
  });
});
