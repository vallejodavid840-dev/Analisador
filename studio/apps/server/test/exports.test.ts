import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addEpisode, addSeason, shortId, type Animation, type ExportJobDTO, type ExportOptions, type Stroke } from "@gas/core";
import { createProjectStore } from "@gas/storage";
import { probeCapabilities } from "@gas/export";
import { buildApp } from "../src/app";

const caps = await probeCapabilities();
const hasVideo = caps.available && caps.ffprobe && caps.h264 && caps.vp9;
const video = hasVideo ? it : it.skip;

let dir: string;
let app: FastifyInstance;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gas-exp-api-"));
  app = await buildApp({ dataDir: dir });
});
afterEach(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

const solid = (hex: string, w: number, h: number): Stroke => ({ id: shortId(), kind: "pen", color: hex, size: Math.min(h * 2, 2000), opacity: 1, sens: 0, points: [0, h / 2, 1, w, h / 2, 1] });

/** Crea proyecto + episodio y GUARDA en disco una animación real de `colors.length` fotogramas. */
async function seed(colors: string[], o: { fps?: number; w?: number; h?: number; hold?: number; extraStrokes?: number } = {}) {
  const store = createProjectStore(dir);
  let p = await store.create({ name: "Serie", settings: { fps: o.fps ?? 24, width: o.w ?? 320, height: o.h ?? 180 } });
  p = addSeason(p);
  p = addEpisode(p, p.seasons[0]!.id, "Ep");
  p = await store.save(p);
  const eid = p.seasons[0]!.episodes[0]!.id;
  const base = await store.loadAnimation(p.id, eid);
  const layer = base.layers[1]!.id;
  const w = o.w ?? 320;
  const h = o.h ?? 180;
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const anim: Animation = {
    ...base,
    frames: colors.map((c, i) => ({
      id: `f${i}`, hold: o.hold ?? 1,
      cells: { [layer]: [solid(c, w, h), ...Array.from({ length: o.extraStrokes ?? 0 }, (): Stroke => {
        const pts: number[] = [];
        let x = rnd() * w, y = rnd() * h;
        for (let k = 0; k < 40; k++) { x += (rnd() - 0.5) * 60; y += (rnd() - 0.5) * 60; pts.push(Math.round(x), Math.round(y), 0.8); }
        return { id: shortId(), kind: "pen", color: "#101018", size: 4, opacity: rnd() < 0.3 ? 0.6 : 1, sens: 0.4, points: pts };
      })] },
    })),
  };
  await store.saveAnimation(p.id, anim);
  return { pid: p.id, eid, url: `/api/projects/${p.id}/episodes/${eid}/exports` };
}

const opts = (o: Partial<ExportOptions> = {}): ExportOptions => ({ format: "mp4", fileName: "mi-video", resolution: { kind: "original" }, fps: 24, quality: "low", background: { transparent: false, color: "#ffffff" }, ...o });
const post = (url: string, payload: unknown) => app.inject({ method: "POST", url, payload: payload as object });
const job = async (id: string) => (await app.inject({ url: `/api/exports/${id}` })).json() as ExportJobDTO;

async function waitFor(id: string, states: string[] = ["done", "error", "cancelled"], ms = 120_000): Promise<ExportJobDTO> {
  const t0 = Date.now();
  for (;;) {
    const j = await job(id);
    if (states.includes(j.state)) return j;
    if (Date.now() - t0 > ms) throw new Error(`tiempo agotado esperando ${states}; estado ${j.state}/${j.phase}`);
    await new Promise((r) => setTimeout(r, 40));
  }
}

const probe = (file: string) => new Promise<string>((res, rej) => execFile("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,nb_read_frames", "-of", "csv=p=0", file], (e, out) => (e ? rej(e) : res(String(out).trim()))));

describe("capacidades", () => {
  it("informa de qué formatos se pueden exportar", async () => {
    const c = (await app.inject({ url: "/api/export/capabilities" })).json();
    expect(c.formats["png"]).toEqual({ available: true, reason: null });
    expect(c.formats["png-seq"].available).toBe(true);
    expect(c.formats["mp4"].available).toBe(hasVideo);
  });

  it("sin FFmpeg: lo dice con instrucciones, rechaza vídeo con 503, pero PNG sigue funcionando", async () => {
    await app.close();
    app = await buildApp({ dataDir: dir, ffmpeg: { ffmpeg: "/no/existe/ffmpeg", ffprobe: "/no/existe/ffprobe" } });
    const c = (await app.inject({ url: "/api/export/capabilities" })).json();
    expect(c.ffmpeg.available).toBe(false);
    expect(c.formats["mp4"]).toMatchObject({ available: false, reason: expect.stringContaining("FFmpeg") });
    const s = await seed(["#ff0000"]);
    const mp4 = await post(s.url, opts());
    expect(mp4.statusCode).toBe(503);
    expect(mp4.json().message).toMatch(/apt install|brew|winget/);
    const png = await post(s.url, opts({ format: "png", fileName: "uno" }));
    expect(png.statusCode).toBe(202);
    expect((await waitFor(png.json().id)).state).toBe("done");
  });
});

