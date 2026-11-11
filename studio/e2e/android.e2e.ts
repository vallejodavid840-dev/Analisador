import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { devices, type CDPSession, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SHOTS, createEpisode, docPixel, isRed, line, openEditorPage, penEvent, settle, startEnv, strokes, toScreen, touch, waitSaved, type Env } from "./helpers";

let env: Env;
beforeAll(async () => (env = await startEnv()));
afterAll(() => env.close());

const PIXEL = devices["Pixel 7"];
const PIXEL_LAND = devices["Pixel 7 landscape"];

async function android(landscape = false) {
  const ep = await createEpisode(env, { width: 1280, height: 720 });
  const r = await openEditorPage(env, ep.url, { ...(landscape ? PIXEL_LAND : PIXEL) });
  const cdp = await r.ctx.newCDPSession(r.page);
  return { ...r, cdp, ep };
}

/** Un dedo recorriendo puntos de documento. */
async function finger(page: Page, cdp: CDPSession, pts: Array<[number, number]>, id = 0) {
  const sp = [];
  for (const [x, y] of pts) sp.push({ ...(await toScreen(page, x, y)), id });
  await touch(cdp, "touchStart", [sp[0]!]);
  for (const p of sp.slice(1)) await touch(cdp, "touchMove", [p]);
  await touch(cdp, "touchEnd", []);
  await settle(page);
}

/** En móvil los paneles son una hoja: se abre, se ajusta y se cierra, como haría el usuario. */
async function inSheet(page: Page, btn: "open-brush" | "open-color" | "open-layers", fn: () => Promise<void>) {
  await page.getByTestId(btn).tap();
  await fn();
  await page.getByTestId(btn).tap();
}
const mColor = (page: Page, hex: string) => inSheet(page, "open-color", () => page.getByTestId("color-hex").fill(hex));
const mSize = (page: Page, v: string) => inSheet(page, "open-brush", () => page.getByTestId("brush-size").fill(v));

const zoomOf = (page: Page) => page.evaluate(() => window.__gas!.viewport.view.zoom);

