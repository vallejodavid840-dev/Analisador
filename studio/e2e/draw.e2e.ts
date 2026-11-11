import type { Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SHOTS, createEpisode, docPixel, doc, isRed, isWhite, line, mouseStroke, penEvent, openEditorPage, settle, setColor, startEnv, strokes, toScreen, type Env } from "./helpers";
import { join } from "node:path";

let env: Env;
beforeAll(async () => (env = await startEnv()));
afterAll(() => env.close());

describe("dibujar y borrar (ratón)", () => {
  it("dibuja con color y tamaño elegidos, borra, y deshace/rehace sin perder trazos", async () => {
    const ep = await createEpisode(env);
    const { ctx, page, errors } = await openEditorPage(env, ep.url);

    await setColor(page, "#ff0000");
    await page.getByTestId("brush-size").fill("31"); // ≈ 20 px
    expect((await page.evaluate(() => window.__gas!.model.prefs.pen.size))).toBe(20);
    await mouseStroke(page, line(200, 360, 1000, 360));

    let s = await strokes(page);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ kind: "pen", color: "#ff0000", size: 20, opacity: 1 });
    expect(isRed(await docPixel(page, 600, 360))).toBe(true);
    expect(isRed(await docPixel(page, 600, 366))).toBe(true); // dentro del grosor
    expect(isWhite(await docPixel(page, 600, 400))).toBe(true); // fuera

    // Borrar cruzando la línea
    await page.getByTestId("tool-eraser").click();
    await page.getByTestId("brush-size").fill("40"); // tamaño del borrador
    await mouseStroke(page, line(600, 250, 600, 470));
    s = await strokes(page);
    expect(s.map((x) => x.kind)).toEqual(["pen", "eraser"]);
    expect(isWhite(await docPixel(page, 600, 360))).toBe(true); // borrado
    expect(isRed(await docPixel(page, 400, 360))).toBe(true); // el resto sigue
    expect(isRed(await docPixel(page, 800, 360))).toBe(true);

    // Deshacer el borrado → vuelve el rojo; deshacer el trazo → lienzo en blanco; rehacer ×2 → idéntico
    const afterErase = await doc(page);
    await page.getByTestId("undo").click();
    await settle(page);
    expect(isRed(await docPixel(page, 600, 360))).toBe(true);
    await page.keyboard.press("Control+z");
    await settle(page);
    expect(isWhite(await docPixel(page, 600, 360))).toBe(true);
    expect(await strokes(page)).toHaveLength(0);
    expect(await page.getByTestId("undo").isDisabled()).toBe(true);
    await page.getByTestId("redo").click();
    await page.keyboard.press("Control+Shift+z");
    await settle(page);
    expect(await doc(page)).toEqual(afterErase);
    expect(isWhite(await docPixel(page, 600, 360))).toBe(true);
    expect(await page.getByTestId("redo").isDisabled()).toBe(true);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it("la opacidad se aplica y un trazo que se cruza a sí mismo no se oscurece", async () => {
    const ep = await createEpisode(env);
    const { ctx, page } = await openEditorPage(env, ep.url);
    await setColor(page, "#000000");
    await page.getByTestId("brush-opacity").fill("50");
    await page.getByTestId("brush-size").fill("31");
    // cruz de un solo trazo
    await mouseStroke(page, [...line(300, 300, 700, 300, 8), ...line(700, 300, 500, 150, 4), ...line(500, 150, 500, 450, 8)]);
    const s = await strokes(page);
    expect(s[0]!.opacity).toBe(0.5);
    const a = await docPixel(page, 400, 300); // solo un tramo
    const cross = await docPixel(page, 500, 300); // cruce del mismo trazo
    expect(a[0]).toBeGreaterThan(110);
    expect(a[0]).toBeLessThan(145); // ≈ 50 % gris sobre blanco
    expect(Math.abs(cross[0] - a[0])).toBeLessThanOrEqual(3);
    await ctx.close();
  });

  it("recuerda colores recientes y la paleta cambia el color", async () => {
    const ep = await createEpisode(env);
    const { ctx, page } = await openEditorPage(env, ep.url);
    await page.locator('[data-testid=swatch][data-color="#e8323c"]').click();
    expect(await page.evaluate(() => window.__gas!.model.prefs.color)).toBe("#e8323c");
    await mouseStroke(page, line(100, 100, 300, 100));
    await page.locator('[data-testid=swatch][data-color="#2b4aa8"]').click();
    await mouseStroke(page, line(100, 200, 300, 200));
    expect(await page.evaluate(() => window.__gas!.model.prefs.recent.slice(0, 2))).toEqual(["#2b4aa8", "#e8323c"]);
    await ctx.close();
  });
});

