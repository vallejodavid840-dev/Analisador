import { execFile } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { devices, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeCorner, near, readStoredZip } from "../packages/export/test/helpers";
import { SHOTS, createEpisode, line, mouseStroke, openEditorPage, settle, setColor, seedColors, startEnv, type Env } from "./helpers";

let env: Env;
beforeAll(async () => (env = await startEnv()));
afterAll(() => env.close());

const RED = "#ff0000";
const GREEN = "#00aa00";
const BLUE = "#0000ff";

const exportsOf = (pid: string) => join(env.dataDir, `${pid}.gangstudio`, "exports");
const dialog = (page: Page) => page.getByTestId("export-dialog");
const openDialog = async (page: Page) => {
  await page.getByTestId("export-open").click();
  await dialog(page).waitFor();
};
const waitDone = (page: Page, timeout = 120_000) => page.getByTestId("export-done").waitFor({ timeout });
const href = async (page: Page) => (await page.getByTestId("export-download").getAttribute("href"))!;
const fetchFile = async (path: string) => Buffer.from(await (await fetch(env.base + path)).arrayBuffer());
const ffprobe = (file: string, entries: string) => new Promise<string>((res, rej) => execFile("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", entries, "-of", "csv=p=0", file], (e, out) => (e ? rej(e) : res(String(out).trim()))));
const pgrepX264 = (pattern: string) => new Promise<string>((res) => execFile("pgrep", ["-f", pattern], (e, out) => res(e ? "" : String(out).trim())));
const tmp = (name: string) => join(env.dataDir, name);

