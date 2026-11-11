import { chmod, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { shortId, type Animation, type Stroke } from "@gas/core";
import { ExportError, ffmpegPaths, probeCapabilities, runExport, type ExportRequest, type Progress } from "../src";
import { BLUE, GREEN, RED, colorAnim, decodeCorner, drawingAtTime, near, readStoredZip, solid, tmpDir, type RGB } from "./helpers";

let dir = "";
let cleanup: () => Promise<void>;
beforeAll(async () => ({ dir, cleanup } = await tmpDir()));
afterAll(() => cleanup());

/** La exportación DEBE fallar; devuelve el error (si terminara bien, el test falla). */
const failure = async (p: Promise<unknown>): Promise<ExportError> => {
  try {
    await p;
  } catch (e) {
    return e as ExportError;
  }
  throw new Error("la exportación debía fallar y terminó bien");
};

const caps = await probeCapabilities();
const hasVideo = caps.available && caps.ffprobe && caps.h264 && caps.vp9;
const video = hasVideo ? describe : describe.skip;

let n = 0;
const req = (anim: Animation, o: Partial<ExportRequest> = {}): ExportRequest => ({
  animation: anim, format: "mp4", resolution: { kind: "original" }, quality: "high", background: { transparent: false, color: "#ffffff" },
  outputDir: dir, fileName: `salida-${++n}.mp4`, overwrite: false, ...o,
});
const COLORS: RGB[] = [RED, GREEN, BLUE];
const expectedColors = (anim: Animation, fps: number, frames: number) => Array.from({ length: frames }, (_, k) => anim.frames[drawingAtTime(anim, k / fps)]!.id);

video("MP4 (H.264): el vídeo coincide con la animación", () => {
  const anim = colorAnim({ fps: 24, width: 320, height: 180, drawings: [{ color: RED, hold: 2 }, { color: GREEN }, { color: BLUE, hold: 3 }] });

  it("fotograma a fotograma: orden, duraciones, FPS, tamaño y códec", async () => {
    const r = await runExport(req(anim));
    expect(r).toMatchObject({ format: "mp4", width: 320, height: 180, fps: 24, frames: 6, drawings: 3 });
    const px = await decodeCorner(r.file);
    expect(px).toHaveLength(6); // exactamente 6 fotogramas
    const want = [RED, RED, GREEN, BLUE, BLUE, BLUE]; // 2 + 1 + 3 ticks
    px.forEach((p, i) => expect(near(p, want[i]!), `fotograma ${i}: ${p}`).toBe(true));
    expect(r.bytes).toBeGreaterThan(500);
  });

  for (const fps of [12, 24, 30]) {
    it(`a ${fps} FPS: nº de fotogramas, duración y contenido de cada uno son los correctos`, async () => {
      const r = await runExport(req(anim, { fps }));
      const px = await decodeCorner(r.file);
      expect(r.fps).toBe(fps);
      expect(px).toHaveLength(r.frames);
      const ids = expectedColors(anim, fps, r.frames);
      px.forEach((p, i) => {
        const idx = anim.frames.findIndex((f) => f.id === ids[i]);
        expect(near(p, COLORS[idx]!), `f${i} a ${fps} FPS`).toBe(true);
      });
      expect(Math.abs(r.durationSec - 0.25)).toBeLessThanOrEqual(0.5 / fps + 1e-9);
    });
  }

  it("una animación larga con duraciones largas mantiene la sincronía (cada dibujo dura lo que debe)", async () => {
    const a = colorAnim({ fps: 12, width: 160, height: 90, drawings: [{ color: RED, hold: 24 }, { color: GREEN, hold: 12 }, { color: BLUE, hold: 36 }] }); // 2 s + 1 s + 3 s
    const r = await runExport(req(a, { quality: "low" }));
    expect(r.frames).toBe(72);
    expect(r.durationSec).toBeCloseTo(6, 6);
    const px = await decodeCorner(r.file);
    const counts = [0, 0, 0];
    px.forEach((p) => counts[COLORS.findIndex((c) => near(p, c, 30))]!++);
    expect(counts).toEqual([24, 12, 36]);
    // y en orden: ningún color reaparece tras haber terminado
    const seq = px.map((p) => COLORS.findIndex((c) => near(p, c, 30)));
    expect(seq).toEqual([...Array(24).fill(0), ...Array(12).fill(1), ...Array(36).fill(2)]);
  });

  it("respeta las capas: una capa oculta no aparece y el orden de composición se conserva", async () => {
    const a = colorAnim({ fps: 12, width: 160, height: 90, drawings: [{ color: RED }] });
    const bottom = a.layers[0]!.id;
    const top = a.layers[1]!.id;
    const withBlueBelow: Animation = { ...a, frames: [{ ...a.frames[0]!, cells: { [bottom]: [solid(BLUE, 160, 90)], [top]: [solid(RED, 160, 90)] } }] };
    expect(near((await decodeCorner((await runExport(req(withBlueBelow))).file))[0]!, RED)).toBe(true); // arriba manda el rojo
    const hiddenTop: Animation = { ...withBlueBelow, layers: withBlueBelow.layers.map((l) => (l.id === top ? { ...l, visible: false } : l)) };
    expect(near((await decodeCorner((await runExport(req(hiddenTop))).file))[0]!, BLUE)).toBe(true); // oculta la de arriba: se ve la de abajo
    const swapped: Animation = { ...withBlueBelow, layers: [withBlueBelow.layers[1]!, withBlueBelow.layers[0]!] };
    expect(near((await decodeCorner((await runExport(req(swapped))).file))[0]!, BLUE)).toBe(true); // orden invertido
  });

  it("respeta la opacidad de los trazos", async () => {
    const a = colorAnim({ fps: 12, width: 160, height: 90, drawings: [{ color: [0, 0, 0] }] });
    const layer = a.layers[1]!.id;
    const half: Animation = { ...a, frames: [{ ...a.frames[0]!, cells: { [layer]: [{ ...solid([0, 0, 0], 160, 90), opacity: 0.5 }] } }] };
    const [p] = await decodeCorner((await runExport(req(half))).file);
    expect(p![0]).toBeGreaterThan(112);
    expect(p![0]).toBeLessThan(150); // gris medio sobre el fondo blanco
  });

  it("los colores de H.264 (BT.709) salen sin desvíos apreciables", async () => {
    const a = colorAnim({ fps: 12, width: 160, height: 90, drawings: [{ color: [232, 50, 60] }, { color: [29, 26, 38] }, { color: [255, 194, 51] }] });
    const px = await decodeCorner((await runExport(req(a))).file);
    [[232, 50, 60], [29, 26, 38], [255, 194, 51]].forEach((c, i) => expect(near(px[i]!, c as unknown as RGB, 10), `${px[i]} vs ${c}`).toBe(true));
  });
});

video("resoluciones", () => {
  const anim = colorAnim({ fps: 12, width: 320, height: 180, drawings: [{ color: RED }, { color: BLUE }] });
  it.each([
    [{ kind: "original" as const }, 320, 180],
    [{ kind: "short-side" as const, px: 720 }, 1280, 720],
    [{ kind: "short-side" as const, px: 1080 }, 1920, 1080],
    [{ kind: "short-side" as const, px: 480 }, 854, 480],
    [{ kind: "short-side" as const, px: 90 }, 160, 90],
  ])("%j → %i×%i", async (resolution, w, h) => {
    const r = await runExport(req(anim, { resolution, quality: "low" }));
    expect([r.width, r.height]).toEqual([w, h]);
    const info = JSON.parse((await run(ffmpegPaths().ffprobe, ["-v", "error", "-show_entries", "stream=width,height", "-of", "json", r.file]))).streams[0];
    expect([info.width, info.height]).toEqual([w, h]);
  });

  it("un proyecto vertical y uno con medidas impares también salen válidos (lados pares)", async () => {
    const vertical = colorAnim({ fps: 12, width: 180, height: 320, drawings: [{ color: GREEN }] });
    expect(await runExport(req(vertical, { resolution: { kind: "short-side", px: 720 } }))).toMatchObject({ width: 720, height: 1280 });
    const odd = colorAnim({ fps: 12, width: 321, height: 181, drawings: [{ color: GREEN }] });
    expect(await runExport(req(odd))).toMatchObject({ width: 322, height: 182 });
  });

  it("la calidad cambia el tamaño del archivo (más calidad = más datos)", async () => {
    const noisy = noisyAnim();
    const sizes: number[] = [];
    for (const quality of ["low", "medium", "high", "max"] as const) sizes.push((await runExport(req(noisy, { quality }))).bytes);
    expect(sizes[0]!).toBeLessThan(sizes[1]!);
    expect(sizes[1]!).toBeLessThan(sizes[2]!);
    expect(sizes[2]!).toBeLessThan(sizes[3]!);
  });
});

function noisyAnim(): Animation {
  const base = colorAnim({ fps: 12, width: 480, height: 270, drawings: [{ color: [255, 255, 255] }, { color: [255, 255, 255] }] });
  const layer = base.layers[1]!.id;
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const strokes = (k: number): Stroke[] => Array.from({ length: 150 }, () => {
    const pts: number[] = [];
    let x = rnd() * 480, y = rnd() * 270;
    for (let j = 0; j < 20; j++) { x += (rnd() - 0.5 + k * 0.01) * 40; y += (rnd() - 0.5) * 40; pts.push(Math.round(x), Math.round(y), 1); }
    return { id: shortId(), kind: "pen", color: `#${Math.floor(rnd() * 0xffffff).toString(16).padStart(6, "0")}`, size: 3, opacity: 1, sens: 0, points: pts };
  });
  return { ...base, frames: base.frames.map((f, i) => ({ ...f, cells: { [layer]: strokes(i) } })) };
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    import("node:child_process").then(({ execFile }) => execFile(cmd, args, (e, out) => (e ? reject(e) : resolve(String(out)))));
  });
}