describe("ciclo completo de una exportación", () => {
  video("MP4: se genera desde el DISCO (sin editor), es válido, se lista y se descarga", async () => {
    const s = await seed(["#ff0000", "#00aa00", "#0000ff"], { hold: 2 });
    const res = await post(s.url, opts({ fileName: "Capítulo 1" }));
    expect(res.statusCode).toBe(202);
    const j0 = res.json() as ExportJobDTO;
    expect(j0.fileName).toBe("Capítulo 1.mp4");
    const j = await waitFor(j0.id);
    expect(j.state).toBe("done");
    expect(j.result).toMatchObject({ fileName: "Capítulo 1.mp4", width: 320, height: 180, fps: 24, frames: 6, drawings: 3 });
    expect(j.done).toBe(6);
    expect(j.total).toBe(6);

    const list = (await app.inject({ url: `/api/projects/${s.pid}/exports?episode=${s.eid}` })).json();
    expect(list.files.map((f: { name: string }) => f.name)).toEqual(["Capítulo 1.mp4"]);
    expect(list.jobs[0].id).toBe(j0.id);

    const name = encodeURIComponent("Capítulo 1.mp4");
    const dl = await app.inject({ url: `/api/projects/${s.pid}/exports/files/${name}` });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers["content-type"]).toBe("video/mp4");
    expect(String(dl.headers["content-disposition"])).toContain("attachment");
    expect(Number(dl.headers["content-length"])).toBe(j.result!.bytes);
    expect(dl.rawPayload.length).toBe(j.result!.bytes);
    const file = join(dir, "descargado.mp4");
    await writeFile(file, dl.rawPayload);
    expect(await probe(file)).toBe("h264,320,180,6"); // vídeo real y completo
    // Sin temporales
    expect((await readdir(join(dir, `${s.pid}.gangstudio`, "exports"))).filter((f) => f.startsWith("."))).toEqual([]);
  }, 60_000);

  video("descarga con Range (necesaria para reproducir y reanudar) y vista en línea", async () => {
    const s = await seed(["#ff0000", "#0000ff"]);
    const j = await waitFor((await post(s.url, opts({ fileName: "r" }))).json().id);
    const url = `/api/projects/${s.pid}/exports/files/r.mp4`;
    const part = await app.inject({ url, headers: { range: "bytes=0-99" } });
    expect(part.statusCode).toBe(206);
    expect(part.headers["content-range"]).toBe(`bytes 0-99/${j.result!.bytes}`);
    expect(part.rawPayload.length).toBe(100);
    const tail = await app.inject({ url, headers: { range: "bytes=-50" } });
    expect(tail.statusCode).toBe(206);
    expect(tail.rawPayload.length).toBe(50);
    expect((await app.inject({ url, headers: { range: `bytes=${j.result!.bytes + 10}-` } })).statusCode).toBe(416);
    const inline = await app.inject({ url: `${url}?inline=1` });
    expect(inline.headers["content-disposition"]).toBeUndefined();
  }, 60_000);

  it("PNG individual y secuencia ZIP", async () => {
    const s = await seed(["#ff0000", "#0000ff"], { hold: 2 });
    const one = await waitFor((await post(s.url, opts({ format: "png", fileName: "f", frameIndex: 1 }))).json().id);
    expect(one).toMatchObject({ state: "done", result: { width: 320, height: 180, frames: 1 } });
    const seq = await waitFor((await post(s.url, opts({ format: "png-seq", fileName: "seq", background: { transparent: true, color: "#ffffff" } }))).json().id);
    expect(seq.result).toMatchObject({ frames: 4, fileName: "seq.zip" });
    const dl = await app.inject({ url: `/api/projects/${s.pid}/exports/files/seq.zip` });
    expect(dl.headers["content-type"]).toBe("application/zip");
    expect(dl.rawPayload.readUInt32LE(0)).toBe(0x04034b50);
  }, 60_000);

  video("el progreso es real y el servidor sigue respondiendo mientras exporta", async () => {
    const s = await seed(Array.from({ length: 60 }, (_, i) => `#${((i * 4000003) % 0xffffff).toString(16).padStart(6, "0")}`), { w: 1280, h: 720, extraStrokes: 120 });
    const j0 = (await post(s.url, opts({ fps: 24, quality: "medium" }))).json() as ExportJobDTO;
    const seen: Array<{ phase: string; done: number; total: number }> = [];
    const latencies: number[] = [];
    for (;;) {
      const t = Date.now();
      await app.inject({ url: "/api/health" });
      latencies.push(Date.now() - t);
      const j = await job(j0.id);
      seen.push({ phase: j.phase, done: j.done, total: j.total });
      if (j.state !== "running" && j.state !== "queued") {
        expect(j.state).toBe("done");
        break;
      }
      await new Promise((r) => setTimeout(r, 30));
    }
    const dones = seen.filter((x) => x.phase === "rendering").map((x) => x.done);
    expect(dones.length).toBeGreaterThan(2); // se observó progreso intermedio
    expect(new Set(dones).size).toBeGreaterThan(2);
    expect([...dones].sort((a, b) => a - b)).toEqual(dones); // nunca retrocede
    expect(Math.max(...seen.map((x) => x.total))).toBe(60);
    // La API no se bloquea mientras otro proceso renderiza
    expect(Math.max(...latencies)).toBeLessThan(250);
  }, 120_000);
});