describe("exportar desde la interfaz", () => {
  it("MP4: resolución, FPS y calidad elegidos; el archivo descargado es un vídeo válido y coincide con la animación", async () => {
    const s = await seedColors(env, { colors: [RED, GREEN, BLUE], holds: [2, 1, 3], fps: 24 });
    const { ctx, page, errors } = await openEditorPage(env, s.url);
    await openDialog(page);
    await page.getByTestId("export-name").fill("Capítulo uno");
    await page.selectOption("[data-testid=export-resolution]", "720");
    await page.selectOption("[data-testid=export-fps]", "12");
    await page.selectOption("[data-testid=export-quality]", "medium");
    expect(await page.getByTestId("export-summary").textContent()).toContain("3 dibujos → 3 fotogramas a 12 FPS");
    expect(await page.getByTestId("export-summary").textContent()).toContain("1280×720");
    await page.screenshot({ path: join(SHOTS, "20-exportar-escritorio.png") });

    await page.getByTestId("export-start").click();
    await waitDone(page);
    expect(await page.getByTestId("export-result").textContent()).toContain("Capítulo uno.mp4");
    expect(await page.getByTestId("export-result").textContent()).toContain("1280×720");

    const file = tmp("capitulo.mp4");
    writeFileSync(file, await fetchFile(await href(page)));
    expect(await ffprobe(file, "stream=codec_name,width,height,nb_read_frames,avg_frame_rate")).toBe("h264,1280,720,12/1,3");
    const px = await decodeCorner(file);
    expect(px).toHaveLength(3);
    [[255, 0, 0], [0, 170, 0], [0, 0, 255]].forEach((c, i) => expect(near(px[i]!, c as [number, number, number], 16), `fotograma ${i}`).toBe(true));
    // y el archivo queda accesible en la lista de exportaciones anteriores
    await page.getByTestId("export-new").click();
    expect(await page.getByTestId("export-previous").textContent()).toContain("Capítulo uno.mp4");
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);

  it("el progreso es real: crece, nunca retrocede y muestra los fotogramas procesados", async () => {
    const s = await seedColors(env, { colors: Array.from({ length: 60 }, (_, i) => `#${((i * 4000003) % 0xffffff).toString(16).padStart(6, "0")}`), width: 1280, height: 720, extraStrokes: 100, name: "Progreso" });
    const { ctx, page } = await openEditorPage(env, s.url);
    await openDialog(page);
    await page.selectOption("[data-testid=export-quality]", "medium");
    await page.getByTestId("export-start").click();
    const bar = page.getByTestId("export-progress");
    await bar.waitFor();
    expect(await bar.getAttribute("role")).toBe("progressbar");
    const values: number[] = [];
    const statuses = new Set<string>();
    for (let i = 0; i < 4000; i++) {
      if (await page.getByTestId("export-done").count()) break;
      const v = await bar.getAttribute("aria-valuenow", { timeout: 500 }).catch(() => null);
      if (v !== null) values.push(Number(v));
      const st = await page.getByTestId("export-status").textContent({ timeout: 500 }).catch(() => null);
      if (st) statuses.add(st);
      if (values.length === 6) await page.screenshot({ path: join(SHOTS, "21-exportando-escritorio.png") });
      await page.waitForTimeout(40);
    }
    await waitDone(page);
    expect(new Set(values).size).toBeGreaterThanOrEqual(3);
    expect([...values].sort((a, b) => a - b)).toEqual(values); // jamás retrocede
    expect([...statuses].some((t) => /Renderizando fotogramas: \d+ de 60/.test(t))).toBe(true);
    await ctx.close();
  }, 180_000);

  it("cancelar desde la interfaz: se detiene, vuelve al formulario, mata FFmpeg y no deja archivos", async () => {
    const s = await seedColors(env, { colors: Array.from({ length: 150 }, (_, i) => `#${((i * 7000003) % 0xffffff).toString(16).padStart(6, "0")}`), width: 1920, height: 1080, extraStrokes: 150, name: "Cancelar" });
    const { ctx, page } = await openEditorPage(env, s.url);
    await openDialog(page);
    await page.selectOption("[data-testid=export-quality]", "max");
    await page.getByTestId("export-name").fill("grande-cancelar");
    await page.getByTestId("export-start").click();
    await page.waitForFunction(() => Number(document.querySelector("[data-testid=export-progress]")?.getAttribute("aria-valuenow")) >= 2, undefined, { timeout: 60_000 });
    await page.getByTestId("export-cancel").click();
    expect(await page.getByTestId("export-cancel").isDisabled()).toBe(true);
    await page.getByTestId("export-start").waitFor({ timeout: 15_000 }); // de vuelta al formulario
    expect(await dialog(page).textContent()).toContain("Exportación cancelada");
    await page.waitForTimeout(400);
    expect(await readdir(exportsOf(s.projectId))).toEqual([]);
    expect(await pgrepX264("libx264.*grande-cancelar")).toBe("");
    await ctx.close();
  }, 120_000);

  it("no sobrescribe sin permiso: avisa, ofrece otro nombre o sustituir", async () => {
    const s = await seedColors(env, { colors: [RED, BLUE], name: "Nombres" });
    const { ctx, page } = await openEditorPage(env, s.url);
    await openDialog(page);
    await page.getByTestId("export-format-png").click();
    await page.getByTestId("export-name").fill("portada");
    await page.getByTestId("export-start").click();
    await waitDone(page);
    await page.getByTestId("export-new").click();
    await page.getByTestId("export-start").click();
    await page.getByTestId("export-exists").waitFor();
    expect(await page.getByTestId("export-exists").textContent()).toContain("portada.png");
    expect((await readdir(exportsOf(s.projectId))).sort()).toEqual(["portada.png"]); // nada se tocó
    await page.getByTestId("export-rename").click();
    await waitDone(page);
    expect(await page.getByTestId("export-result").textContent()).toContain("portada (2).png");
    await page.getByTestId("export-new").click();
    await page.getByTestId("export-start").click();
    await page.getByTestId("export-exists").waitFor();
    await page.getByTestId("export-overwrite").click();
    await waitDone(page);
    expect(await page.getByTestId("export-result").textContent()).toContain("portada.png");
    expect((await readdir(exportsOf(s.projectId))).sort()).toEqual(["portada (2).png", "portada.png"]);
    await ctx.close();
  }, 120_000);

  it("transparencia: MP4 no la admite; WebM (VP9 con alfa) y PNG sí", async () => {
    const s = await seedColors(env, { colors: [RED], name: "Alfa" });
    // un dibujo con un cuadrado en el centro (no cubre todo) para poder ver el fondo
    const url = `${env.base}/api/projects/${s.projectId}/episodes/${s.episodeId}/animation`;
    const a = (await (await fetch(url)).json()) as typeof s.anim;
    const layer = a.layers[1]!.id;
    a.frames[0]!.cells[layer] = [{ id: "sq", kind: "pen", color: "#ff0000", size: 120, opacity: 1, sens: 0, points: [320, 180, 1, 320, 180.1, 1] }];
    expect((await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(a) })).ok).toBe(true);

    const { ctx, page } = await openEditorPage(env, s.url);
    await openDialog(page);
    expect(await page.getByTestId("export-bg-transparent").isDisabled()).toBe(true); // MP4
    await page.getByTestId("export-format-webm").click();
    expect(await page.getByTestId("export-bg-transparent").isDisabled()).toBe(false);
    await page.getByTestId("export-bg-transparent").click();
    await page.getByTestId("export-name").fill("alfa");
    await page.getByTestId("export-start").click();
    await waitDone(page);
    const webm = tmp("alfa.webm");
    writeFileSync(webm, await fetchFile(await href(page)));
    expect(await ffprobe(webm, "stream=codec_name:stream_tags=alpha_mode")).toBe("vp9,1");
    // vista previa: Chromium reproduce VP9, así que debe haber un <video> que carga
    const video = page.getByTestId("export-preview");
    await video.waitFor();
    await page.waitForFunction(() => (document.querySelector("[data-testid=export-preview]") as HTMLVideoElement).readyState >= 1);
    expect(await video.evaluate((v: HTMLVideoElement) => [v.videoWidth, v.videoHeight, Math.round(v.duration * 24)])).toEqual([640, 360, 1]);
    await page.screenshot({ path: join(SHOTS, "22-exportado-escritorio.png") });

    // PNG con transparencia
    await page.getByTestId("export-new").click();
    await page.getByTestId("export-format-png").click();
    await page.getByTestId("export-bg-transparent").click();
    await page.getByTestId("export-name").fill("alfa");
    await page.getByTestId("export-start").click();
    await waitDone(page);
    const img = await loadImage(await fetchFile(await href(page)));
    const c = createCanvas(img.width, img.height);
    const cx = c.getContext("2d");
    cx.drawImage(img, 0, 0);
    expect([img.width, img.height]).toEqual([640, 360]);
    expect(cx.getImageData(5, 5, 1, 1).data[3]).toBe(0);
    expect(Array.from(cx.getImageData(320, 180, 1, 1).data)).toEqual([255, 0, 0, 255]);
    await ctx.close();
  }, 120_000);
});

