import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAnimation, shortId, type Animation, type Bone, type Stroke } from "@gas/core";
import { addFrame, addStroke, createSkeleton, posedFrame, setBinding, setHold, setPose } from "@gas/engine";
import { probeCapabilities, runExport, type ExportRequest } from "../src";
import { decodeFrames, readStoredZip, redCentroid, tmpDir } from "./helpers";

const near = (a: number, b: number, d = 1) => expect(Math.abs(a - b), `${a} ≈ ${b}`).toBeLessThanOrEqual(d);

let dir = "";
let cleanup: () => Promise<void>;
beforeAll(async () => ({ dir, cleanup } = await tmpDir()));
afterAll(() => cleanup());

const caps = await probeCapabilities();
const video = caps.available && caps.ffprobe && caps.h264 ? describe : describe.skip;

const bone = (id: string, parent: string | null, o: Partial<Bone> = {}): Bone => ({ id, name: id, parent, x: 0, y: 0, ax: 1, ay: 0, angle: 0, length: 60, min: -180, max: 180, ...o });
const dot = (x: number, y: number, color: string, size = 40): Stroke => ({ id: shortId(), kind: "pen", color, size, opacity: 1, sens: 0, points: [x, y, 1, x, y + 0.1, 1] });

/** Un «brazo» de un solo hueso con un punto rojo en su extremo, a 160×160: gira alrededor de (80,80). */
function armAnim(): { a: Animation; skId: string; layerId: string } {
  let a = createAnimation({ episodeId: "e", fps: 12, width: 160, height: 160 });
  const r = createSkeleton(a, "Brazo", [bone("b", null, { x: 80, y: 80, angle: 0, length: 60 })]);
  a = r.doc;
  const layerId = a.layers[1]!.id;
  a = setBinding(a, r.skeletonId, layerId, { mode: "rigid", bone: "b", influences: [], softness: 20, sharpness: 3 });
  a = addStroke(a, a.frames[0]!.id, layerId, dot(140, 80, "#ff0000")); // el punto en el extremo del hueso (cola en x=140)
  return { a, skId: r.skeletonId, layerId };
}

const req = (a: Animation, o: Partial<ExportRequest> = {}): ExportRequest => ({
  animation: a, format: "png", resolution: { kind: "original" }, quality: "high", background: { transparent: false, color: "#ffffff" }, outputDir: dir, fileName: `r-${Math.random().toString(36).slice(2)}.png`, overwrite: false, ...o,
});

async function pixelAt(file: string, x: number, y: number): Promise<number[]> {
  const img = await loadImage(await readFile(file));
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  return Array.from(ctx.getImageData(x, y, 1, 1).data);
}