video("WebM (VP9) y transparencia", () => {
  /** Un cuadrado rojo en el centro; el resto sin dibujar. */
  const squareAnim = () => {
    const a = colorAnim({ fps: 12, width: 160, height: 90, drawings: [{ color: RED }] });
    const layer = a.layers[1]!.id;
    return { ...a, frames: [{ ...a.frames[0]!, cells: { [layer]: [{ ...solid(RED, 160, 90), size: 30, points: [80, 45, 1, 80, 45.1, 1] }] } }] } as Animation;
  };

  it("WebM con fondo transparente conserva el canal alfa (VP9 yuva420p)", async () => {
    const r = await runExport(req(squareAnim(), { format: "webm", fileName: "alfa.webm", background: { transparent: true, color: "#ffffff" }, quality: "high" }));
    const info = JSON.parse(await run(ffmpegPaths().ffprobe, ["-v", "error", "-show_entries", "stream=codec_name:stream_tags=alpha_mode", "-of", "json", r.file])).streams[0];
    expect(info.codec_name).toBe("vp9");
    expect(info.tags.alpha_mode).toBe("1");
    const frame = await decodeFull(r.file, 160, 90, true);
    expect(frame.alphaAt(2, 2)).toBeLessThan(10); // esquina transparente
    expect(frame.alphaAt(80, 45)).toBeGreaterThan(245); // el cuadrado es opaco
    expect(near(frame.rgbAt(80, 45), RED, 20)).toBe(true);
  });

  it("WebM con fondo de color es opaco", async () => {
    const r = await runExport(req(squareAnim(), { format: "webm", fileName: "opaco.webm", background: { transparent: false, color: "#00aa00" } }));
    const frame = await decodeFull(r.file, 160, 90, false);
    expect(near(frame.rgbAt(2, 2), [0, 170, 0], 16)).toBe(true);
    expect(near(frame.rgbAt(80, 45), RED, 20)).toBe(true);
  });

  it("MP4 NO admite transparencia: error claro, sin crear nada", async () => {
    await expect(runExport(req(squareAnim(), { background: { transparent: true, color: "#ffffff" } }))).rejects.toMatchObject({ code: "invalid-options", message: expect.stringContaining("no admite fondo transparente") });
  });
});

