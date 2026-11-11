import { describe, expect, it } from "vitest";
import { ExportError, describeFfmpegFailure, nextFreeName, outputSize, planFrames, sanitizeFileName } from "../src";
import { BLUE, GREEN, RED, colorAnim, drawingAtTime } from "./helpers";

describe("planFrames: coincide con el reproductor del editor", () => {
  const a = colorAnim({ fps: 24, width: 320, height: 180, drawings: [{ color: RED, hold: 2 }, { color: GREEN }, { color: BLUE, hold: 3 }] });

  it("con los mismos FPS hay exactamente un fotograma de salida por tick y respeta las duraciones", () => {
    const p = planFrames(a, 24);
    expect(p.totalFrames).toBe(6);
    expect(p.durationSec).toBeCloseTo(0.25, 6);
    expect(p.runs).toEqual([{ drawing: 0, count: 2 }, { drawing: 1, count: 1 }, { drawing: 2, count: 3 }]);
  });

  it.each([12, 24, 30, 60])("a %i FPS la secuencia coincide con una derivación independiente por tiempo", (fps) => {
    const p = planFrames(a, fps);
    const seq = p.runs.flatMap((r) => Array<number>(r.count).fill(r.drawing));
    expect(seq).toHaveLength(p.totalFrames);
    expect(seq).toEqual(Array.from({ length: p.totalFrames }, (_, k) => drawingAtTime(a, k / fps)));
    expect(Math.abs(p.durationSec - 0.25)).toBeLessThanOrEqual(0.5 / fps + 1e-9); // la duración se conserva (±½ fotograma)
  });

  it("un dibujo con duración larga es UNA sola tirada (no se renderiza de nuevo)", () => {
    const long = colorAnim({ fps: 24, width: 100, height: 100, drawings: [{ color: RED, hold: 48 }, { color: BLUE, hold: 48 }] });
    expect(planFrames(long, 24).runs).toEqual([{ drawing: 0, count: 48 }, { drawing: 1, count: 48 }]);
  });

  it("valida los FPS", () => {
    for (const bad of [0, -1, 121, 23.5]) expect(() => planFrames(a, bad)).toThrowError(ExportError);
  });
});

describe("outputSize", () => {
  const doc = { width: 1920, height: 1080 };
  it("original, con los lados pares para vídeo", () => {
    expect(outputSize(doc, { kind: "original" }, "mp4")).toEqual({ width: 1920, height: 1080 });
    expect(outputSize({ width: 1281, height: 721 }, { kind: "original" }, "mp4")).toEqual({ width: 1282, height: 722 });
    expect(outputSize({ width: 1281, height: 721 }, { kind: "original" }, "png")).toEqual({ width: 1281, height: 721 });
  });
  it("por lado corto, conservando la proporción", () => {
    expect(outputSize(doc, { kind: "short-side", px: 720 }, "mp4")).toEqual({ width: 1280, height: 720 });
    expect(outputSize(doc, { kind: "short-side", px: 480 }, "mp4")).toEqual({ width: 854, height: 480 });
    expect(outputSize({ width: 1080, height: 1920 }, { kind: "short-side", px: 720 }, "mp4")).toEqual({ width: 720, height: 1280 });
    expect(outputSize(doc, { kind: "short-side", px: 2160 }, "png")).toEqual({ width: 3840, height: 2160 });
  });
  it("rechaza tamaños fuera de rango", () => {
    for (const px of [0, 8, 7681, 100.5]) expect(() => outputSize(doc, { kind: "short-side", px }, "mp4")).toThrowError(ExportError);
  });
});

describe("nombres de archivo", () => {
  it("quita rutas y caracteres peligrosos y fuerza la extensión", () => {
    expect(sanitizeFileName("Ep 1 — Humo y neón", "mp4")).toBe("Ep 1 _ Humo y neón.mp4");
    expect(sanitizeFileName("../../etc/passwd", "mp4")).toBe("etc_passwd.mp4");
    expect(sanitizeFileName("..\\..\\x", "webm")).toBe("x.webm");
    expect(sanitizeFileName("prueba.mp4", "mp4")).toBe("prueba.mp4");
    expect(sanitizeFileName("prueba.mp4", "png-seq")).toBe("prueba.zip");
    expect(sanitizeFileName("CON", "png")).toBe("CON_.png");
    expect(sanitizeFileName("a".repeat(300), "mp4")).toHaveLength(84);
  });
  it("rechaza nombres vacíos", () => {
    for (const n of ["", "   ", "...", "///"]) expect(() => sanitizeFileName(n, "mp4")).toThrowError(ExportError);
  });
  it("nextFreeName numera sin pisar", () => {
    const taken = new Set(["a.mp4", "a (2).mp4"]);
    expect(nextFreeName("a.mp4", (n) => taken.has(n))).toBe("a (3).mp4");
    expect(nextFreeName("b.mp4", (n) => taken.has(n))).toBe("b.mp4");
  });
});

describe("mensajes de error comprensibles", () => {
  it.each([
    ["Error writing trailer: No space left on device", "disk-full", "espacio"],
    ["Permission denied", "permission", "permisos"],
    ["Unknown encoder 'libx264'", "encoder-missing", "codificador"],
    ["Cannot allocate memory", "ffmpeg-failed", "memoria"],
    ["algo raro", "ffmpeg-failed", "código"],
  ])("%s → %s", (stderr, code, word) => {
    const e = describeFfmpegFailure(stderr, 1);
    expect(e.code).toBe(code);
    expect(e.message.toLowerCase()).toContain(word);
    expect(e.message).not.toMatch(/undefined|\[object/);
  });
});
