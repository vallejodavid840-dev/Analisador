import { describe, expect, it } from "vitest";
import {
  IDENTITY,
  apply,
  hitStroke,
  multiply,
  rectsIntersect,
  rotateAbout,
  scaleAbout,
  strokeBounds,
  transformStroke,
  translation,
  unionBounds,
  type Stroke,
} from "../src";

const stroke = (points: number[], size = 10): Stroke => ({ id: "s", kind: "pen", color: "#000000", size, opacity: 1, sens: 0, points });

describe("matrices", () => {
  it("multiply aplica m2 primero", () => {
    const m = multiply(translation(10, 0), scaleAbout(2, 2, 0, 0));
    expect(apply(m, 1, 1)).toEqual([12, 2]);
  });
  it("escala alrededor de un punto lo deja fijo", () => {
    const [x, y] = apply(scaleAbout(3, 0.5, 5, 7), 5, 7);
    expect(x).toBeCloseTo(5);
    expect(y).toBeCloseTo(7);
  });
  it("rotar 90° alrededor del origen", () => {
    const [x, y] = apply(rotateAbout(Math.PI / 2, 0, 0), 1, 0);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(1);
  });
  it("rotar alrededor de un centro lo deja fijo", () => {
    const [x, y] = apply(rotateAbout(1.234, 50, 60), 50, 60);
    expect(x).toBeCloseTo(50);
    expect(y).toBeCloseTo(60);
  });
  it("identidad", () => expect(apply(IDENTITY, 3, 4)).toEqual([3, 4]));
});

describe("trazos", () => {
  const s = stroke([0, 0, 1, 100, 0, 1, 100, 100, 1], 10);
  it("calcula la caja incluyendo el grosor", () => {
    expect(strokeBounds(s)).toEqual({ x: -5, y: -5, w: 110, h: 110 });
  });
  it("hit test cerca y lejos de la línea", () => {
    expect(hitStroke(s, 50, 3)).toBe(true);
    expect(hitStroke(s, 50, 20)).toBe(false);
    expect(hitStroke(s, 50, 20, 20)).toBe(true);
  });
  it("hit test de un punto suelto", () => {
    const dot = stroke([10, 10, 1], 10);
    expect(hitStroke(dot, 13, 10)).toBe(true);
    expect(hitStroke(dot, 30, 10)).toBe(false);
  });
  it("transformStroke traslada y escala el grosor", () => {
    const t = transformStroke(s, multiply(translation(5, 5), scaleAbout(2, 2, 0, 0)));
    expect(t.points.slice(0, 3)).toEqual([5, 5, 1]);
    expect(t.points.slice(3, 6)).toEqual([205, 5, 1]);
    expect(t.size).toBeCloseTo(20);
    expect(s.points[0]).toBe(0); // no muta
  });
  it("unión e intersección de cajas", () => {
    const u = unionBounds([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 20, w: 5, h: 5 }]);
    expect(u).toEqual({ x: 0, y: 0, w: 25, h: 25 });
    expect(unionBounds([])).toBeNull();
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 5, h: 5 })).toBe(true);
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 11, y: 0, w: 5, h: 5 })).toBe(false);
  });
});