async function decodeFull(file: string, w: number, h: number, alpha: boolean) {
  const buf: Buffer = await new Promise((resolve, reject) => {
    import("node:child_process").then(({ spawn }) => {
      const p = spawn(ffmpegPaths().ffmpeg, [...(alpha ? ["-c:v", "libvpx-vp9"] : []), "-v", "error", "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"]);
      const chunks: Buffer[] = [];
      p.stdout.on("data", (d: Buffer) => chunks.push(d));
      p.on("close", (c) => (c === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error("ffmpeg " + c))));
    });
  });
  const at = (x: number, y: number) => (y * w + x) * 4;
  return { alphaAt: (x: number, y: number) => buf[at(x, y) + 3]!, rgbAt: (x: number, y: number) => [buf[at(x, y)]!, buf[at(x, y) + 1]!, buf[at(x, y) + 2]!] as RGB, size: buf.length / 4 === w * h };
}

describe("imágenes PNG", () => {
  const sq = () => {
    const a = colorAnim({ fps: 12, width: 200, height: 100, drawings: [{ color: RED }, { color: GREEN }, { color: BLUE }] });
    const layer = a.layers[1]!.id;
    const dot = (c: RGB): Stroke => ({ ...solid(c, 200, 100), size: 40, points: [100, 50, 1, 100, 50.1, 1] });
    return { ...a, frames: a.frames.map((f, i) => ({ ...f, cells: { [layer]: [dot(COLORS[i]!)] } })) } as Animation;
  };
  const px = async (file: string) => {
    const img = await loadImage(await readFile(file));
    const c = createCanvas(img.width, img.height);
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return { w: img.width, h: img.height, at: (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data) as [number, number, number, number] };
  };

  it("fotograma individual con transparencia, a la resolución original", async () => {
    const r = await runExport(req(sq(), { format: "png", fileName: "uno.png", frameIndex: 1, background: { transparent: true, color: "#ffffff" } }));
    const p = await px(r.file);
    expect([p.w, p.h]).toEqual([200, 100]);
    expect(p.at(2, 2)[3]).toBe(0); // fondo transparente
    expect(p.at(100, 50)).toEqual([0, 200, 0, 255]); // el fotograma 2 (verde)
  });

  it("fotograma individual con fondo de color y en otra resolución", async () => {
    const r = await runExport(req(sq(), { format: "png", fileName: "fondo.png", frameIndex: 2, background: { transparent: false, color: "#102030" }, resolution: { kind: "short-side", px: 400 } }));
    const p = await px(r.file);
    expect([p.w, p.h]).toEqual([800, 400]);
    expect(p.at(2, 2)).toEqual([16, 32, 48, 255]);
    expect(p.at(400, 200)).toEqual([0, 0, 255, 255]);
  });

  it("secuencia PNG completa en ZIP: una imagen por fotograma, con repeticiones por duración y en orden", async () => {
    const a = sq();
    const held: Animation = { ...a, frames: [{ ...a.frames[0]!, hold: 2 }, a.frames[1]!, { ...a.frames[2]!, hold: 3 }] };
    const r = await runExport(req(held, { format: "png-seq", fileName: "seq.zip", background: { transparent: true, color: "#ffffff" } }));
    expect(r.frames).toBe(6);
    const entries = readStoredZip(await readFile(r.file));
    expect(entries.map((e) => e.name)).toEqual(Array.from({ length: 6 }, (_, i) => `seq/seq_${String(i + 1).padStart(5, "0")}.png`));
    const want = [RED, RED, GREEN, BLUE, BLUE, BLUE];
    for (const [i, e] of entries.entries()) {
      const img = await loadImage(e.data);
      expect([img.width, img.height]).toEqual([200, 100]);
      const c = createCanvas(200, 100);
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      expect(Array.from(ctx.getImageData(100, 50, 1, 1).data).slice(0, 3)).toEqual([...want[i]!]);
      expect(ctx.getImageData(1, 1, 1, 1).data[3]).toBe(0); // transparencia en cada fotograma
    }
  });

  it("la secuencia respeta los FPS elegidos (24→12 FPS: la mitad de imágenes)", async () => {
    const a = colorAnim({ fps: 24, width: 100, height: 50, drawings: [{ color: RED, hold: 6 }, { color: BLUE, hold: 6 }] });
    const r = await runExport(req(a, { format: "png-seq", fileName: "f12.zip", fps: 12 }));
    expect(r.frames).toBe(6);
    expect(readStoredZip(await readFile(r.file))).toHaveLength(6);
  });
});

