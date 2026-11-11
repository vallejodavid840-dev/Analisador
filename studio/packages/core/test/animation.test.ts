import { describe, expect, it } from "vitest";
import { AnimationSchema, ProjectFormatError, createAnimation, parseAnimation, shortId, ID_PATTERN } from "../src";

describe("animación", () => {
  it("crea una animación válida con dos capas y un fotograma", () => {
    const a = createAnimation({ episodeId: "ep1", fps: 24, width: 1920, height: 1080 });
    expect(a.layers.map((l) => l.name)).toEqual(["Color", "Líneas"]);
    expect(a.frames).toHaveLength(1);
    expect(AnimationSchema.safeParse(a).success).toBe(true);
  });
  it("shortId cumple el patrón de ids y no se repite", () => {
    const ids = new Set(Array.from({ length: 500 }, shortId));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(ID_PATTERN.test(id)).toBe(true);
  });
  it("ida y vuelta por JSON", () => {
    const a = createAnimation({ episodeId: "ep1", fps: 12, width: 1280, height: 720 });
    expect(parseAnimation(JSON.parse(JSON.stringify(a)))).toEqual(a);
  });
  type Raw = { fps: number; layers: unknown[]; frames: Array<{ hold: number; cells: Record<string, unknown> }> };
  const badStroke = (over: Record<string, unknown>) => ({ id: "s", kind: "pen", color: "#000000", size: 5, opacity: 1, sens: 0, points: [1, 2, 1], ...over });
  it.each<[string, (a: Raw) => void]>([
    ["points no múltiplo de 3", (a) => void (a.frames[0]!.cells["x"] = [badStroke({ points: [1, 2] })])],
    ["color inválido", (a) => void (a.frames[0]!.cells["x"] = [badStroke({ color: "rojo" })])],
    ["sin capas", (a) => void (a.layers = [])],
    ["hold fuera de rango", (a) => void (a.frames[0]!.hold = 0)],
    ["fps cero", (a) => void (a.fps = 0)],
  ])("rechaza: %s", (_n, mutate) => {
    const a = JSON.parse(JSON.stringify(createAnimation({ episodeId: "e", fps: 24, width: 100, height: 100 }))) as Raw;
    mutate(a);
    expect(() => parseAnimation(a)).toThrowError(ProjectFormatError);
  });
  it("rechaza versiones futuras", () => {
    const a = { ...createAnimation({ episodeId: "e", fps: 24, width: 100, height: 100 }), schemaVersion: 9 };
    expect(() => parseAnimation(a)).toThrowError(/más nueva/);
  });
});
