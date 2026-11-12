import { describe, expect, it } from "vitest";
import { createAnimation, shortId, type Animation, type Stroke } from "@gas/core";
import { setLayerProps } from "@gas/engine";
import { FrameRenderer } from "../src/pipeline";

const W = 120, H = 80;
const fill = (color: string, pts: number[][], opacity = 1): Stroke => ({ id: shortId(), kind: "fill", color, size: 1, opacity, sens: 0, points: pts.flatMap(([x, y]) => [x!, y!, 1]) });
const rect = (x0: number, y0: number, x1: number, y1: number): number[][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function render(a: Animation): Buffer {
  const r = new FrameRenderer(a, W, H, "#ffffff");
  return r.rgba(0);
}
const px = (b: Buffer, x: number, y: number) => [b[(y * W + x) * 4]!, b[(y * W + x) * 4 + 1]!, b[(y * W + x) * 4 + 2]!];

function base(): { a: Animation; base: string; top: string } {
  const a0 = createAnimation({ episodeId: "e", fps: 12, width: W, height: H });
  return { a: a0, base: a0.layers[0]!.id, top: a0.layers[1]!.id };
}

describe("capas con acabado (Fase 4)", () => {
  it("un trazo «fill» rellena una forma cerrada", () => {
    const { a, base: b } = base();
    const doc = { ...a, frames: [{ ...a.frames[0]!, cells: { [b]: [fill("#ff0000", rect(20, 20, 60, 60))] } }] };
    const out = render(doc);
    expect(px(out, 40, 40)).toEqual([255, 0, 0]);
    expect(px(out, 90, 40)).toEqual([255, 255, 255]);
  });

  it("multiplicar oscurece lo de debajo; opacidad la mezcla", () => {
    const { a, base: b, top } = base();
    let doc: Animation = { ...a, frames: [{ ...a.frames[0]!, cells: { [b]: [fill("#ffaa88", rect(10, 10, 100, 70))], [top]: [fill("#808080", rect(10, 10, 100, 70))] } }] };
    doc = setLayerProps(doc, top, { blend: "multiply" });
    const m = px(render(doc), 50, 40);
    expect(m[0]).toBeCloseTo(255 * 128 / 255, -1);
    expect(m[1]).toBeCloseTo(170 * 128 / 255, -1);
    const half = px(render(setLayerProps(setLayerProps(doc, top, { blend: undefined }), top, { opacity: 0.5 })), 50, 40);
    expect(half[0]).toBeGreaterThan(180); expect(half[0]).toBeLessThan(215); // 255·.5 + 128·.5 ≈ 191
  });

  it("el recorte limita la capa a la forma de la capa base", () => {
    const { a, base: b, top } = base();
    const doc0: Animation = { ...a, frames: [{ ...a.frames[0]!, cells: { [b]: [fill("#00aa00", rect(20, 20, 60, 60))], [top]: [fill("#000000", rect(0, 0, 120, 80))] } }] };
    const clipped = render(setLayerProps(doc0, top, { clip: true }));
    expect(px(clipped, 40, 40)).toEqual([0, 0, 0]); // dentro de la base
    expect(px(clipped, 100, 40)).toEqual([255, 255, 255]); // fuera de la base: no se pinta
    const free = render(doc0);
    expect(px(free, 100, 40)).toEqual([0, 0, 0]);
  });

  it("el desenfoque suaviza el borde", () => {
    const { a, base: b } = base();
    const doc0: Animation = { ...a, frames: [{ ...a.frames[0]!, cells: { [b]: [fill("#000000", rect(40, 10, 80, 70))] } }] };
    const hard = px(render(doc0), 38, 40);
    const soft = px(render(setLayerProps(doc0, b, { blur: 6 })), 38, 40);
    expect(hard[0]).toBe(255);
    expect(soft[0]).toBeLessThan(250); // la sombra se «escapa» del borde
    expect(soft[0]).toBeGreaterThan(40);
  });
});