describe("Android (Pixel 7 emulado, pantalla táctil)", () => {
  it("dibujar con el dedo crea un trazo vectorial visible", async () => {
    const { ctx, page, cdp, errors } = await android();
    await mColor(page, "#ff0000");
    await mSize(page, "31");
    await finger(page, cdp, line(200, 360, 1000, 360, 20));
    const s = await strokes(page);
    expect(s).toHaveLength(1);
    expect(s[0]!.points.length / 3).toBeGreaterThan(5);
    expect(isRed(await docPixel(page, 600, 360))).toBe(true);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it("pellizco con dos dedos hace zoom y mueve el lienzo SIN dibujar", async () => {
    const { ctx, page, cdp } = await android();
    const z0 = await zoomOf(page);
    const c = await toScreen(page, 640, 360);
    await touch(cdp, "touchStart", [{ x: c.x - 40, y: c.y, id: 1 }, { x: c.x + 40, y: c.y, id: 2 }]);
    for (let i = 1; i <= 8; i++) await touch(cdp, "touchMove", [{ x: c.x - 40 - i * 12, y: c.y, id: 1 }, { x: c.x + 40 + i * 12, y: c.y, id: 2 }]);
    await touch(cdp, "touchEnd", []);
    await settle(page);
    expect(await zoomOf(page)).toBeGreaterThan(z0 * 1.6);
    expect(await strokes(page)).toHaveLength(0);

    // dos dedos desplazándose juntos = mover
    const v0 = await page.evaluate(() => ({ ...window.__gas!.viewport.view }));
    await touch(cdp, "touchStart", [{ x: 150, y: 400, id: 1 }, { x: 250, y: 400, id: 2 }]);
    for (let i = 1; i <= 6; i++) await touch(cdp, "touchMove", [{ x: 150, y: 400 + i * 15, id: 1 }, { x: 250, y: 400 + i * 15, id: 2 }]);
    await touch(cdp, "touchEnd", []);
    const v1 = await page.evaluate(() => ({ ...window.__gas!.viewport.view }));
    expect(v1.y - v0.y).toBeGreaterThan(60);
    expect(Math.abs(v1.zoom - v0.zoom)).toBeLessThan(0.02);
    expect(await strokes(page)).toHaveLength(0);
    await ctx.close();
  });

  it("con el lápiz apoyado, los dedos (la palma) se ignoran", async () => {
    const { ctx, page, cdp } = await android();
    await mColor(page, "#000000");
    const a = await toScreen(page, 300, 300);
    await penEvent(page, "pointerdown", a.x, a.y, 0.5);
    for (let i = 1; i <= 8; i++) await penEvent(page, "pointermove", a.x + i * 30, a.y, 0.6);
    // la palma toca mientras el lápiz sigue apoyado
    await finger(page, cdp, line(300, 500, 700, 500, 6));
    const b = await toScreen(page, 560, 300);
    await penEvent(page, "pointerup", b.x, b.y, 0);
    await settle(page);
    const s = await strokes(page);
    expect(s).toHaveLength(1); // solo el del lápiz
    expect(s[0]!.points[1]).toBeCloseTo(300, 0);
    await ctx.close();
  });

  it("«Dibujar con el dedo» desactivado: el dedo mueve el lienzo y el lápiz dibuja", async () => {
    const { ctx, page, cdp } = await android();
    await page.getByTestId("open-brush").tap();
    await page.getByTestId("finger-draws").uncheck();
    await page.getByTestId("open-brush").tap();
    const v0 = await page.evaluate(() => ({ ...window.__gas!.viewport.view }));
    const a = { x: 200, y: 300 };
    await touch(cdp, "touchStart", [{ ...a, id: 0 }]);
    for (let i = 1; i <= 6; i++) await touch(cdp, "touchMove", [{ x: a.x + i * 10, y: a.y + i * 8, id: 0 }]);
    await touch(cdp, "touchEnd", []);
    const v1 = await page.evaluate(() => ({ ...window.__gas!.viewport.view }));
    expect(await strokes(page)).toHaveLength(0);
    expect(v1.x - v0.x).toBeCloseTo(60, 0);
    // el lápiz sí dibuja
    const p = await toScreen(page, 400, 300);
    await penEvent(page, "pointerdown", p.x, p.y, 0.7);
    for (let i = 1; i <= 6; i++) await penEvent(page, "pointermove", p.x + i * 20, p.y, 0.7);
    await penEvent(page, "pointerup", p.x + 120, p.y, 0.7);
    expect(await strokes(page)).toHaveLength(1);
    await ctx.close();
  });

  it("paneles como hoja inferior: se abren, muestran solo su sección y se cierran", async () => {
    const { ctx, page } = await android();
    const side = page.getByTestId("side");
    expect(await side.isVisible()).toBe(false);
    for (const [btn, section] of [["open-brush", "brush"], ["open-color", "color"], ["open-layers", "layers"]] as const) {
      await page.getByTestId(btn).tap();
      expect(await side.isVisible()).toBe(true);
      for (const s of ["brush", "color", "layers"]) {
        expect(await page.locator(`[data-section=${s}]`).isVisible()).toBe(s === section);
      }
      await page.getByTestId(btn).tap();
      expect(await side.isVisible()).toBe(false);
    }
    // Cambiar color y capa desde la hoja, con toques
    await page.getByTestId("open-color").tap();
    await page.locator('[data-testid=swatch][data-color="#2b4aa8"]').tap();
    expect(await page.evaluate(() => window.__gas!.model.prefs.color)).toBe("#2b4aa8");
    await page.getByTestId("open-layers").tap();
    await page.getByTestId("add-layer").tap();
    expect(await page.locator("[data-testid=layer-row]").count()).toBe(3);
    await page.locator(".sheet-close").tap();
    expect(await side.isVisible()).toBe(false);
    await ctx.close();
  });

  it("todos los controles táctiles miden al menos 44 px (y no hay desbordes laterales)", async () => {
    const { ctx, page } = await android();
    const audit = () =>
      page.evaluate(() => {
        const bad: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>("button, select, input:not([type=checkbox]), label.check")) {
          if (el.getClientRects().length === 0) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === "hidden" || cs.display === "none") continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue; // fuera de pantalla (barra desplazable)
          if (r.height < 43.5 || r.width < 43.5) bad.push(`${el.getAttribute("data-testid") ?? el.getAttribute("aria-label") ?? el.className} ${Math.round(r.width)}×${Math.round(r.height)}`);
        }
        return bad;
      });
    expect(await audit()).toEqual([]);
    for (const b of ["open-brush", "open-color", "open-layers"]) {
      await page.getByTestId(b).tap();
      expect(await audit()).toEqual([]);
      await page.getByTestId(b).tap();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    await ctx.close();
  });

  it("en horizontal el lienzo conserva espacio útil para dibujar", async () => {
    const { ctx, page } = await android(true);
    const box = (await page.getByTestId("stage").boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(180);
    expect(box.width).toBeGreaterThanOrEqual(600);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    await ctx.close();
  });
});

describe("capturas de Android", () => {
  async function demo(page: Page, cdp: CDPSession) {
    await mColor(page, "#1d1a26");
    await finger(page, cdp, [[420, 330], [470, 230], [560, 190], [660, 200], [720, 270], [710, 400], [650, 490], [560, 530], [470, 490], [430, 410], [420, 330]]);
    await mColor(page, "#e8323c");
    await finger(page, cdp, [[520, 340], [560, 320], [600, 340]]);
    await finger(page, cdp, [[640, 340], [680, 320], [720, 340]]);
    await page.getByTestId("add-frame").tap();
    await mColor(page, "#1d1a26");
    await finger(page, cdp, [[430, 320], [480, 220], [570, 180], [670, 192], [730, 262], [720, 392], [660, 482], [570, 522], [480, 482], [440, 402], [430, 320]]);
    await page.getByTestId("add-frame").tap();
    await page.getByTestId("prev").tap();
    await waitSaved(page);
    await page.waitForTimeout(300);
  }

  it("vertical", async () => {
    const { ctx, page, cdp } = await android();
    await demo(page, cdp);
    await page.screenshot({ path: join(SHOTS, "11-editor-android-vertical.png") });
    await page.getByTestId("open-layers").tap();
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(SHOTS, "12-editor-android-capas.png") });
    await page.getByTestId("open-layers").tap();
    await page.getByTestId("open-color").tap();
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(SHOTS, "13-editor-android-color.png") });
    await ctx.close();
  });

  it("horizontal", async () => {
    const { ctx, page, cdp } = await android(true);
    await demo(page, cdp);
    await page.screenshot({ path: join(SHOTS, "14-editor-android-horizontal.png") });
    await ctx.close();
  });
});