describe("lápiz con presión", () => {
  it("registra la presión por punto y el ancho varía con ella", async () => {
    const ep = await createEpisode(env);
    const { ctx, page } = await openEditorPage(env, ep.url);
    await setColor(page, "#000000");
    await page.getByTestId("brush-size").fill("40"); // ≈ 33 px
    await page.getByTestId("brush-sens").fill("100");
    const a = await toScreen(page, 200, 360);
    const b = await toScreen(page, 1000, 360);
    await penEvent(page, "pointerdown", a.x, a.y, 0.1);
    for (let i = 1; i <= 30; i++) await penEvent(page, "pointermove", a.x + ((b.x - a.x) * i) / 30, a.y, 0.1 + (0.9 * i) / 30);
    await penEvent(page, "pointerup", b.x, b.y, 1);
    await settle(page);

    const [stroke] = await strokes(page);
    const pressures = stroke!.points.filter((_, i) => i % 3 === 2);
    expect(Math.min(...pressures)).toBeLessThan(0.3);
    expect(Math.max(...pressures)).toBeGreaterThan(0.85);
    expect(stroke!.sens).toBe(1);
    // Ancho visible: fino al principio, grueso al final
    const thickness = async (wx: number) => {
      let n = 0;
      for (let y = 300; y <= 420; y++) if ((await docPixel(page, wx, y))[0] < 128) n++;
      return n;
    };
    const thin = await thickness(260);
    const thick = await thickness(940);
    expect(thick).toBeGreaterThan(thin * 2);
    await ctx.close();
  });
});

describe("zoom y desplazamiento", () => {
  it("rueda = zoom hacia el cursor, botones, 100 %, ajustar y mano", async () => {
    const ep = await createEpisode(env);
    const { ctx, page } = await openEditorPage(env, ep.url);
    const view = () => page.evaluate(() => ({ ...window.__gas!.viewport.view }));
    const fit = await view();

    const c = await toScreen(page, 640, 360);
    await page.mouse.move(c.x, c.y);
    await page.mouse.wheel(0, -300);
    await settle(page);
    const z1 = await view();
    expect(z1.zoom).toBeGreaterThan(fit.zoom);
    const after = await toScreen(page, 640, 360);
    expect(Math.abs(after.x - c.x)).toBeLessThan(2); // el punto bajo el cursor no se mueve
    expect(Math.abs(after.y - c.y)).toBeLessThan(2);

    await page.getByTestId("zoom-out").click();
    expect((await view()).zoom).toBeLessThan(z1.zoom);
    await page.getByTestId("zoom-pct").click();
    expect((await view()).zoom).toBeCloseTo(1, 2);
    expect(await page.getByTestId("zoom-pct").textContent()).toBe("100 %");

    // Mano: arrastrar mueve la vista
    await page.getByTestId("tool-hand").click();
    const v0 = await view();
    const box = (await page.getByTestId("stage").boundingBox())!;
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 380, box.y + 340, { steps: 4 });
    await page.mouse.up();
    const v1 = await view();
    expect(v1.x - v0.x).toBeCloseTo(80, 0);
    expect(v1.y - v0.y).toBeCloseTo(40, 0);
    expect(await strokes(page)).toHaveLength(0); // la mano no dibuja

    await page.getByTestId("zoom-fit").click();
    expect((await view()).zoom).toBeCloseTo(fit.zoom, 3);
    await ctx.close();
  });

  it("dibujar con zoom y desplazamiento coloca el trazo en las coordenadas correctas", async () => {
    const ep = await createEpisode(env);
    const { ctx, page } = await openEditorPage(env, ep.url);
    await page.getByTestId("zoom-in").click();
    await page.getByTestId("zoom-in").click();
    await page.getByTestId("tool-hand").click();
    const box = (await page.getByTestId("stage").boundingBox())!;
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 160, box.y + 70, { steps: 3 });
    await page.mouse.up();
    await page.getByTestId("tool-pen").click();
    await setColor(page, "#ff0000");
    await mouseStroke(page, line(560, 330, 720, 330));
    const [s] = await strokes(page);
    expect(s!.points[0]).toBeCloseTo(560, 0);
    expect(s!.points[1]).toBeCloseTo(330, 0);
    expect(isRed(await docPixel(page, 640, 330))).toBe(true);
    await ctx.close();
  });
});