describe("seguridad de archivos", () => {
  const a = colorAnim({ fps: 12, width: 100, height: 50, drawings: [{ color: RED }] });
  const listing = async (d: string) => (await readdir(d)).sort();

  it("no sobrescribe sin autorización; con `overwrite` sí, y nunca deja temporales", async () => {
    const sub = join(dir, "sobre");
    await runExport(req(a, { format: "png", fileName: "x.png", outputDir: sub }));
    const before = await readFile(join(sub, "x.png"));
    const other = colorAnim({ fps: 12, width: 100, height: 50, drawings: [{ color: BLUE }] }); // contenido distinto
    await expect(runExport(req(other, { format: "png", fileName: "x.png", outputDir: sub }))).rejects.toMatchObject({ code: "file-exists" });
    expect((await readFile(join(sub, "x.png"))).equals(before)).toBe(true); // intacto
    await runExport(req(other, { format: "png", fileName: "x.png", outputDir: sub, overwrite: true }));
    expect((await readFile(join(sub, "x.png"))).equals(before)).toBe(false); // sustituido
    expect(await listing(sub)).toEqual(["x.png"]);
  });

  it.each(["../x.png", "a/b.png", ".oculto.png", "sin-extension", "x.mp4"])("rechaza el nombre peligroso o incoherente %s", async (fileName) => {
    await expect(runExport(req(a, { format: "png", fileName }))).rejects.toMatchObject({ code: "invalid-options" });
  });

  it("rechaza opciones inválidas (fotograma inexistente, color, calidad)", async () => {
    await expect(runExport(req(a, { format: "png", fileName: "i.png", frameIndex: 9 }))).rejects.toMatchObject({ code: "invalid-options" });
    await expect(runExport(req(a, { format: "png", fileName: "c.png", background: { transparent: false, color: "rojo" } }))).rejects.toMatchObject({ code: "invalid-options" });
    await expect(runExport(req(a, { format: "png", fileName: "q.png", quality: "ultra" as never }))).rejects.toMatchObject({ code: "invalid-options" });
  });

  it("no modifica la animación recibida", async () => {
    const snap = JSON.stringify(a);
    await runExport(req(a, { format: "png", fileName: "inm.png" }));
    expect(JSON.stringify(a)).toBe(snap);
  });
});