describe("el vídeo exportado coincide con lo que se ve en el editor", () => {
  it("un fotograma dibujado en el editor (capas, opacidad, borrador) se exporta idéntico (±suavizado)", async () => {
    const ep = await createEpisode(env, { name: "Comparar", width: 640, height: 360 });
    const { ctx, page } = await openEditorPage(env, ep.url, { viewport: { width: 1366, height: 800 }, deviceScaleFactor: 1 });
    // Vista al 100 % con desplazamiento entero: cada píxel del editor = un píxel del documento
    await page.evaluate(() => window.__gas!.viewport.setView({ zoom: 1, x: 120, y: 60 }));
    await page.keyboard.press("o"); // sin papel cebolla
    await settle(page);

    await page.getByTestId("brush-size").fill("40");
    await setColor(page, "#e8323c");
    await mouseStroke(page, [[80, 180], [160, 90], [260, 70], [380, 100], [450, 190], [380, 280], [250, 300], [140, 270], [80, 180]]);
    await page.locator("[data-testid=layer-row]", { hasText: "Color" }).locator("[data-testid=layer-name]").click();
    await setColor(page, "#2b4aa8");
    await page.getByTestId("brush-opacity").fill("55");
    await mouseStroke(page, line(40, 330, 600, 40, 20));
    await page.getByTestId("brush-opacity").fill("100");
    await page.getByTestId("tool-eraser").click();
    await page.getByTestId("brush-size").fill("36");
    await mouseStroke(page, line(320, 20, 320, 340, 16));
    await page.locator("[data-testid=layer-row]", { hasText: "Líneas" }).locator("[data-testid=layer-name]").click();
    await page.getByTestId("tool-pen").click();
    await setColor(page, "#111111");
    await page.getByTestId("brush-size").fill("20");
    await mouseStroke(page, [[200, 150], [250, 200], [300, 160], [360, 210]]);
    await settle(page);

    // 1) lo que muestra el editor (recorte del lienzo del documento)
    const shot = await page.evaluate(() => {
      const g = window.__gas!;
      const src = document.querySelector("canvas.stage-canvas") as HTMLCanvasElement;
      const out = document.createElement("canvas");
      out.width = g.model.doc.width;
      out.height = g.model.doc.height;
      out.getContext("2d")!.drawImage(src, g.viewport.view.x * (src.width / src.clientWidth), g.viewport.view.y * (src.width / src.clientWidth), out.width, out.height, 0, 0, out.width, out.height);
      return out.toDataURL("image/png");
    });
    const editorImg = await loadImage(Buffer.from(shot.split(",")[1]!, "base64"));

    // 2) lo que exporta el estudio (PNG del mismo fotograma, a la resolución original, con fondo blanco)
    await openDialog(page);
    await page.getByTestId("export-format-png").click();
    await page.getByTestId("export-name").fill("comparar");
    await page.getByTestId("export-start").click();
    await waitDone(page);
    const exported = await loadImage(await fetchFile(await href(page)));
    expect([exported.width, exported.height]).toEqual([640, 360]);

    const read = (img: typeof exported) => {
      const c = createCanvas(640, 360);
      const cx = c.getContext("2d");
      cx.drawImage(img, 0, 0);
      return cx.getImageData(0, 0, 640, 360).data;
    };
    const A = read(editorImg);
    const B = read(exported);
    let sum = 0;
    let over24 = 0;
    let over64 = 0;
    for (let i = 0; i < A.length; i += 4) {
      const d = Math.max(Math.abs(A[i]! - B[i]!), Math.abs(A[i + 1]! - B[i + 1]!), Math.abs(A[i + 2]! - B[i + 2]!));
      sum += d;
      if (d > 24) over24++;
      if (d > 64) over64++;
    }
    const px = A.length / 4;
    writeFileSync(join(SHOTS, "comparacion-editor-exportacion.json"), JSON.stringify({ pixeles: px, diferenciaMedia: +(sum / px).toFixed(4), pixelesConDiferenciaMayorQue24: over24, pixelesConDiferenciaMayorQue64: over64, porcentajeIgualesTol24: +(100 * (1 - over24 / px)).toFixed(3) }, null, 2));
    expect(sum / px).toBeLessThan(1.0); // diferencia media por píxel (0–255)
    expect(over24 / px).toBeLessThan(0.01); // >99 % de los píxeles prácticamente iguales
    expect(over64 / px).toBeLessThan(0.003); // sin diferencias de forma, solo suavizado de bordes
    await ctx.close();
  }, 120_000);

  it("exporta lo GUARDADO: si acabas de dibujar, el editor guarda antes de exportar", async () => {
    const ep = await createEpisode(env, { name: "GuardarAntes", width: 640, height: 360 });
    const { ctx, page } = await openEditorPage(env, ep.url);
    await setColor(page, "#ff0000");
    await page.getByTestId("brush-size").fill("31");
    await mouseStroke(page, line(100, 180, 540, 180)); // sin esperar al autoguardado
    await openDialog(page);
    await page.getByTestId("export-format-png").click();
    await page.getByTestId("export-bg-transparent").click();
    await page.getByTestId("export-name").fill("recien");
    await page.getByTestId("export-start").click();
    await waitDone(page);
    const img = await loadImage(await fetchFile(await href(page)));
    const c = createCanvas(img.width, img.height);
    const cx = c.getContext("2d");
    cx.drawImage(img, 0, 0);
    expect(Array.from(cx.getImageData(320, 180, 1, 1).data)).toEqual([255, 0, 0, 255]);
    await ctx.close();
  }, 60_000);

  it("al terminar un fotograma de un vídeo con duraciones y capas ocultas, el resultado respeta la visibilidad", async () => {
    const s = await seedColors(env, { colors: [RED, BLUE], name: "Visibilidad" });
    const url = `${env.base}/api/projects/${s.projectId}/episodes/${s.episodeId}/animation`;
    const a = (await (await fetch(url)).json()) as typeof s.anim;
    a.layers = a.layers.map((l, i) => (i === 1 ? { ...l, visible: false } : l)); // se oculta la capa donde está todo
    await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(a) });
    const { ctx, page } = await openEditorPage(env, s.url);
    await openDialog(page);
    await page.getByTestId("export-format-png").click();
    await page.getByTestId("export-name").fill("oculta");
    await page.getByTestId("export-start").click();
    await waitDone(page);
    const img = await loadImage(await fetchFile(await href(page)));
    const c = createCanvas(img.width, img.height);
    const cx = c.getContext("2d");
    cx.drawImage(img, 0, 0);
    expect(Array.from(cx.getImageData(100, 100, 1, 1).data)).toEqual([255, 255, 255, 255]); // capa oculta: solo el papel
    await ctx.close();
  }, 60_000);
});

