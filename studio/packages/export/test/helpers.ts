import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAnimation, shortId, type Animation, type Stroke } from "@gas/core";
import { ffmpegPaths } from "../src";

export const RED = [255, 0, 0] as const;
export const GREEN = [0, 200, 0] as const;
export const BLUE = [0, 0, 255] as const;
export type RGB = readonly [number, number, number];

export const hex = (c: RGB) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** Un trazo ancho que cubre todo el fotograma con un color liso: cada dibujo se reconoce por su color. */
export function solid(color: RGB, w: number, h: number, id = shortId()): Stroke {
  return { id, kind: "pen", color: hex(color), size: Math.min(h * 2, 2000), opacity: 1, sens: 0, points: [0, h / 2, 1, w, h / 2, 1] };
}

export interface Drawing {
  color: RGB;
  hold?: number;
}

/** Animación real de varios fotogramas, cada uno de un color y con su duración. */
export function colorAnim(o: { fps: number; width: number; height: number; drawings: Drawing[] }): Animation {
  const a = createAnimation({ episodeId: "ep", fps: o.fps, width: o.width, height: o.height });
  const layer = a.layers[1]!.id;
  return {
    ...a,
    frames: o.drawings.map((d, i) => ({ id: `f${i}`, hold: d.hold ?? 1, cells: { [layer]: [solid(d.color, o.width, o.height)] } })),
  };
}

/** Independiente de la implementación: qué dibujo se ve en el instante t, sumando duraciones en segundos. */
export function drawingAtTime(a: Animation, t: number): number {
  let acc = 0;
  for (let i = 0; i < a.frames.length; i++) {
    acc += a.frames[i]!.hold / a.fps;
    if (t < acc - 1e-9) return i;
  }
  return a.frames.length - 1;
}

export async function tmpDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "gas-export-"));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** Decodifica TODOS los fotogramas de un vídeo y devuelve el píxel (0,0) de cada uno, con FFmpeg real. */
export function decodeCorner(file: string, o: { alpha?: boolean } = {}): Promise<Array<[number, number, number, number]>> {
  return new Promise((resolve, reject) => {
    const args = [...(o.alpha ? ["-c:v", "libvpx-vp9"] : []), "-v", "error", "-i", file, "-vf", "scale=2:2:flags=neighbor", "-f", "rawvideo", "-pix_fmt", "rgba", "-"];
    const p = spawn(ffmpegPaths().ffmpeg, args);
    const chunks: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (d: Buffer) => chunks.push(d));
    p.stderr.on("data", (d: Buffer) => (err += d));
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg ${code}: ${err}`));
      const b = Buffer.concat(chunks);
      const frame = 2 * 2 * 4;
      const out: Array<[number, number, number, number]> = [];
      for (let i = 0; i + frame <= b.length; i += frame) out.push([b[i]!, b[i + 1]!, b[i + 2]!, b[i + 3]!]);
      resolve(out);
    });
  });
}

/** ¿El color decodificado se parece al esperado? (los códecs con pérdida alteran unos pocos niveles) */
export const near = (got: ArrayLike<number>, want: RGB, tol = 14) => want.every((v, i) => Math.abs(got[i]! - v) <= tol);

/** Lector mínimo de ZIP con entradas SIN comprimir (lo que escribe el exportador). */
export function readStoredZip(buf: Buffer): Array<{ name: string; data: Buffer }> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("ZIP sin directorio central");
  const total = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out: Array<{ name: string; data: Buffer }> = [];
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error("directorio central corrupto");
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString("utf8");
    if (method !== 0) throw new Error("entrada comprimida");
    const lnl = buf.readUInt16LE(local + 26);
    const lel = buf.readUInt16LE(local + 28);
    out.push({ name, data: buf.subarray(local + 30 + lnl + lel, local + 30 + lnl + lel + csize) });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