video("errores de FFmpeg", () => {
  const a = colorAnim({ fps: 12, width: 160, height: 90, drawings: [{ color: RED, hold: 6 }] });

  it("sin FFmpeg: mensaje claro con instrucciones, sin dejar nada", async () => {
    const sub = join(dir, "sin-ffmpeg");
    const e = await failure(runExport(req(a, { outputDir: sub }), { paths: { ffmpeg: "/no/existe/ffmpeg", ffprobe: "/no/existe/ffprobe" } }));
    expect(e).toBeInstanceOf(ExportError);
    expect(e.code).toBe("ffmpeg-missing");
    expect(e.message).toContain("FFmpeg");
    expect(e.message).toMatch(/apt install|brew|winget/);
    await expect(readdir(sub)).rejects.toThrow(); // ni siquiera se creó la carpeta
  });

  it("FFmpeg que falla a mitad: error comprensible y limpieza completa", async () => {
    const fake = join(dir, "ffmpeg-falso.sh");
    const real = ffmpegPaths().ffmpeg;
    await writeFile(fake, `#!/bin/sh\ncase "$*" in *-version*|*-encoders*) exec ${real} "$@";; esac\nhead -c 4096 >/dev/null\necho "Error writing trailer: No space left on device" >&2\nexit 1\n`);
    await chmod(fake, 0o755);
    const sub = join(dir, "falla");
    const e = await failure(runExport(req(a, { outputDir: sub, fileName: "no-saldra.mp4" }), { paths: { ffmpeg: fake, ffprobe: ffmpegPaths().ffprobe } }));
    expect(e.code).toBe("disk-full");
    expect(e.message).toContain("espacio");
    expect(await listing(sub)).toEqual([]); // sin archivo final ni temporales
  });

  it("un vídeo truncado o falso NO se da por bueno (validación)", async () => {
    const fake = join(dir, "ffmpeg-vacio.sh");
    const real = ffmpegPaths().ffmpeg;
    // «Termina bien» pero escribe un archivo que no es un vídeo
    await writeFile(fake, `#!/bin/sh\ncase "$*" in *-version*|*-encoders*) exec ${real} "$@";; esac\ncat >/dev/null\nfor last; do :; done\necho "no soy un mp4" > "$last"\nexit 0\n`);
    await chmod(fake, 0o755);
    const sub = join(dir, "falso");
    const e = await failure(runExport(req(a, { outputDir: sub, fileName: "falso.mp4" }), { paths: { ffmpeg: fake, ffprobe: ffmpegPaths().ffprobe } }));
    expect(e.code).toBe("validation-failed");
    expect(e.message).toContain("no es válido");
    expect(await listing(sub)).toEqual([]); // no se publica
  });

  async function listing(d: string) {
    return (await readdir(d)).sort();
  }
});

