import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import type { Stroke } from "@gas/core";
import { compositeInk, drawStroke, drawStrokes, paintPieces, type Ctx2D, type DrawOptions } from "../src";

const W = 120;
const H = 80;
const pool = new Map<string, Canvas>();
const scratch = (w: number, h: number) => {
  const key = `${w}x${h}`;
  let c = pool.get(key);
  if (!c) pool.set(key, (c = createCanvas(w, h)));
  return { canvas: c, ctx: c.getContext("2d") as unknown as Ctx2D };
};
const opts = (scale = 1): DrawOptions => ({ pixelWidth: W * scale, pixelHeight: H * scale, scale, scratch });
const mk = (points: number[], extra: Partial<Stroke> = {}): Stroke => ({ id: "s", kind: "pen", color: "#ff0000", size: 10, opacity: 1, sens: 0, points, ...extra });
const fresh = (scale = 1) => {
  const c = createCanvas(W * scale, H * scale);
  return { c, ctx: c.getContext("2d") as SKRSContext2D };
};
const px = (ctx: SKRSContext2D, x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data) as [number, number, number, number];
const asCtx = (c: SKRSContext2D) => c as unknown as Ctx2D;

describe("pintado de trazos", () => {
  it("pinta una línea con el color y el grosor pedidos", () => {
    const { ctx } = fresh();
    drawStroke(asCtx(ctx), mk([10, 40, 1, 110, 40, 1]), opts());
    expect(px(ctx, 60, 40)).toEqual([255, 0, 0, 255]);
    expect(px(ctx, 60, 44)[3]).toBe(255); // dentro de ±5
    expect(px(ctx, 60, 50)[3]).toBe(0); // fuera
    expect(px(ctx, 60, 10)[3]).toBe(0);
  });
  it("un solo punto es un círculo", () => {
    const { ctx } = fresh();
    drawStroke(asCtx(ctx), mk([50, 40, 1], { size: 20 }), opts());
    expect(px(ctx, 50, 40)[3]).toBe(255);
    expect(px(ctx, 58, 40)[3]).toBe(255);
    expect(px(ctx, 65, 40)[3]).toBe(0);
  });
  it("la presión modula el ancho (sens=1: presión 0.2 → 20 % del tamaño; presión 1 → 100 %)", () => {
    const { ctx } = fresh();
    drawStroke(asCtx(ctx), mk([10, 40, 0.2, 40, 40, 0.2, 80, 40, 1, 110, 40, 1], { size: 20, sens: 1 }), opts());
    const thick = (x: number) => { let n = 0; for (let y = 0; y < H; y++) if (px(ctx, x, y)[3] > 128) n++; return n; };
    expect(thick(20)).toBeLessThanOrEqual(6); // ≈ 4 px
    expect(thick(100)).toBeGreaterThanOrEqual(18); // ≈ 20 px
  });
  it("sens=0 ignora la presión (ratón)", () => {
    const { ctx } = fresh();
    drawStroke(asCtx(ctx), mk([10, 40, 0.1, 110, 40, 0.1], { size: 20, sens: 0 }), opts());
    let n = 0;
    for (let y = 0; y < H; y++) if (px(ctx, 60, y)[3] > 128) n++;
    expect(n).toBeGreaterThanOrEqual(19);
  });
  it("el borrador elimina lo de debajo y deja el resto", () => {
    const { ctx } = fresh();
    drawStrokes(asCtx(ctx), [mk([10, 40, 1, 110, 40, 1], { size: 20 }), mk([60, 0, 1, 60, 80, 1], { kind: "eraser", size: 10 })], opts());
    expect(px(ctx, 60, 40)[3]).toBe(0); // borrado
    expect(px(ctx, 30, 40)[3]).toBe(255); // intacto
  });
  it("la opacidad es uniforme aunque el trazo se cruce a sí mismo", () => {
    const { ctx } = fresh();
    // cruz: ambos tramos pertenecen al MISMO trazo
    drawStroke(asCtx(ctx), mk([10, 40, 1, 110, 40, 1, 60, 10, 1, 60, 70, 1], { opacity: 0.5, size: 8 }), opts());
    const a = px(ctx, 30, 40)[3];
    const cruce = px(ctx, 60, 40)[3];
    expect(a).toBeGreaterThan(120);
    expect(a).toBeLessThan(135);
    expect(cruce).toBe(a); // no se acumula
  });
  it("trazos distintos translúcidos SÍ se acumulan", () => {
    const { ctx } = fresh();
    drawStrokes(asCtx(ctx), [mk([10, 40, 1, 110, 40, 1], { opacity: 0.5, size: 8 }), mk([60, 10, 1, 60, 70, 1], { opacity: 0.5, size: 8 })], opts());
    expect(px(ctx, 60, 40)[3]).toBeGreaterThan(px(ctx, 30, 40)[3]);
  });
  it("el borrador con opacidad 0.5 borra a medias", () => {
    const { ctx } = fresh();
    drawStrokes(asCtx(ctx), [mk([10, 40, 1, 110, 40, 1], { size: 30 }), mk([10, 40, 1, 110, 40, 1], { kind: "eraser", opacity: 0.5, size: 30 })], opts());
    const a = px(ctx, 60, 40)[3];
    expect(a).toBeGreaterThan(110);
    expect(a).toBeLessThan(145);
  });
  it("respeta la escala (lienzo al doble de resolución)", () => {
    const { ctx } = fresh(2);
    drawStroke(asCtx(ctx), mk([10, 40, 1, 110, 40, 1]), opts(2));
    expect(px(ctx, 120, 80)[3]).toBe(255);
    expect(px(ctx, 120, 100)[3]).toBe(0);
  });
  it.each([0, 0.8])("el dibujo incremental (en vivo) coincide con el completo (presión sens=%s): misma forma, solo cambia el suavizado en las uniones", (sens) => {
    const pts: number[] = [];
    for (let i = 0; i < 40; i++) pts.push(10 + i * 2.5, 40 + Math.sin(i / 4) * 25, 0.3 + 0.7 * Math.abs(Math.sin(i / 7)));
    const full = mk(pts, { sens, size: 12 });
    const a = fresh();
    drawStroke(asCtx(a.ctx), full, opts());

    const b = fresh();
    const bc = asCtx(b.ctx);
    bc.setTransform(1, 0, 0, 1, 0, 0);
    for (let n = 2; n <= 40; n++) paintPieces(bc, { ...full, points: pts.slice(0, n * 3) }, n - 2, n - 1);
    paintPieces(bc, full, 39, 40);

    // El completo agrupa tramos de grosor parecido en un solo trazado; el vivo dibuja tramo a tramo.
    // Medido: >32 de diferencia en ≈3 % de los píxeles cubiertos y >64 en <1 % (solo bordes antialias).
    const A = a.c.data();
    const B = b.c.data();
    let covered = 0;
    let over32 = 0;
    let over64 = 0;
    for (let i = 3; i < A.length; i += 4) {
      const d = Math.abs(A[i]! - B[i]!);
      if (A[i]! > 0 || B[i]! > 0) covered++;
      if (d > 32) over32++;
      if (d > 64) over64++;
    }
    expect(covered).toBeGreaterThan(1500);
    expect(over32 / covered).toBeLessThan(0.06);
    expect(over64 / covered).toBeLessThan(0.015);
  });
  it("agrupar tramos acelera y no cambia el resultado visible: un trazo de grosor constante es UN solo trazado", () => {
    const calls = { stroke: 0 };
    const ctx = asCtx(fresh().ctx);
    const spy = new Proxy(ctx as object, {
      get(t, k, r) {
        if (k === "stroke") return () => calls.stroke++;
        const v = Reflect.get(t, k, r);
        return typeof v === "function" ? v.bind(t) : v;
      },
      set: (t, k, v) => Reflect.set(t, k, v),
    }) as Ctx2D;
    const pts: number[] = [];
    for (let i = 0; i < 80; i++) pts.push(i * 1.2, 40 + Math.sin(i / 5) * 20, 1);
    paintPieces(spy, mk(pts, { sens: 0.9 }), 0, 80);
    expect(calls.stroke).toBe(1);
  });
  it("compositeInk aplica opacidad al trazo vivo", () => {
    const live = fresh();
    paintPieces(asCtx(live.ctx), mk([10, 40, 1, 110, 40, 1]), 0, 2);
    const dst = fresh();
    compositeInk(asCtx(dst.ctx), live.c, { kind: "pen", opacity: 0.5 });
    expect(px(dst.ctx, 60, 40)[3]).toBeGreaterThan(120);
    expect(px(dst.ctx, 60, 40)[3]).toBeLessThan(135);
  });
});