describe("seguridad de archivos y nombres", () => {
  it("no sobrescribe sin autorización; propone otro nombre; con autoRename numera; con overwrite sustituye", async () => {
    const s = await seed(["#ff0000"]);
    const a = await waitFor((await post(s.url, opts({ format: "png", fileName: "x" }))).json().id);
    const first = (await app.inject({ url: `/api/projects/${s.pid}/exports/files/x.png` })).rawPayload;
    expect(a.state).toBe("done");

    const clash = await post(s.url, opts({ format: "png", fileName: "x", background: { transparent: true, color: "#ffffff" } }));
    expect(clash.statusCode).toBe(409);
    expect(clash.json()).toMatchObject({ error: "file-exists", suggestion: "x (2).png" });
    expect((await app.inject({ url: `/api/projects/${s.pid}/exports/files/x.png` })).rawPayload.equals(first)).toBe(true); // intacto

    const auto = await post(s.url, opts({ format: "png", fileName: "x", autoRename: true }));
    expect(auto.statusCode).toBe(202);
    expect(auto.json().fileName).toBe("x (2).png");
    await waitFor(auto.json().id);

    const over = await post(s.url, opts({ format: "png", fileName: "x", overwrite: true, resolution: { kind: "short-side", px: 90 } })); // contenido distinto
    expect(over.statusCode).toBe(202);
    expect((await waitFor(over.json().id)).state).toBe("done");
    expect((await app.inject({ url: `/api/projects/${s.pid}/exports/files/x.png` })).rawPayload.equals(first)).toBe(false); // sustituido
  }, 60_000);

  it("dos exportaciones simultáneas con el mismo nombre no se pisan", async () => {
    const s = await seed(["#ff0000"]);
    const [r1, r2] = await Promise.all([post(s.url, opts({ format: "png", fileName: "dup" })), post(s.url, opts({ format: "png", fileName: "dup" }))]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([202, 409]);
  });

  it("nombres peligrosos se sanean y la descarga rechaza rutas", async () => {
    const s = await seed(["#ff0000"]);
    const j = (await post(s.url, opts({ format: "png", fileName: "../../etc/passwd" }))).json();
    expect(j.fileName).toBe("etc_passwd.png");
    await waitFor(j.id);
    expect((await readdir(dir)).filter((n) => !n.endsWith(".gangstudio"))).toEqual([]); // nada fuera del proyecto
    for (const bad of ["..%2F..%2Fproject.json", "%2Fetc%2Fpasswd", ".tmp-x", "project.json", "x.exe"]) {
      const r = await app.inject({ url: `/api/projects/${s.pid}/exports/files/${bad}` });
      expect([400, 404]).toContain(r.statusCode);
    }
  });
});

describe("errores", () => {
  it("opciones inválidas → 400 con mensaje; episodio o proyecto inexistente → 404", async () => {
    const s = await seed(["#ff0000"]);
    expect((await post(s.url, { ...opts(), format: "avi" })).statusCode).toBe(400);
    expect((await post(s.url, { ...opts(), fps: 500 })).statusCode).toBe(400);
    expect((await post(s.url, { ...opts(), fileName: "" })).statusCode).toBe(400);
    expect((await post(s.url, { ...opts(), resolution: { kind: "short-side", px: 3 } })).statusCode).toBe(400);
    const t = await post(s.url, opts({ background: { transparent: true, color: "#ffffff" } }));
    expect(t.statusCode).toBe(400);
    expect(t.json().message).toContain("no admite fondo transparente");
    expect((await post(s.url, opts({ format: "png", fileName: "z", frameIndex: 9 }))).statusCode).toBe(400);
    expect((await post(`/api/projects/${s.pid}/episodes/nada/exports`, opts())).statusCode).toBe(404);
    expect((await post(`/api/projects/nada/episodes/e/exports`, opts())).statusCode).toBe(404);
    expect((await app.inject({ url: "/api/exports/inexistente" })).statusCode).toBe(404);
  });

  it("un dibujo dañado en disco se informa (422) y no se exporta nada", async () => {
    const s = await seed(["#ff0000"]);
    await writeFile(join(dir, `${s.pid}.gangstudio`, "episodes", `${s.eid}.json`), "{rota");
    const r = await post(s.url, opts({ format: "png", fileName: "n" }));
    expect(r.statusCode).toBe(422);
    expect(r.json().message).toContain("dañado");
  });

  it("al arrancar limpia los temporales de exportaciones interrumpidas", async () => {
    const s = await seed(["#ff0000"]);
    const ex = join(dir, `${s.pid}.gangstudio`, "exports");
    await mkdir(join(ex, ".tmp-abandonado"), { recursive: true });
    await writeFile(join(ex, ".tmp-abandonado", "salida.mp4"), "medio vídeo");
    await writeFile(join(ex, "bueno.png"), "x");
    await app.close();
    app = await buildApp({ dataDir: dir });
    expect(await readdir(ex)).toEqual(["bueno.png"]);
  });
});

describe("cancelación", () => {
  video("cancelar una exportación en curso: se detiene, mata FFmpeg y no deja nada", async () => {
    const s = await seed(Array.from({ length: 150 }, (_, i) => `#${((i * 7000003) % 0xffffff).toString(16).padStart(6, "0")}`), { w: 1920, h: 1080, extraStrokes: 150 });
    const j0 = (await post(s.url, opts({ fps: 30, quality: "high", fileName: "grande" }))).json() as ExportJobDTO;
    const running = await (async () => {
      for (;;) {
        const j = await job(j0.id);
        if (j.state === "running" && j.phase === "rendering" && j.done >= 5) return j;
        if (j.state === "error" || j.state === "done") throw new Error("terminó antes de poder cancelar: " + JSON.stringify(j));
        await new Promise((r) => setTimeout(r, 30));
      }
    })();
    expect(running.done).toBeGreaterThanOrEqual(5);
    const t = Date.now();
    const c = await app.inject({ method: "POST", url: `/api/exports/${j0.id}/cancel` });
    expect(c.statusCode).toBe(200);
    const final = await waitFor(j0.id, ["cancelled", "done", "error"], 15_000);
    expect(final.state).toBe("cancelled");
    expect(final.error?.message).toContain("cancelada");
    expect(Date.now() - t).toBeLessThan(6000);
    const ex = join(dir, `${s.pid}.gangstudio`, "exports");
    await new Promise((r) => setTimeout(r, 300));
    expect(await readdir(ex)).toEqual([]); // ni vídeo a medias ni temporales
    // FFmpeg recibe la ruta temporal dentro de la carpeta de exportaciones de ESTE proyecto: si queda algún proceso, aparece aquí
    const alive = await new Promise<string>((res) => execFile("pgrep", ["-f", ex], (e, out) => res(e ? "" : String(out).trim())));
    expect(alive).toBe(""); // no queda FFmpeg trabajando
  }, 120_000);

  video("una exportación en cola se cancela al instante y la siguiente continúa", async () => {
    const s = await seed(Array.from({ length: 80 }, (_, i) => `#${((i * 5000011) % 0xffffff).toString(16).padStart(6, "0")}`), { w: 1280, h: 720, extraStrokes: 100 });
    const a = (await post(s.url, opts({ fileName: "primero", quality: "high" }))).json() as ExportJobDTO;
    const b = (await post(s.url, opts({ fileName: "segundo" }))).json() as ExportJobDTO;
    const c = (await post(s.url, opts({ format: "png", fileName: "tercero" }))).json() as ExportJobDTO;
    expect((await job(b.id)).state).toBe("queued");
    const cancelled = (await app.inject({ method: "POST", url: `/api/exports/${b.id}/cancel` })).json();
    expect(cancelled.state).toBe("cancelled");
    await app.inject({ method: "POST", url: `/api/exports/${a.id}/cancel` });
    expect((await waitFor(a.id)).state).toBe("cancelled");
    expect((await waitFor(c.id)).state).toBe("done"); // la cola sigue funcionando
    expect(await readdir(join(dir, `${s.pid}.gangstudio`, "exports"))).toEqual(["tercero.png"]);
  }, 120_000);
});