describe("selección, movimiento y transformación", () => {
  async function twoStrokes(page: Page) {
    await setColor(page, "#e8323c");
    await mouseStroke(page, line(300, 200, 500, 200));
    await mouseStroke(page, line(300, 300, 500, 300));
    await page.getByTestId("tool-select").click();
  }
  const pts = async (page: Page) => (await strokes(page)).map((s) => s.points.slice(0, 2));
  const drag = async (page: Page, from: [number, number], to: [number, number]) => {
    const a = await toScreen(page, ...from);
    const b = await toScreen(page, ...to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
    await settle(page);
  };

  it("clic selecciona un trazo y arrastrarlo lo mueve con UNA sola entrada de historial", async () => {
    const ep = await createEpisode(env);
    const { ctx, page } = await openEditorPage(env, ep.url);
    await twoStrokes(page);
    await drag(page, [400, 200], [450, 260]);
    const moved = await pts(page);
    expect(moved[0]).toEqual([350, 260]);
    expect(moved[1]).toEqual([300, 300]); // el otro no se toca
    expect(await page.getByTestId("sel-count").textContent()).toBe("1 trazo seleccionado");
    await page.keyboard.press("Control+z"); // un solo deshacer revierte todo el arrastre
    expect((await pts(page))[0]).toEqual([300, 200]);
    await page.keyboard.press("Control+Shift+z");
    expect((await pts(page))[0]).toEqual([350, 260]);
    await ctx.close();
  });

  it("selección por recuadro, escalar con tirador, rotar, voltear, duplicar y eliminar", async () => {
    const ep = await createEpisode(env);
    const { ctx, page } = await openEditorPage(env, ep.url);
    await twoStrokes(page);
    await drag(page, [200, 120], [620, 380]); // recuadro: ambos
    expect(await page.getByTestId("sel-count").textContent()).toBe("2 trazos seleccionados");

    // Escalar: tirador sureste, hacia fuera → escala uniforme > 1
    const bounds = await page.evaluate(() => window.__gas!.model.selectionBounds()!);
    const before = (await strokes(page))[0]!.size;
    await drag(page, [bounds.x + bounds.w, bounds.y + bounds.h], [bounds.x + bounds.w + 120, bounds.y + bounds.h + 60]);
    const after = await strokes(page);
    expect(after[0]!.size).toBeGreaterThan(before);
    const nb = await page.evaluate(() => window.__gas!.model.selectionBounds()!);
    expect(nb.w).toBeGreaterThan(bounds.w);
    expect(nb.x).toBeCloseTo(bounds.x, 0); // el ancla (noroeste) no se mueve

    // Rotar con el tirador superior
    const preRot = await pts(page);
    const rb = await page.evaluate(() => window.__gas!.model.selectionBounds()!);
    const zoom = await page.evaluate(() => window.__gas!.viewport.view.zoom);
    await drag(page, [rb.x + rb.w / 2, rb.y - 34 / zoom], [rb.x + rb.w + 100, rb.y + rb.h / 2]);
    expect(await pts(page)).not.toEqual(preRot);

    // Voltear horizontalmente: el centro de la caja no cambia
    const c0 = await page.evaluate(() => { const b = window.__gas!.model.selectionBounds()!; return [b.x + b.w / 2, b.y + b.h / 2]; });
    await page.getByTestId("sel-flip").click();
    const c1 = await page.evaluate(() => { const b = window.__gas!.model.selectionBounds()!; return [b.x + b.w / 2, b.y + b.h / 2]; });
    expect(c1[0]).toBeCloseTo(c0![0]!, 0);
    expect(c1[1]).toBeCloseTo(c0![1]!, 0);

    // Duplicar → 4 trazos, seleccionados los nuevos; eliminar → 2
    await page.getByTestId("sel-dup").click();
    expect(await strokes(page)).toHaveLength(4);
    expect(await page.evaluate(() => window.__gas!.model.selection.size)).toBe(2);
    await page.getByTestId("sel-del").click();
    expect(await strokes(page)).toHaveLength(2);
    await page.keyboard.press("Control+z"); // deshacer eliminar
    expect(await strokes(page)).toHaveLength(4);
    await ctx.close();
  });

  it("no se pueden transformar trazos de una capa bloqueada", async () => {
    const ep = await createEpisode(env);
    const { ctx, page } = await openEditorPage(env, ep.url);
    await twoStrokes(page);
    await page.locator('[data-testid=layer-row].active [data-testid=layer-lock]').click();
    const before = await pts(page);
    await drag(page, [400, 200], [450, 260]);
    expect(await pts(page)).toEqual(before);
    expect(await page.getByTestId("toast").textContent()).toContain("bloqueada");
    await ctx.close();
  });
});

it("captura de la interfaz de escritorio", async () => {
  const ep = await createEpisode(env, { name: "Calle Roja", width: 1920, height: 1080 });
  const { ctx, page } = await openEditorPage(env, ep.url, { viewport: { width: 1440, height: 860 }, deviceScaleFactor: 2 });
  await setColor(page, "#1d1a26");
  await page.getByTestId("brush-size").fill("22");
  await mouseStroke(page, [[420, 300], [470, 220], [560, 180], [650, 190], [700, 260], [690, 380], [640, 470], [560, 520], [480, 480], [430, 400], [420, 300]]);
  await setColor(page, "#e8323c");
  await mouseStroke(page, [[520, 320], [560, 300], [600, 320]]);
  await mouseStroke(page, [[620, 320], [660, 300], [700, 320]]);
  await page.getByTestId("brush-size").fill("14");
  await setColor(page, "#111111");
  await mouseStroke(page, [[540, 430], [580, 450], [630, 440]]);
  await page.getByTestId("add-frame").click();
  await setColor(page, "#1d1a26");
  await mouseStroke(page, [[430, 290], [478, 214], [562, 176], [652, 188], [702, 252], [694, 372], [648, 462], [566, 512], [488, 474], [440, 396], [430, 290]]);
  await page.getByTestId("add-frame").click();
  await page.getByTestId("prev").click();
  await settle(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, "10-editor-escritorio.png") });
  await ctx.close();
  expect(true).toBe(true);
});
void isRed;