video("progreso y cancelación", () => {
  it("el progreso es real: crece de 0 a total, en orden y pasa por las fases", async () => {
    const a = colorAnim({ fps: 24, width: 320, height: 180, drawings: Array.from({ length: 12 }, (_, i) => ({ color: COLORS[i % 3]!, hold: 2 })) });
    const events: Progress[] = [];
    const r = await runExport(req(a, { quality: "low" }), { onProgress: (p) => events.push({ ...p }) });
    const dones = events.filter((e) => e.phase === "rendering").map((e) => e.done);
    expect(dones[0]).toBeGreaterThanOrEqual(0);
    expect(dones.at(-1)).toBe(24);
    expect([...dones].sort((x, y) => x - y)).toEqual(dones); // monótono
    expect(events.map((e) => e.phase)).toEqual(expect.arrayContaining(["preparing", "rendering", "finalizing", "validating", "done"]));
    expect(events.at(-1)).toMatchObject({ phase: "done", done: 24, total: 24 });
    expect(r.frames).toBe(24);
  });

  it("cancelar a mitad: se detiene rápido, mata FFmpeg y no deja archivos", async () => {
    const heavy = heavyAnim(300, 1280, 720, 12);
    const sub = join(dir, "cancel");
    const ac = new AbortController();
    let pid = 0;
    const started = Date.now();
    let cancelAt = 0;
    const p = runExport(req(heavy, { outputDir: sub, fileName: "grande.mp4", fps: 30 }), {
      signal: ac.signal,
      onSpawn: (x) => (pid = x),
      onProgress: (pr) => {
        if (pr.phase === "rendering" && pr.done >= 20 && !ac.signal.aborted) {
          cancelAt = Date.now();
          ac.abort();
        }
      },
    });
    const e = await failure(p);
    expect(e.code).toBe("cancelled");
    expect(e.message).toContain("cancelada");
    expect(Date.now() - cancelAt).toBeLessThan(3000); // responde rápido
    expect(cancelAt - started).toBeLessThan(60_000);
    expect(pid).toBeGreaterThan(0);
    await expect(waitDead(pid)).resolves.toBe(true); // el proceso de FFmpeg ya no existe
    expect(await readdir(sub)).toEqual([]); // ni final ni .tmp
  }, 90_000);

  it("cancelar antes de empezar no hace nada", async () => {
    const ac = new AbortController();
    ac.abort();
    const sub = join(dir, "cancel0");
    await expect(runExport(req(colorAnim({ fps: 12, width: 100, height: 50, drawings: [{ color: RED }] }), { outputDir: sub }), { signal: ac.signal })).rejects.toMatchObject({ code: "cancelled" });
    expect(await readdir(sub).catch(() => [])).toEqual([]);
  });
});