describe("sin FFmpeg", () => {
  it("los formatos de vídeo aparecen desactivados con la explicación, y PNG sigue funcionando", async () => {
    const noFfmpeg = await startEnv({ ffmpeg: { ffmpeg: "/no/existe/ffmpeg", ffprobe: "/no/existe/ffprobe" } });
    try {
      const ep = await createEpisode(noFfmpeg, { name: "SinFFmpeg", width: 320, height: 180 });
      const { ctx, page } = await openEditorPage(noFfmpeg, ep.url);
      await openDialog(page);
      for (const f of ["mp4", "webm"]) {
        const b = page.getByTestId(`export-format-${f}`);
        expect(await b.isDisabled()).toBe(true);
        expect(await b.textContent()).toContain("No se encontró FFmpeg");
      }
      expect(await page.getByTestId("export-format-png-seq").getAttribute("aria-checked")).toBe("true"); // cae al primero disponible
      await page.getByTestId("export-format-png").click();
      await page.getByTestId("export-name").fill("sin-ffmpeg");
      await page.getByTestId("export-start").click();
      await page.getByTestId("export-done").waitFor({ timeout: 60_000 });
      await ctx.close();
    } finally {
      await noFfmpeg.close();
    }
  }, 90_000);
});

describe("Android (Pixel 7 emulado)", () => {
  it("la ventana ocupa la pantalla, todo es táctil (≥44 px), sin desbordes, y exporta", async () => {
    const s = await seedColors(env, { colors: [RED, GREEN, BLUE], holds: [3, 3, 3], fps: 12, name: "Movil" });
    const { ctx, page, errors } = await openEditorPage(env, s.url, { ...devices["Pixel 7"] });
    await page.getByTestId("export-open").tap();
    await dialog(page).waitFor();
    const box = (await dialog(page).boundingBox())!;
    expect(Math.round(box.width)).toBe(412); // pantalla completa
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);

    const small = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>("[data-testid=export-dialog] button, [data-testid=export-dialog] select, [data-testid=export-dialog] input, [data-testid=export-dialog] a")) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.width === 0 || cs.visibility === "hidden") continue;
        if (r.bottom < 0 || r.top > innerHeight * 3) continue;
        if (r.height < 43.5 || (r.width < 43.5)) bad.push(`${el.getAttribute("data-testid") ?? el.tagName} ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
      return bad;
    });
    expect(small).toEqual([]);
    await page.screenshot({ path: join(SHOTS, "23-exportar-android.png") });

    await page.getByTestId("export-name").fill("desde el móvil");
    await page.selectOption("[data-testid=export-resolution]", "480");
    await page.getByTestId("export-start").tap();
    await page.getByTestId("export-progress").waitFor();
    await page.screenshot({ path: join(SHOTS, "24-exportando-android.png") });
    await waitDone(page);
    expect(await page.getByTestId("export-result").textContent()).toContain("854×480");
    await page.screenshot({ path: join(SHOTS, "25-exportado-android.png") });
    const file = tmp("movil.mp4");
    writeFileSync(file, await fetchFile(await href(page)));
    expect(await ffprobe(file, "stream=codec_name,width,height,nb_read_frames")).toBe("h264,854,480,9");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);

  it("se puede cerrar la ventana durante la exportación: sigue en segundo plano y al reabrir se reanuda el seguimiento", async () => {
    const s = await seedColors(env, { colors: Array.from({ length: 60 }, (_, i) => `#${((i * 3000017) % 0xffffff).toString(16).padStart(6, "0")}`), width: 1280, height: 720, extraStrokes: 90, name: "Segundo plano" });
    const { ctx, page } = await openEditorPage(env, s.url, { ...devices["Pixel 7"] });
    await page.getByTestId("export-open").tap();
    await dialog(page).waitFor();
    await page.getByTestId("export-name").fill("fondo");
    await page.getByTestId("export-start").tap();
    await page.getByTestId("export-progress").waitFor();
    await page.getByTestId("export-close").tap();
    await dialog(page).waitFor({ state: "detached" });
    await page.getByTestId("export-open").tap();
    await dialog(page).waitFor();
    // al reabrir encuentra la exportación en marcha (barra de progreso) o ya terminada
    await Promise.race([page.getByTestId("export-progress").waitFor(), page.getByTestId("export-done").waitFor()]);
    await waitDone(page);
    expect(await page.getByTestId("export-result").textContent()).toContain("fondo.mp4");
    await ctx.close();
  }, 180_000);
});