describe("exportación de personajes con rig (PNG)", () => {
  it("el PNG exportado muestra la POSE: el punto rojo gira de (140,80) a (80,140)", async () => {
    const { a, skId } = armAnim();
    const rest = await runExport(req(a));
    expect((await pixelAt(rest.file, 140, 80))[0]).toBe(255);
    expect((await pixelAt(rest.file, 80, 140))[0]).toBe(255); // blanco: R=255, G=255
    expect((await pixelAt(rest.file, 80, 140))[1]).toBe(255);

    const posed = await runExport(req(setPose(a, 0, skId, { b: { r: 90 } })));
    const p = await pixelAt(posed.file, 80, 140);
    expect(p.slice(0, 3)).toEqual([255, 0, 0]); // ahora el rojo está abajo
    expect((await pixelAt(posed.file, 140, 80))[1]).toBe(255); // y ya no donde estaba
  });

  it("la exportación pinta EXACTAMENTE el mismo fotograma que calcula el motor (mismo código)", async () => {
    const { a, skId } = armAnim();
    const posedDoc = setPose(a, 0, skId, { b: { r: 37 } });
    const f = posedFrame(posedDoc, 0);
    const pts = f.cells[posedDoc.layers[1]!.id]![0]!.points;
    const r = await runExport(req(posedDoc));
    const px = await pixelAt(r.file, Math.round(pts[0]!), Math.round(pts[1]!));
    expect(px.slice(0, 3)).toEqual([255, 0, 0]);
  });

  it("la resolución mayor re-renderiza el rig a esa escala (no estira una imagen)", async () => {
    const { a, skId } = armAnim();
    const r = await runExport(req(setPose(a, 0, skId, { b: { r: 90 } }), { resolution: { kind: "short-side", px: 320 } })); // ×2
    expect((await pixelAt(r.file, 160, 280))[0]).toBe(255);
    expect((await pixelAt(r.file, 160, 280))[1]).toBe(0);
  });

  it("secuencia PNG: cada fotograma lleva su pose interpolada entre keyframes, respetando las duraciones", async () => {
    let { a, skId } = armAnim();
    a = addFrame(addFrame(a, 0).doc, 1).doc; // 3 dibujos
    // el personaje (trazo) existe en los 3 dibujos: se copia el trazo
    const layer = a.layers[1]!.id;
    a = { ...a, frames: a.frames.map((f, i) => (i === 0 ? f : { ...f, cells: { [layer]: a.frames[0]!.cells[layer]! } })) };
    a = setHold(setHold(setHold(a, a.frames[0]!.id, 1), a.frames[1]!.id, 1), a.frames[2]!.id, 2);
    a = setPose(a, 0, skId, { b: { r: 0 } });
    a = setPose(a, 2, skId, { b: { r: 90 } }); // ticks 0 y 2: el fotograma 1 (tick 1) queda a 45°
    const r = await runExport(req(a, { format: "png-seq", fileName: "seq.zip", background: { transparent: true, color: "#ffffff" } }));
    expect(r.frames).toBe(4);
    const entries = readStoredZip(await readFile(r.file));
    const where = async (i: number): Promise<[number, number]> => {
      const img = await loadImage(entries[i]!.data);
      const c = createCanvas(160, 160);
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, 160, 160).data;
      let sx = 0, sy = 0, n = 0;
      for (let k = 0; k < d.length; k += 4) if (d[k + 3]! > 128) { sx += (k / 4) % 160; sy += Math.floor(k / 4 / 160); n++; }
      return [sx / n, sy / n];
    };
    const [p0, p1, p2, p3] = [await where(0), await where(1), await where(2), await where(3)];
    near(p0[0], 140, 1.5); near(p0[1], 80, 1.5); // 0°
    const r45: [number, number] = [80 + 60 * Math.cos(Math.PI / 4), 80 + 60 * Math.sin(Math.PI / 4)];
    near(p1[0], r45[0], 1.5); near(p1[1], r45[1], 1.5); // 45° (a mitad de tiempo)
    near(p2[0], 80, 1.5); near(p2[1], 140, 1.5); // 90° (tick 2)
    expect(p3).toEqual(p2); // el último dibujo dura 2 ticks: la misma pose
  });
});

video("exportación de personajes con rig (vídeo)", () => {
  it("MP4: el punto rojo recorre el arco y CADA fotograma coincide con la pose esperada (12 y 30 FPS)", async () => {
    let { a, skId } = armAnim();
    for (let i = 0; i < 4; i++) a = addFrame(a, a.frames.length - 1).doc;
    const layer = a.layers[1]!.id;
    a = { ...a, frames: a.frames.map((f) => ({ ...f, cells: { [layer]: a.frames[0]!.cells[layer]! } })) };
    a = setPose(a, 0, skId, { b: { r: 0 } });
    a = setPose(a, 4, skId, { b: { r: 180 } }); // 5 dibujos (ticks 0..4): 45° por dibujo
    for (const fps of [12, 30]) {
      const r = await runExport(req(a, { format: "mp4", fileName: `arco-${fps}.mp4`, fps, quality: "max" }));
      const frames = await decodeFrames(join(dir, `arco-${fps}.mp4`), 160, 160);
      expect(frames).toHaveLength(r.frames);
      expect(r.frames).toBe(Math.round((5 / 12) * fps));
      frames.forEach((f, k) => {
        const tick = Math.floor((k * 12) / fps + 1e-9); // el dibujo que se ve en el instante k/fps
        const ang = (45 * tick * Math.PI) / 180;
        const c = redCentroid(f, 160, 160)!;
        expect(c, `fotograma ${k} a ${fps} FPS`).not.toBeNull();
        near(c[0], 80 + 60 * Math.cos(ang), 2.5);
        near(c[1], 80 + 60 * Math.sin(ang), 2.5);
      });
    }
  }, 120_000);

  it("WebM con transparencia y rig: el fondo es transparente y el personaje está en su pose", async () => {
    const { a, skId } = armAnim();
    const r = await runExport(req(setPose(a, 0, skId, { b: { r: 90 } }), { format: "webm", fileName: "rig.webm", background: { transparent: true, color: "#ffffff" } }));
    expect(r.format).toBe("webm");
    expect(r.bytes).toBeGreaterThan(300);
  });
});