describe("rendimiento (CPU limitada a 1/4 para imitar un móvil de gama media)", () => {
  it("renderiza y dibuja con cientos de trazos sin bloquear la interfaz", async () => {
    const ep = await createEpisode(env, { width: 1920, height: 1080 });
    const { ctx, page } = await openEditorPage(env, ep.url, { ...PIXEL });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

    const result = await page.evaluate(() => {
      const g = window.__gas!;
      const m = g.model;
      const d = JSON.parse(JSON.stringify(m.doc));
      const strokesLine: unknown[] = [];
      const strokesColor: unknown[] = [];
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 600; i++) {
        const pts: number[] = [];
        let x = rnd() * 1800, y = rnd() * 1000;
        for (let k = 0; k < 60; k++) { x += (rnd() - 0.5) * 30; y += (rnd() - 0.5) * 30; pts.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10, 0.8); }
        (i % 2 ? strokesLine : strokesColor).push({ id: `p${i}`, kind: "pen", color: i % 3 ? "#1d1a26" : "#e8323c", size: 4 + (i % 7), opacity: i % 11 === 0 ? 0.6 : 1, sens: 0.5, points: pts });
      }
      d.frames[0].cells = { [d.layers[0].id]: strokesColor, [d.layers[1].id]: strokesLine };
      m.replaceDoc(d);
      const time = (fn: () => void, n: number) => { const t = performance.now(); for (let i = 0; i < n; i++) fn(); return (performance.now() - t) / n; };
      g.viewport.cache.clear();
      const miss = time(() => g.viewport.render(), 1);
      const hit = time(() => g.viewport.render(), 20);
      return { miss, hit, strokes: strokesLine.length + strokesColor.length };
    });

    // Latencia de un trazo nuevo con la hoja ya cargada: movimientos + confirmación
    const timing = await page.evaluate(async () => {
      const c = document.querySelector("canvas.stage-canvas") as HTMLCanvasElement;
      const r = c.getBoundingClientRect();
      const fire = (t: string, x: number, y: number) => c.dispatchEvent(new PointerEvent(t, { pointerId: 3, pointerType: "pen", isPrimary: true, pressure: 0.6, clientX: x, clientY: y, buttons: t === "pointerup" ? 0 : 1, button: 0, bubbles: true, cancelable: true }));
      const x0 = r.left + 40, y0 = r.top + 120;
      const t0 = performance.now();
      fire("pointerdown", x0, y0);
      const moves: number[] = [];
      for (let i = 1; i <= 60; i++) { const t = performance.now(); fire("pointermove", x0 + i * 4, y0 + Math.sin(i / 5) * 30); moves.push(performance.now() - t); }
      const tu = performance.now();
      fire("pointerup", x0 + 244, y0);
      const commit = performance.now() - tu;
      const frame = await new Promise<number>((res) => { const t = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => res(performance.now() - t))); });
      return { perMove: moves.reduce((a, b) => a + b, 0) / moves.length, worstMove: Math.max(...moves), commit, nextFrame: frame, total: performance.now() - t0 };
    });

    // Fluidez REAL mientras se dibuja y se borra sobre 600 trazos: intervalo medio entre fotogramas
    // (requestAnimationFrame incluye el rasterizado; el tiempo de `render()` solo mide el registro de operaciones).
    const measureFrames = () =>
      page.evaluate(async () => {
        const g = window.__gas!;
        const c = document.querySelector("canvas.stage-canvas") as HTMLCanvasElement;
        const r = c.getBoundingClientRect();
        const fire = (t: string, x: number, y: number, id: number) => c.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: "pen", isPrimary: true, pressure: 0.6, clientX: x, clientY: y, buttons: t === "pointerup" ? 0 : 1, button: 0, bubbles: true, cancelable: true }));
        const run = async (tool: "pen" | "eraser", id: number) => {
          g.model.setTool(tool);
          fire("pointerdown", r.left + 60, r.top + 200, id);
          const t0 = performance.now();
          const N = 40;
          for (let i = 1; i <= N; i++) {
            fire("pointermove", r.left + 60 + i * 6, r.top + 200 + Math.sin(i / 4) * 40, id);
            await new Promise((res) => requestAnimationFrame(() => res(null)));
          }
          const per = (performance.now() - t0) / N;
          fire("pointerup", r.left + 300, r.top + 200, id);
          return per;
        };
        const pen = await run("pen", 5);
        const eraser = await run("eraser", 6);
        g.model.setTool("pen");
        return { pen, eraser };
      });
    const slow = await measureFrames();
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    const normal = await measureFrames();
    const eraser = { penFrameMs: slow.pen, eraserFrameMs: slow.eraser, penFrameMsNormalCpu: normal.pen, eraserFrameMsNormalCpu: normal.eraser };

    const out = { cpuThrottle: 4, ...result, ...timing, ...eraser };
    writeFileSync(join(SHOTS, "perf.json"), JSON.stringify(out, null, 2));
    expect(result.strokes).toBe(600);
    expect(await strokes(page)).toHaveLength(305); // 300 + 1 (latencia) + 2×2 (fluidez: lápiz y borrador, a 1/4 y normal)
    // Márgenes amplios: el objetivo es detectar regresiones graves, no medir un dispositivo concreto
    expect(result.hit).toBeLessThan(33); // redibujado con caché
    expect(timing.perMove).toBeLessThan(8); // un punto nuevo mientras se dibuja
    expect(timing.commit).toBeLessThan(60); // confirmar el trazo
    expect(timing.nextFrame).toBeLessThan(250); // el fotograma siguiente a confirmar (miniatura, guardado…)
    expect(result.miss).toBeLessThan(1800); // peor caso: pintar en frío una capa de 600 trazos
    // Con la CPU normal debe sostener ~60 fps (16,7 ms) sobre una capa de 600 trazos
    expect(eraser.penFrameMsNormalCpu).toBeLessThan(20);
    expect(eraser.eraserFrameMsNormalCpu).toBeLessThan(25);
    // Con la CPU a 1/4: la línea base de un lienzo VACÍO en este navegador sin GPU ya es ~40 ms/fotograma,
    // así que se exige que el contenido pesado no multiplique ese coste por más de ~2.
    expect(eraser.penFrameMs).toBeLessThan(85);
    expect(eraser.eraserFrameMs).toBeLessThan(95);
    await ctx.close();
  });
});
