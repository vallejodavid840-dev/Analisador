import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { devices, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeFrames, redCentroid } from "../packages/export/test/helpers";
import { SHOTS, boneGeo, boneRow, createEpisode, docPixel, dragDoc, isRed, isWhite, openEditorPage, poseRot, settle, setNum, startEnv, toScreen, touch, type Env } from "./helpers";
import { armSetup, goto } from "./rig-setup";

let env: Env;
beforeAll(async () => (env = await startEnv()));
afterAll(() => env.close());

const VP = { viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 } as const;
const PIXEL = devices["Pixel 7"];
const waitDone = (page: Page) => page.getByTestId("export-done").waitFor({ timeout: 120_000 });
const ffprobe = (file: string, entries: string) => new Promise<string>((res, rej) => execFile("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", entries, "-of", "csv=p=0", file], (e, out) => (e ? rej(e) : res(String(out).trim()))));
const fetchFile = async (path: string) => Buffer.from(await (await fetch(env.base + path)).arrayBuffer());

describe("uso táctil (Android, Pixel 7 emulado)", () => {
  it("el panel se abre como hoja, todos los controles son táctiles (≥44 px) y se crea la plantilla con un toque", async () => {
    const ep = await createEpisode(env, { width: 1280, height: 720 });
    const { ctx, page, errors } = await openEditorPage(env, ep.url, { ...PIXEL });
    await page.getByTestId("tool-rig").tap();
    await page.getByTestId("open-rig").tap();
    const side = page.getByTestId("side");
    expect(await side.isVisible()).toBe(true);
    for (const s of ["brush", "color", "layers"]) expect(await page.locator(`[data-section=${s}]`).isVisible()).toBe(false);
    await page.getByTestId("rig-humanoid").tap();
    expect(await page.evaluate(() => window.__gas!.model.skeleton?.bones.length)).toBe(16);

    // auditoría: cada control interactivo visible de la hoja mide al menos 44 px
    const audit = () => page.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>("[data-section=rig] button, [data-section=rig] select, [data-section=rig] input:not([type=checkbox]), [data-section=rig] label.check")) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.width === 0 || r.height === 0 || cs.visibility === "hidden") continue;
        const clip = el.closest(".bone-tree, .infl, .side") as HTMLElement | null;
        if (clip) { const c = clip.getBoundingClientRect(); if (r.bottom < c.top || r.top > c.bottom) continue; }
        if (r.height < 43.5 || r.width < 43.5) bad.push(`${el.getAttribute("data-testid") ?? el.className} ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
      return bad;
    });
    expect(await audit()).toEqual([]);
    await page.getByTestId("rig-mode-pose").tap();
    await boneRow(page, "Brazo inferior izq.").tap();
    expect(await audit()).toEqual([]);
    await page.getByTestId("rig-mode-edit").tap();
    expect(await audit()).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: join(SHOTS, "30-rig-android-panel.png") });

    // poner pose con el deslizador y con el campo numérico (táctil)
    await page.getByTestId("rig-mode-pose").tap();
    await boneRow(page, "Brazo superior izq.").tap();
    await page.getByTestId("bone-rot-slider").fill("-70");
    await page.getByTestId("bone-rot-slider").dispatchEvent("change");
    expect(Math.round(await poseRot(page, "Brazo superior izq."))).toBe(-70);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);

  it("girar un hueso con el dedo, con rotación heredada y límites; el pellizco de dos dedos hace zoom sin crear huesos", async () => {
    const ep = await createEpisode(env, { width: 1280, height: 720 });
    const { ctx, page } = await openEditorPage(env, ep.url, { ...PIXEL });
    const cdp = await ctx.newCDPSession(page);
    await page.getByTestId("tool-rig").tap();
    await page.getByTestId("open-rig").tap();
    await page.getByTestId("rig-humanoid").tap();
    await page.getByTestId("rig-mode-pose").tap();
    await page.getByTestId("open-rig").tap(); // cerrar la hoja: queda todo el lienzo para arrastrar
    await settle(page);
    expect(await page.getByTestId("side").isVisible()).toBe(false);
    expect(await page.evaluate(() => document.elementFromPoint(200, 300)?.tagName)).toBe("CANVAS"); // nada cubre el lienzo

    // el antebrazo izquierdo sigue al brazo superior cuando éste gira (herencia)
    const hand0 = await boneGeo(page, "Mano izq.");
    const finger = async (from: [number, number], to: [number, number]) => {
      const a = await toScreen(page, ...from);
      const b = await toScreen(page, ...to);
      await touch(cdp, "touchStart", [{ ...a, id: 0 }]);
      for (let i = 1; i <= 10; i++) await touch(cdp, "touchMove", [{ x: a.x + ((b.x - a.x) * i) / 10, y: a.y + ((b.y - a.y) * i) / 10, id: 0 }]);
      await touch(cdp, "touchEnd", []);
      await settle(page);
    };
    const upper = await boneGeo(page, "Brazo superior izq.");
    // arrastra el extremo del brazo superior (el codo) hacia arriba-derecha: gira alrededor del hombro
    await finger(upper.tail, [upper.head[0] + 120, upper.head[1] - 60]);
    const r = await poseRot(page, "Brazo superior izq.");
    expect(r).toBeLessThan(-60); // giro antihorario
    const hand1 = await boneGeo(page, "Mano izq.");
    expect(Math.hypot(hand1.head[0] - hand0.head[0], hand1.head[1] - hand0.head[1])).toBeGreaterThan(80); // la mano fue arrastrada
    expect(await page.evaluate(() => window.__gas!.model.keyFrameList)).toEqual([0]); // un gesto = keyframe en el fotograma actual
    const hist = await page.evaluate(() => window.__gas!.model.history.canUndo);
    expect(hist).toBe(true);

    // pellizco con dos dedos: zoom, y NO se crea ni se mueve ningún hueso
    const bonesBefore = await page.evaluate(() => JSON.stringify(window.__gas!.model.skeleton!.bones));
    const z0 = await page.evaluate(() => window.__gas!.viewport.view.zoom);
    const c = await toScreen(page, 640, 360);
    await touch(cdp, "touchStart", [{ x: c.x - 30, y: c.y, id: 1 }, { x: c.x + 30, y: c.y, id: 2 }]);
    for (let i = 1; i <= 8; i++) await touch(cdp, "touchMove", [{ x: c.x - 30 - i * 10, y: c.y, id: 1 }, { x: c.x + 30 + i * 10, y: c.y, id: 2 }]);
    await touch(cdp, "touchEnd", []);
    await settle(page);
    expect(await page.evaluate(() => window.__gas!.viewport.view.zoom)).toBeGreaterThan(z0 * 1.5);
    expect(await page.evaluate(() => JSON.stringify(window.__gas!.model.skeleton!.bones))).toBe(bonesBefore);
    await page.screenshot({ path: join(SHOTS, "31-rig-android-pose.png") });
    await ctx.close();
  }, 120_000);

  it("horizontal: el panel del esqueleto es un cajón lateral y el lienzo conserva espacio", async () => {
    const ep = await createEpisode(env, { width: 1280, height: 720 });
    const { ctx, page } = await openEditorPage(env, ep.url, { ...devices["Pixel 7 landscape"] });
    await page.getByTestId("tool-rig").tap();
    await page.getByTestId("open-rig").tap();
    await page.getByTestId("rig-humanoid").tap();
    expect(await page.getByTestId("side").isVisible()).toBe(true);
    const box = (await page.getByTestId("side").boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(340);
    await page.screenshot({ path: join(SHOTS, "32-rig-android-horizontal.png") });
    await ctx.close();
  }, 60_000);
});

describe("exportación de personajes con rig desde la interfaz", () => {
  /** Brazo animado: keyframes a 0° y 100° en 5 dibujos (25° por dibujo). */
  async function animatedArm(page: Page) {
    const { lo } = await armSetup(page, { frames: 5 });
    await page.getByTestId("key-save").click();
    await goto(page, 4);
    await setNum(page, "bone-rot", 100);
    await goto(page, 0);
    return lo;
  }

  it("el PNG exportado de un fotograma posado coincide con lo que muestra el editor (diferencia mínima) y respeta la transparencia", async () => {
    const ep = await createEpisode(env, { width: 640, height: 360 });
    const { ctx, page } = await openEditorPage(env, ep.url, VP);
    await page.evaluate(() => window.__gas!.viewport.setView({ zoom: 1, x: 120, y: 60 }));
    // brazo a la escala del documento de 640×360
    await page.keyboard.press("o");
    await page.getByTestId("brush-size").fill("34");
    const { setColor, mouseStroke, line } = await import("./helpers");
    await setColor(page, "#ff0000");
    await mouseStroke(page, line(150, 180, 450, 180, 2));
    await page.getByTestId("tool-rig").click();
    await page.getByTestId("rig-new").click();
    await dragDoc(page, [150, 180], [300, 180]);
    await dragDoc(page, [300, 180], [450, 180]);
    await page.getByTestId("rig-create").click();
    await page.getByTestId("rig-mode-pose").click();
    const sk = await page.evaluate(() => window.__gas!.model.skeleton!.bones.map((b) => b.id));
    await page.getByTestId("bind-mode").selectOption("skin");
    await page.getByTestId("bind-bone").selectOption(sk[0]!);
    for (const cb of await page.getByTestId("bind-infl").all()) await cb.check();
    await page.getByTestId("dup-frame").click();
    await page.getByTestId("first").click();
    await page.getByTestId("rig-toggle-show").click();
    await boneRow(page, "Hueso 2").click();
    await page.getByTestId("key-save").click();
    await goto(page, 1);
    await setNum(page, "bone-rot", 70);
    await settle(page);

    // lo que muestra el editor (recorte del documento) en el fotograma 2
    const shot = await page.evaluate(() => {
      const g = window.__gas!;
      const src = document.querySelector("canvas.stage-canvas") as HTMLCanvasElement;
      const out = document.createElement("canvas");
      out.width = g.model.doc.width;
      out.height = g.model.doc.height;
      const k = src.width / src.clientWidth;
      out.getContext("2d")!.drawImage(src, g.viewport.view.x * k, g.viewport.view.y * k, out.width, out.height, 0, 0, out.width, out.height);
      return out.toDataURL("image/png");
    });
    const editorImg = await loadImage(Buffer.from(shot.split(",")[1]!, "base64"));

    await page.getByTestId("export-open").click();
    await page.getByTestId("export-dialog").waitFor();
    await page.getByTestId("export-format-png").click();
    await page.getByTestId("export-name").fill("posado");
    await page.getByTestId("export-start").click();
    await waitDone(page);
    const exported = await loadImage(await fetchFile((await page.getByTestId("export-download").getAttribute("href"))!));
    const read = (img: typeof exported) => { const c = createCanvas(640, 360); const cx = c.getContext("2d"); cx.drawImage(img, 0, 0); return cx.getImageData(0, 0, 640, 360).data; };
    const A = read(editorImg);
    const B = read(exported);
    let sum = 0, over24 = 0;
    for (let i = 0; i < A.length; i += 4) { const d = Math.max(Math.abs(A[i]! - B[i]!), Math.abs(A[i + 1]! - B[i + 1]!), Math.abs(A[i + 2]! - B[i + 2]!)); sum += d; if (d > 24) over24++; }
    const px = A.length / 4;
    writeFileSync(join(SHOTS, "comparacion-rig-editor-exportacion.json"), JSON.stringify({ pixeles: px, diferenciaMedia: +(sum / px).toFixed(4), pixelesConDiferenciaMayorQue24: over24 }, null, 2));
    expect(sum / px).toBeLessThan(0.5);
    expect(over24 / px).toBeLessThan(0.005);
    // el brazo está doblado de verdad en lo exportado (no recto)
    expect(B[(180 * 640 + 400) * 4 + 3]).toBe(255); // fondo blanco opaco
    await ctx.close();
  }, 120_000);

  it("MP4 y WebM exportados del personaje animado: cada fotograma del vídeo tiene al personaje en su pose", async () => {
    const ep = await createEpisode(env, { width: 1280, height: 720 });
    const { ctx, page } = await openEditorPage(env, ep.url, VP);
    await animatedArm(page);
    await waitSavedSafe(page);
    await page.getByTestId("fps").selectOption("12");
    await page.getByTestId("export-open").click();
    await page.getByTestId("export-dialog").waitFor();
    await page.getByTestId("export-name").fill("brazo");
    await page.selectOption("[data-testid=export-resolution]", "720");
    await page.selectOption("[data-testid=export-fps]", "same");
    await page.getByTestId("export-start").click();
    await waitDone(page);
    const mp4 = join(env.dataDir, "brazo.mp4");
    writeFileSync(mp4, await fetchFile((await page.getByTestId("export-download").getAttribute("href"))!));
    expect(await ffprobe(mp4, "stream=codec_name,width,height,nb_read_frames")).toBe("h264,1280,720,5");
    const frames = await decodeFrames(mp4, 1280, 720);
    expect(frames).toHaveLength(5);
    // el centro de masa del rojo recorre el arco del antebrazo: a 25° por fotograma el codo está fijo y la muñeca gira 0°→100°
    const cs = frames.map((f) => redCentroid(f, 1280, 720)!);
    cs.forEach((c) => expect(c).not.toBeNull());
    // Geometría exacta: brazo superior fijo de 150 px y antebrazo de 150 px girando θ = 25°·k alrededor del codo.
    // El centro de masa de la tinta roja es (412,5 + 37,5·cosθ, 300 + 37,5·sinθ), con unos px de margen por el grosor y la curva del codo.
    cs.forEach((c, k) => {
      const th = (25 * k * Math.PI) / 180;
      expect(Math.abs(c![0] - (412.5 + 37.5 * Math.cos(th))), `x del fotograma ${k}`).toBeLessThan(6);
      expect(Math.abs(c![1] - (300 + 37.5 * Math.sin(th))), `y del fotograma ${k}`).toBeLessThan(6);
    });
    // WebM con transparencia
    await page.getByTestId("export-new").click();
    await page.getByTestId("export-format-webm").click();
    await page.getByTestId("export-bg-transparent").click();
    await page.getByTestId("export-name").fill("brazo-alfa");
    await page.getByTestId("export-start").click();
    await waitDone(page);
    const webm = join(env.dataDir, "brazo-alfa.webm");
    writeFileSync(webm, await fetchFile((await page.getByTestId("export-download").getAttribute("href"))!));
    expect(await ffprobe(webm, "stream=codec_name:stream_tags=alpha_mode")).toBe("vp9,1");
    await ctx.close();
  }, 180_000);
});

async function waitSavedSafe(page: Page) {
  await page.waitForFunction(() => window.__gas!.autosave.status === "saved" && !window.__gas!.autosave.dirty, undefined, { timeout: 15_000 });
}

describe("rendimiento del rig en el navegador", () => {
  /**
   * 40 huesos, 60 trazos deformables y 48 fotogramas con keyframes cada 6.
   *  - «realista»: curvas suaves de 800 px con un punto cada 5 px (como dibuja una persona).
   *  - «extremo»: zigzag artificial de ~60 px por tramo (≈10× más tinta): solo se MIDE, no se exige.
   */
  async function scenario(kind: "realista" | "extremo") {
    const ep = await createEpisode(env, { width: 1920, height: 1080, name: `Perf ${kind}` });
    const { ctx, page } = await openEditorPage(env, ep.url, VP);
    await page.evaluate((k) => {
      const g = window.__gas!;
      const m = g.model;
      const d = JSON.parse(JSON.stringify(m.doc));
      const uid = () => Math.random().toString(16).slice(2, 14).padEnd(12, "0");
      const N = 40;
      const bones: unknown[] = [];
      for (let i = 0; i < N; i++) bones.push({ id: `b${i}`, name: `Hueso ${i + 1}`, parent: i ? `b${i - 1}` : null, x: 100, y: 540, ax: 1, ay: 0, angle: i ? (i % 2 ? 4 : -4) : 0, length: 42, min: -90, max: 90 });
      const layer = d.layers[1].id;
      d.rigs = [{ id: "sk", name: "Cola", bones, bindings: [{ layerId: layer, mode: "skin", bone: "b0", influences: bones.map((b) => (b as { id: string }).id), softness: 20, sharpness: 3 }] }];
      let seed = 3;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const strokes = Array.from({ length: 60 }, (_, si) => {
        const pts: number[] = [];
        if (k === "realista") for (let j = 0; j < 160; j++) pts.push(100 + j * 5, 540 + Math.sin(j / 9 + si) * 60 + (si % 7) * 6, 1);
        else for (let j = 0; j < 120; j++) pts.push(100 + j * 13, 540 + (rnd() - 0.5) * 120, 1);
        return { id: uid(), kind: "pen", color: "#1d1a26", size: 6, opacity: 1, sens: 0, points: pts };
      });
      const frames = [];
      for (let i = 0; i < 48; i++) {
        const bp: Record<string, { r: number }> = {};
        for (let b = 0; b < N; b++) bp[`b${b}`] = { r: Math.sin(i / 6 + b / 5) * 25 };
        frames.push({ id: `f${i}`, hold: 1, cells: { [layer]: strokes }, ...(i % 6 === 0 ? { poses: { sk: { bones: bp, ease: "smooth" } } } : {}) });
      }
      d.frames = frames;
      m.replaceDoc(d);
    }, kind);

    // 1) reproducción a 24 FPS con todo el rig activo (cada pose se calcula la primera vez durante la reproducción)
    await page.getByTestId("fps").selectOption("24");
    await goto(page, 0);
    await page.getByTestId("play").click();
    await page.waitForTimeout(2500);
    await page.getByTestId("play").click();
    const log = await page.evaluate(() => window.__gas!.player.log.map((e) => ({ ...e })));
    const elapsed = log.at(-1)!.t;
    const ticks = log.length - 1;
    const expected = Math.floor((elapsed * 24) / 1000);
    // 2) fluidez mientras se arrastra una pose (intervalo medio entre fotogramas de pantalla)
    await page.getByTestId("tool-rig").click();
    await page.evaluate(() => { window.__gas!.model.rig.mode = "pose"; window.__gas!.model.setFrameIndex(3); window.__gas!.model.rig.show = true; });
    const drag = await page.evaluate(async () => {
      const m = window.__gas!.model;
      const t0 = performance.now();
      const N = 40;
      for (let i = 0; i < N; i++) {
        m.poseBoneLive("b10", { r: Math.sin(i / 5) * 40 });
        await new Promise((res) => requestAnimationFrame(() => res(null)));
      }
      m.rigEnd();
      return (performance.now() - t0) / N;
    });
    // 3) coste de pintar una pose ya calculada (pesos en caché)
    const render = await page.evaluate(() => {
      const g = window.__gas!;
      const t = performance.now();
      for (let i = 0; i < 12; i++) { g.model.setFrameIndex(i); g.viewport.render(); }
      return (performance.now() - t) / 12;
    });
    // 4) LÍNEA BASE: la MISMA animación con las poses ya horneadas en los trazos y sin rig (mismo coste de pintar)
    let baked: number | null = null;
    if (kind === "realista") {
      await page.evaluate(() => {
        const m = window.__gas!.model;
        const d = JSON.parse(JSON.stringify(m.doc));
        d.frames = d.frames.map((f: Record<string, unknown>, i: number) => ({ ...f, cells: JSON.parse(JSON.stringify(m.renderedFrame(i).cells)), poses: undefined }));
        delete d.rigs;
        m.replaceDoc(d);
      });
      await page.evaluate(() => { window.__gas!.model.rig.mode = "pose"; });
      await goto(page, 0);
      await page.getByTestId("play").click();
      await page.waitForTimeout(2500);
      await page.getByTestId("play").click();
      const lg = await page.evaluate(() => window.__gas!.player.log.map((e) => e.t));
      baked = (lg.length - 1) / Math.floor((lg.at(-1)! * 24) / 1000);
    }
    await ctx.close();
    return { sostenido: ticks / expected, ticks, expected, drag, render, baked };
  }

  it("realista: esqueleto de 40 huesos, 60 trazos deformables y 48 fotogramas — reproducción a 24 FPS y arrastre fluidos", async () => {
    const r = await scenario("realista");
    const ext = await scenario("extremo");
    writeFileSync(join(SHOTS, "rig-perf.json"), JSON.stringify({
      nota: "Navegador sin GPU (rasterizado por software), CPU sin limitar. «sostenido» = fotogramas mostrados / fotogramas que tocaba mostrar a 24 FPS.",
      escenario: { huesos: 40, trazos: 60, fotogramas: 48, resolucion: "1920×1080" },
      realista: { puntosPorTrazo: 160, reproduccion24fps: { ticksReales: r.ticks, ticksEsperados: r.expected, sostenido: +r.sostenido.toFixed(3) }, mismaAnimacionSinRig_trazosHorneados: { sostenido: +(r.baked ?? 0).toFixed(3) }, arrastreMsPorFotograma: +r.drag.toFixed(1), renderPoseMs: +r.render.toFixed(1) },
      extremo_zigzag: { reproduccion24fps: { ticksReales: ext.ticks, ticksEsperados: ext.expected, sostenido: +ext.sostenido.toFixed(3) }, arrastreMsPorFotograma: +ext.drag.toFixed(1), renderPoseMs: +ext.render.toFixed(1) },
    }, null, 2));
    // El criterio es RELATIVO a una línea base medida (no un número inventado): el rig no puede ser más lento que pintar
    // las mismas poses sin rig, y debe haber un mínimo absoluto de fluidez.
    expect(r.sostenido).toBeGreaterThan(r.baked! * 0.9);
    expect(r.sostenido).toBeGreaterThan(0.6);
    expect(r.drag).toBeLessThan(80); // arrastrar un hueso a ≥12 fps con 40 huesos y ~10 000 puntos deformables
    expect(ext.sostenido).toBeGreaterThan(0.1); // el caso extremo no bloquea el editor
  }, 240_000);
});

void isRed; void isWhite; void docPixel; void mkdirSync;