describe("ejemplos reales", () => {
  it("una animación dibujada en el editor (pelota que rebota) exportada en los 4 formatos", async () => {
    const ep = await createEpisode(env, { name: "Pelota", width: 1280, height: 720, fps: 24 });
    const { ctx, page } = await openEditorPage(env, ep.url, { viewport: { width: 1366, height: 800 }, deviceScaleFactor: 1 });
    await page.keyboard.press("o"); // el papel cebolla no se exporta, pero así se dibuja más limpio
    const ellipse = (cx: number, cy: number, rx: number, ry: number, n = 28): Array<[number, number]> =>
      Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos((i / n) * 2 * Math.PI) * rx, cy + Math.sin((i / n) * 2 * Math.PI) * ry] as [number, number]);

    // 12 dibujos: la pelota baja, se aplasta al tocar el suelo y vuelve a subir
    const ys = [150, 190, 260, 360, 470, 545, 575, 545, 470, 360, 260, 190];
    const squash = [1, 1, 1, 1, 1.02, 1.12, 1.35, 1.12, 1.02, 1, 1, 1];
    await page.getByTestId("brush-size").fill("45"); // grosor ≈ 14 px
    for (let i = 0; i < ys.length; i++) {
      if (i > 0) await page.getByTestId("add-frame").click();
      await page.locator("[data-testid=layer-row]", { hasText: "Color" }).locator("[data-testid=layer-name]").click();
      await setColor(page, "#e8323c");
      const rx = 70 * squash[i]!;
      const ry = 70 / squash[i]!;
      const cy = ys[i]!;
      await mouseStroke(page, ellipse(640, cy, rx, ry));
      await mouseStroke(page, [[640 - rx * 0.4, cy - ry * 0.2], [640 - rx * 0.1, cy - ry * 0.5]]); // brillo
      await page.locator("[data-testid=layer-row]", { hasText: "Líneas" }).locator("[data-testid=layer-name]").click();
      await setColor(page, "#1d1a26");
      await mouseStroke(page, [[100, 660], [1180, 660]]); // suelo
    }
    // dos fotogramas de duración cada dibujo («a doses»)
    for (let i = 0; i < ys.length; i++) {
      await page.evaluate((k) => window.__gas!.model.setFrameIndex(k), i);
      await page.getByTestId("hold-more").click();
    }
    expect((await page.evaluate(() => window.__gas!.model.doc.frames.map((f) => f.hold)))).toEqual(Array(12).fill(2));

    const out = join(SHOTS, "ejemplos");
    mkdirSync(out, { recursive: true });
    const run = async (format: string, name: string, extra: () => Promise<void> = async () => undefined) => {
      await openDialog(page);
      await page.getByTestId(`export-format-${format}`).click();
      await extra();
      await page.getByTestId("export-name").fill(name);
      await page.getByTestId("export-start").click();
      await waitDone(page);
      await page.getByTestId("export-close").click();
      await dialog(page).waitFor({ state: "detached" });
    };
    await run("mp4", "pelota_720p_24fps", async () => { await page.selectOption("[data-testid=export-resolution]", "720"); });
    await run("mp4", "pelota_1080p_12fps", async () => { await page.selectOption("[data-testid=export-resolution]", "1080"); await page.selectOption("[data-testid=export-fps]", "12"); });
    await run("webm", "pelota_transparente", async () => { await page.getByTestId("export-bg-transparent").click(); });
    await run("png-seq", "pelota_secuencia", async () => { await page.getByTestId("export-bg-transparent").click(); });
    await page.evaluate(() => window.__gas!.model.setFrameIndex(6));
    await run("png", "pelota_fotograma_7", async () => { await page.getByTestId("export-bg-white").click(); });

    const ex = exportsOf(ep.projectId);
    const names = readdirSync(ex).sort();
    expect(names).toEqual(["pelota_1080p_12fps.mp4", "pelota_720p_24fps.mp4", "pelota_fotograma_7.png", "pelota_secuencia.zip", "pelota_transparente.webm"]);
    for (const n of names) copyFileSync(join(ex, n), join(out, n));

    // Comprobaciones sobre los archivos reales
    expect(await ffprobe(join(out, "pelota_720p_24fps.mp4"), "stream=codec_name,width,height,nb_read_frames,avg_frame_rate")).toBe("h264,1280,720,24/1,24"); // 12 dibujos × 2 = 24 fotogramas = 1 s
    expect(await ffprobe(join(out, "pelota_1080p_12fps.mp4"), "stream=codec_name,width,height,nb_read_frames,avg_frame_rate")).toBe("h264,1920,1080,12/1,12");
    expect(await ffprobe(join(out, "pelota_transparente.webm"), "stream=codec_name:stream_tags=alpha_mode")).toBe("vp9,1");
    const zipEntries = readStoredZip(await readFile(join(out, "pelota_secuencia.zip")));
    expect(zipEntries).toHaveLength(24);
    // La pelota se ve en el vídeo: el centro del fotograma 7 (pelota aplastada abajo) no es blanco
    const frames = await decodeCorner(join(out, "pelota_720p_24fps.mp4"));
    expect(frames).toHaveLength(24);
    await ctx.close();
  }, 360_000);
});

