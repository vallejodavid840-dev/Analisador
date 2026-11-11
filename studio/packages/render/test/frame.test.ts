import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import type { Frame, Layer, Stroke } from "@gas/core";
import { composeFrame, type ComposeOptions, type Ctx2D } from "../src";

const pool = new Map<string, Canvas>();
const mkScratch = (kind: string) => (w: number, h: number) => {
  const k = `${kind}${w}x${h}`;
  let c = pool.get(k);
  if (!c) pool.set(k, (c = createCanvas(w, h)));
  return { canvas: c, ctx: c.getContext("2d") as unknown as Ctx2D };
};
const layerScratch = mkScratch("l");
const opacityScratch = mkScratch("o");

const L = (id: string, visible = true): Layer => ({ id, name: id, visible, locked: false });
const S = (id: string, color: string, pts: number[], extra: Partial<Stroke> = {}): Stroke => ({ id, kind: "pen", color, size: 20, opacity: 1, sens: 0, points: pts, ...extra });
const frame = (cells: Frame["cells"]): Frame => ({ id: "f", hold: 1, cells });

function render(layers: Layer[], f: Frame, o: Partial<ComposeOptions> = {}, w = 100, h = 60) {
  const c = createCanvas(w, h);
  composeFrame(c.getContext("2d") as unknown as Ctx2D, layers, f, { pixelWidth: w, pixelHeight: h, scale: 1, background: null, layerScratch, opacityScratch, ...o });
  const ctx = c.getContext("2d") as SKRSContext2D;
  return (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data) as [number, number, number, number];
}

describe("composeFrame", () => {
  const red = S("r", "#ff0000", [10, 30, 1, 90, 30, 1]);
  const blue = S("b", "#0000ff", [50, 5, 1, 50, 55, 1]);

  it("las capas se componen de abajo a arriba", () => {
    const f = frame({ a: [red], b: [blue] });
    expect(render([L("a"), L("b")], f)(50, 30)).toEqual([0, 0, 255, 255]); // azul arriba
    expect(render([L("b"), L("a")], f)(50, 30)).toEqual([255, 0, 0, 255]); // invertido: rojo arriba
  });

  it("una capa oculta no se pinta; una capa sin trazos no molesta", () => {
    const f = frame({ a: [red], b: [blue] });
    const px = render([L("a"), L("b", false), L("vacia")], f);
    expect(px(50, 30)).toEqual([255, 0, 0, 255]);
    expect(px(50, 8)[3]).toBe(0); // el azul oculto no aparece
  });

  it("fondo: transparente (null) o de color opaco", () => {
    const f = frame({ a: [red] });
    expect(render([L("a")], f)(5, 5)).toEqual([0, 0, 0, 0]);
    expect(render([L("a")], f, { background: "#ffffff" })(5, 5)).toEqual([255, 255, 255, 255]);
    expect(render([L("a")], f, { background: "#102030" })(5, 5)).toEqual([16, 32, 48, 255]);
  });

  it("el borrador solo afecta a su propia capa", () => {
    const eraser = S("e", "#000000", [50, 5, 1, 50, 55, 1], { kind: "eraser", size: 30 });
    const f = frame({ a: [red], b: [blue, eraser] }); // el borrador de «b» no debe tocar el rojo de «a»
    const px = render([L("a"), L("b")], f);
    expect(px(50, 30)).toEqual([255, 0, 0, 255]); // rojo intacto (el azul fue borrado)
    const f2 = frame({ a: [red, eraser], b: [blue] }); // el borrador de «a» sí borra su rojo, el azul de «b» queda
    expect(render([L("a"), L("b")], f2)(50, 30)).toEqual([0, 0, 255, 255]);
    expect(render([L("a"), L("b")], f2)(62, 30)[3]).toBe(0); // zona borrada: sin rojo y fuera del azul → transparente
    expect(render([L("a"), L("b")], f2)(20, 30)).toEqual([255, 0, 0, 255]); // fuera del borrador el rojo sigue
  });

  it("la opacidad de cada trazo se respeta", () => {
    const f = frame({ a: [S("h", "#000000", [10, 30, 1, 90, 30, 1], { opacity: 0.5 })] });
    const a = render([L("a")], f)(50, 30)[3];
    expect(a).toBeGreaterThan(120);
    expect(a).toBeLessThan(135);
  });

  it("escala: a doble resolución el trazo mantiene su posición y su grosor relativos", () => {
    const f = frame({ a: [red] });
    const px = render([L("a")], f, { scale: 2 }, 200, 120);
    expect(px(100, 60)).toEqual([255, 0, 0, 255]);
    expect(px(100, 60 + 18)[3]).toBe(255); // grosor 20 → ±20 px a escala 2
    expect(px(100, 60 + 25)[3]).toBe(0);
  });
});