async function waitDead(pid: number): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

function heavyAnim(drawings: number, w: number, h: number, strokesPer: number): Animation {
  const base = colorAnim({ fps: 24, width: w, height: h, drawings: Array.from({ length: drawings }, (_, i) => ({ color: [i % 255, (i * 7) % 255, (i * 13) % 255] as RGB })) });
  const layer = base.layers[1]!.id;
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return {
    ...base,
    frames: base.frames.map((f) => ({
      ...f,
      cells: {
        ...f.cells,
        [layer]: [
          ...f.cells[layer]!,
          ...Array.from({ length: strokesPer }, (): Stroke => {
            const pts: number[] = [];
            let x = rnd() * w, y = rnd() * h;
            for (let k = 0; k < 40; k++) { x += (rnd() - 0.5) * 60; y += (rnd() - 0.5) * 60; pts.push(Math.round(x), Math.round(y), 0.8); }
            return { id: shortId(), kind: "pen", color: "#101018", size: 3 + rnd() * 6, opacity: rnd() < 0.15 ? 0.6 : 1, sens: 0.5, points: pts };
          }),
        ],
      },
    })),
  };
}

video("proyectos grandes", () => {
  it("200 dibujos de 1920×1080 con ~200 trazos cada uno: válido y con memoria acotada", async () => {
    const big = heavyAnim(200, 1920, 1080, 200);
    const sub = join(dir, "grande");
    let peak = 0;
    const t0 = Date.now();
    const r = await runExport(req(big, { outputDir: sub, fileName: "grande.mp4", fps: 24, quality: "low" }), {
      onProgress: () => (peak = Math.max(peak, process.memoryUsage().rss)),
    });
    const secs = (Date.now() - t0) / 1000;
    expect(r).toMatchObject({ frames: 200, width: 1920, height: 1080, drawings: 200 });
    expect((await stat(r.file)).size).toBeGreaterThan(10_000);
    // Memoria: no crece con el nº de fotogramas (se procesa de uno en uno). Margen amplio sobre lo medido.
    expect(peak / 2 ** 20).toBeLessThan(1500);
    // Cifras para el informe (opcional): GAS_PERF_DIR=<carpeta> npx vitest run packages/export
    if (process.env["GAS_PERF_DIR"]) await writeFile(join(process.env["GAS_PERF_DIR"], "export-grande.json"), JSON.stringify({ frames: r.frames, size: `${r.width}x${r.height}`, seconds: Math.round(secs * 10) / 10, framesPerSecond: Math.round((r.frames / secs) * 10) / 10, peakRssMB: Math.round(peak / 2 ** 20), bytes: r.bytes }, null, 2));
  }, 280_000);

  it("una animación de ~3 minutos (muchas repeticiones) a 30 FPS cuesta lo mismo que sus dibujos, no sus fotogramas", async () => {
    const long = colorAnim({ fps: 24, width: 640, height: 360, drawings: Array.from({ length: 30 }, (_, i) => ({ color: COLORS[i % 3]!, hold: 48 })) }); // 30 × 2 s = 60 s
    const r = await runExport(req(long, { fps: 30, quality: "low", outputDir: join(dir, "larga") }));
    expect(r.frames).toBe(1800);
    expect(r.drawings).toBe(30); // solo 30 renders para 1800 fotogramas
    expect(r.durationSec).toBeCloseTo(60, 6);
  }, 120_000);
});
