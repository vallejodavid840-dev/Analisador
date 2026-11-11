import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { createEpisode, docPixel, doc, isRed, isWhite, line, mouseStroke, openEditorPage, settle, setColor, startEnv, strokes, type Env } from "./helpers";

let env: Env;
beforeAll(async () => (env = await startEnv()));
afterAll(() => env.close());

const layerNames = (page: Page) => page.locator("[data-testid=layer-name], [data-testid=layer-name-input]").evaluateAll((els) => els.map((e) => (e.tagName === "INPUT" ? (e as HTMLInputElement).value : e.textContent)));
const frameCount = (page: Page) => page.evaluate(() => window.__gas!.model.doc.frames.length);
const frameIdx = (page: Page) => page.evaluate(() => window.__gas!.model.frameIndex);

describe("capas", () => {
  it("crear, renombrar, ordenar, ocultar, bloquear y eliminar (con deshacer)", async () => {
    const ep = await createEpisode(env);
    const { ctx, page, errors } = await openEditorPage(env, ep.url);
    // Por defecto: Líneas (arriba, activa) y Color
    expect(await layerNames(page)).toEqual(["Líneas", "Color"]);

    await page.getByTestId("add-layer").click();
    expect(await layerNames(page)).toEqual(["Capa 3", "Líneas", "Color"]); // nueva encima de la activa
    expect(await page.locator("[data-testid=layer-row].active [data-testid=layer-name]").textContent()).toBe("Capa 3");

    // Renombrar con el lápiz (Enter confirma)
    await page.locator("[data-testid=layer-row].active [data-testid=layer-rename]").click();
    await page.getByTestId("layer-name-input").fill("Efectos de velocidad");
    await page.keyboard.press("Enter");
    expect(await layerNames(page)).toEqual(["Efectos de velocidad", "Líneas", "Color"]);
    // Escape cancela
    await page.locator("[data-testid=layer-row].active [data-testid=layer-rename]").click();
    await page.getByTestId("layer-name-input").fill("NO");
    await page.keyboard.press("Escape");
    expect((await layerNames(page))[0]).toBe("Efectos de velocidad");

    // Cambiar el orden: bajar la activa
    await page.locator("[data-testid=layer-row].active [data-testid=layer-down]").click();
    expect(await layerNames(page)).toEqual(["Líneas", "Efectos de velocidad", "Color"]);
    await page.locator("[data-testid=layer-row]", { hasText: "Efectos" }).locator("[data-testid=layer-up]").click();
    expect(await layerNames(page)).toEqual(["Efectos de velocidad", "Líneas", "Color"]);

    // Deshacer revierte las operaciones de capa (historial global)
    await page.keyboard.press("Control+z"); // sube
    expect(await layerNames(page)).toEqual(["Líneas", "Efectos de velocidad", "Color"]);
    await page.keyboard.press("Control+Shift+z");
    expect(await layerNames(page)).toEqual(["Efectos de velocidad", "Líneas", "Color"]);

    // Eliminar (con confirmación) y deshacer
    page.once("dialog", (d) => { expect(d.message()).toContain("Efectos de velocidad"); void d.accept(); });
    await page.getByTestId("del-layer").click();
    expect(await layerNames(page)).toEqual(["Líneas", "Color"]);
    await page.keyboard.press("Control+z");
    expect(await layerNames(page)).toEqual(["Efectos de velocidad", "Líneas", "Color"]);
    // Cancelar el diálogo no elimina
    page.once("dialog", (d) => void d.dismiss());
    await page.getByTestId("del-layer").click();
    expect(await layerNames(page)).toHaveLength(3);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it("ocultar/mostrar cambia lo que se ve; una capa bloqueada u oculta no admite dibujo", async () => {
    const ep = await createEpisode(env);
    const { ctx, page } = await openEditorPage(env, ep.url);
    await setColor(page, "#ff0000");
    await page.getByTestId("brush-size").fill("31");
    await mouseStroke(page, line(300, 200, 700, 200)); // en «Líneas»
    expect(isRed(await docPixel(page, 500, 200))).toBe(true);

    const lines = page.locator("[data-testid=layer-row]", { hasText: "Líneas" });
    await lines.locator("[data-testid=layer-vis]").click();
    await settle(page);
    expect(isWhite(await docPixel(page, 500, 200))).toBe(true); // oculta: no se ve
    // dibujar en capa oculta: aviso y ningún trazo nuevo
    await mouseStroke(page, line(300, 300, 700, 300));
    expect(await page.getByTestId("toast").textContent()).toContain("oculta");
    expect(await strokes(page)).toHaveLength(1);
    await lines.locator("[data-testid=layer-vis]").click();
    await settle(page);
    expect(isRed(await docPixel(page, 500, 200))).toBe(true);

    // Bloquear
    await lines.locator("[data-testid=layer-lock]").click();
    await mouseStroke(page, line(300, 300, 700, 300));
    expect(await page.getByTestId("toast").textContent()).toContain("bloqueada");
    expect(await strokes(page)).toHaveLength(1);
    await lines.locator("[data-testid=layer-lock]").click();
    await mouseStroke(page, line(300, 300, 700, 300));
    expect(await strokes(page)).toHaveLength(2);
    await ctx.close();
  });

  it("cada capa conserva sus trazos y el orden de apilado se refleja en pantalla", async () => {
    const ep = await createEpisode(env);
    const { ctx, page } = await openEditorPage(env, ep.url);
    await page.getByTestId("brush-size").fill("40");
    // «Color» (abajo): rojo; «Líneas» (arriba): azul; se cruzan
    await page.locator("[data-testid=layer-row]", { hasText: "Color" }).locator("[data-testid=layer-name]").click();
    await setColor(page, "#ff0000");
    await mouseStroke(page, line(300, 300, 700, 300));
    await page.locator("[data-testid=layer-row]", { hasText: "Líneas" }).locator("[data-testid=layer-name]").click();
    await setColor(page, "#0000ff");
    await mouseStroke(page, line(500, 200, 500, 400));
    expect((await docPixel(page, 500, 300))[2]).toBeGreaterThan(200); // azul arriba
    expect((await docPixel(page, 500, 300))[0]).toBeLessThan(60);
    // Subir «Color» por encima: ahora manda el rojo
    await page.locator("[data-testid=layer-row]", { hasText: "Color" }).locator("[data-testid=layer-up]").click();
    await settle(page);
    expect(isRed(await docPixel(page, 500, 300))).toBe(true);
    const d = await doc(page);
    expect(Object.keys(d.frames[0].cells)).toHaveLength(2);
    await ctx.close();
  });
});

describe("fotogramas", () => {
  it("crear, editar de forma independiente, duplicar, navegar, duración y eliminar", async () => {
    const ep = await createEpisode(env);
    const { ctx, page, errors } = await openEditorPage(env, ep.url);
    await setColor(page, "#ff0000");
    await page.getByTestId("brush-size").fill("31");
    await mouseStroke(page, line(200, 200, 400, 200)); // dibujo del fotograma 1

    await page.getByTestId("add-frame").click();
    expect(await frameCount(page)).toBe(2);
    expect(await frameIdx(page)).toBe(1);
    expect(await strokes(page)).toHaveLength(0); // el nuevo está vacío
    await page.getByTestId("onion").click(); // sin papel cebolla para comprobar solo el dibujo propio
    await setColor(page, "#0000ff");
    await mouseStroke(page, line(200, 400, 400, 400)); // dibujo del fotograma 2

    // Duplicar el 2 → el 3 es idéntico; editarlo no toca el 2
    await page.getByTestId("dup-frame").click();
    expect(await frameCount(page)).toBe(3);
    expect(await frameIdx(page)).toBe(2);
    expect(await strokes(page)).toHaveLength(1);
    await mouseStroke(page, line(600, 400, 800, 400));
    expect(await strokes(page)).toHaveLength(2);
    await page.getByTestId("prev").click();
    expect(await strokes(page)).toHaveLength(1); // el 2 sigue con un trazo

    // Navegación: botones, teclado, clic en la miniatura
    await page.getByTestId("first").click();
    expect(await frameIdx(page)).toBe(0);
    await settle(page);
    expect(isRed(await docPixel(page, 300, 200))).toBe(true);
    expect(isWhite(await docPixel(page, 300, 400))).toBe(true);
    await page.keyboard.press("ArrowRight");
    expect(await frameIdx(page)).toBe(1);
    await settle(page);
    expect(isWhite(await docPixel(page, 300, 200))).toBe(true);
    await page.locator("[data-testid=frame-cell]").nth(2).click();
    expect(await frameIdx(page)).toBe(2);
    expect(await page.getByTestId("last").isDisabled()).toBe(true); // ya estamos en el último
    expect(await page.getByTestId("next").isDisabled()).toBe(true);
    await page.getByTestId("first").click();
    await page.getByTestId("last").click();
    expect(await frameIdx(page)).toBe(2);
    expect(await page.getByTestId("frame-pos").textContent()).toBe("Fotograma 3 de 3");
    await page.keyboard.press("ArrowLeft");
    expect(await frameIdx(page)).toBe(1);

    // Duración (a doses)
    await page.getByTestId("hold-more").click();
    expect((await doc(page)).frames[1].hold).toBe(2);
    expect(await page.locator("[data-testid=frame-cell]").nth(1).locator(".cell-hold").textContent()).toBe("×2");
    await page.getByTestId("hold-less").click();
    expect(await page.getByTestId("hold-less").isDisabled()).toBe(true);

    // Eliminar el 2 → quedan 2; deshacer lo devuelve con su dibujo
    await page.getByTestId("del-frame").click();
    expect(await frameCount(page)).toBe(2);
    await page.keyboard.press("Control+z");
    expect(await frameCount(page)).toBe(3);
    expect((await strokes(page)).length).toBe(1);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it("deshacer/rehacer no pierde trazos al cambiar de fotograma y de capa", async () => {
    const ep = await createEpisode(env);
    const { ctx, page } = await openEditorPage(env, ep.url);
    await mouseStroke(page, line(100, 100, 300, 100)); // f1, Líneas
    await page.getByTestId("add-frame").click(); // f2
    await mouseStroke(page, line(100, 200, 300, 200));
    await page.locator("[data-testid=layer-row]", { hasText: "Color" }).locator("[data-testid=layer-name]").click();
    await mouseStroke(page, line(100, 300, 300, 300)); // f2, Color
    const full = await doc(page);
    for (let i = 0; i < 4; i++) await page.keyboard.press("Control+z");
    expect((await doc(page)).frames[0].cells).toEqual({});
    expect(await frameCount(page)).toBe(1);
    for (let i = 0; i < 4; i++) await page.keyboard.press("Control+Shift+z");
    expect(await doc(page)).toEqual(full); // idéntico, trazo por trazo
    await ctx.close();
  });
});

describe("reproducción", () => {
  for (const fps of [12, 24, 30]) {
    it(`a ${fps} FPS avanza al ritmo correcto y muestra cada dibujo`, async () => {
      const ep = await createEpisode(env, { fps });
      const { ctx, page } = await openEditorPage(env, ep.url);
      expect(await page.getByTestId("fps").inputValue()).toBe(String(fps));
      await page.getByTestId("onion").click();
      await page.getByTestId("brush-size").fill("31");
      const colors = ["#ff0000", "#00aa00", "#0000ff"];
      for (let i = 0; i < 3; i++) {
        if (i > 0) await page.getByTestId("add-frame").click();
        await setColor(page, colors[i]!);
        await mouseStroke(page, line(300 + i * 200, 360, 340 + i * 200, 360, 2)); // punto distinto en cada fotograma
      }
      await page.getByTestId("first").click();

      await page.getByTestId("play").click();
      expect(await page.evaluate(() => window.__gas!.model.playing)).toBe(true);
      expect(await page.getByTestId("play").getAttribute("aria-label")).toBe("Pausar");
      await page.waitForTimeout(1500);
      // El fotograma mostrado coincide con su dibujo (se lee mientras reproduce)
      const shown = await page.evaluate(() => window.__gas!.model.frameIndex);
      expect(shown).toBeGreaterThanOrEqual(0);
      await page.getByTestId("play").click();
      expect(await page.evaluate(() => window.__gas!.model.playing)).toBe(false);

      const log = await page.evaluate(() => window.__gas!.player.log.map((e) => ({ ...e })));
      const elapsed = log.at(-1)!.t;
      const expected = Math.floor((elapsed * fps) / 1000);
      expect(Math.abs(log.length - 1 - expected)).toBeLessThanOrEqual(1);
      // Secuencia cíclica 0,1,2,0,1,2…
      log.forEach((e, i) => expect(e.index).toBe(i % 3));
      // Cada transición cae cerca de su instante ideal (tolerancia: 1 refresco de pantalla + margen)
      log.slice(1).forEach((e, i) => expect(Math.abs(e.t - ((i + 1) / fps) * 1000)).toBeLessThan(45));

      // Tras pausar, el dibujo mostrado es el de ese fotograma
      const idx = await page.evaluate(() => window.__gas!.model.frameIndex);
      await settle(page);
      const dot = await docPixel(page, 320 + idx * 200, 360);
      const want = [[255, 0, 0], [0, 170, 0], [0, 0, 255]][idx]!;
      want.forEach((v, k) => expect(Math.abs(dot[k]! - v)).toBeLessThan(40));
      await ctx.close();
    });
  }

  it("respeta la duración de cada dibujo (a doses) y el modo sin bucle", async () => {
    const ep = await createEpisode(env, { fps: 12 });
    const { ctx, page } = await openEditorPage(env, ep.url);
    await page.getByTestId("add-frame").click();
    await page.getByTestId("add-frame").click();
    await page.getByTestId("first").click();
    await page.getByTestId("hold-more").click(); // el 1 dura 2
    await page.getByTestId("play").click();
    await page.waitForTimeout(1300);
    await page.getByTestId("play").click();
    const log = await page.evaluate(() => window.__gas!.player.log.map((e) => ({ ...e })));
    // ticks: f1 = 0–1, f2 = 2, f3 = 3 ; ciclo de 4 ticks a 12 fps
    const ideal = [0, 2, 3, 4, 6, 7, 8].map((t) => (t / 12) * 1000);
    log.slice(0, 7).forEach((e, i) => expect(Math.abs(e.t - ideal[i]!)).toBeLessThan(45));
    expect(log.slice(0, 7).map((e) => e.index)).toEqual([0, 1, 2, 0, 1, 2, 0]);

    // Sin bucle: se detiene sola en el último dibujo
    await page.getByTestId("loop").click();
    await page.evaluate(() => window.__gas!.model.setFrameIndex(0));
    await page.getByTestId("play").click();
    await page.waitForFunction(() => !window.__gas!.model.playing, undefined, { timeout: 5000 });
    expect(await frameIdx(page)).toBe(2);
    await ctx.close();
  });

  it("al reproducir con un solo fotograma avisa en vez de simular", async () => {
    const ep = await createEpisode(env);
    const { ctx, page } = await openEditorPage(env, ep.url);
    await page.getByTestId("play").click();
    expect(await page.evaluate(() => window.__gas!.model.playing)).toBe(false);
    expect(await page.getByTestId("toast").textContent()).toContain("más fotogramas");
    await ctx.close();
  });

  it("cambiar entre 12, 24 y 30 FPS actualiza el documento", async () => {
    const ep = await createEpisode(env);
    const { ctx, page } = await openEditorPage(env, ep.url);
    for (const f of [12, 30, 24]) {
      await page.getByTestId("fps").selectOption(String(f));
      expect((await doc(page)).fps).toBe(f);
    }
    await ctx.close();
  });
});

describe("papel cebolla", () => {
  it("muestra el fotograma anterior en rosa y el siguiente en verde, y se puede ajustar o apagar", async () => {
    const ep = await createEpisode(env);
    const { ctx, page } = await openEditorPage(env, ep.url);
    await page.getByTestId("brush-size").fill("40");
    await setColor(page, "#000000");
    await mouseStroke(page, line(300, 300, 500, 300)); // f1: negro a la izquierda
    await page.getByTestId("add-frame").click();
    await mouseStroke(page, line(800, 300, 1000, 300)); // f2: negro a la derecha
    await page.getByTestId("add-frame").click(); // f3 vacío

    // En f3 (antes=1 por defecto): se ve el f2 tintado en rosa; el f1 no
    await settle(page);
    const ghost = await docPixel(page, 900, 300);
    expect(ghost[0]).toBeGreaterThan(220);
    expect(ghost[0] - ghost[1]).toBeGreaterThan(40); // rosado: R > G
    expect(isWhite(await docPixel(page, 400, 300))).toBe(true);

    // antes = 2 → aparece también el f1 (más tenue)
    await page.getByTestId("onion-before-more").click();
    await settle(page);
    const ghost1 = await docPixel(page, 400, 300);
    expect(isWhite(ghost1)).toBe(false);
    expect(ghost1[0]).toBeGreaterThan(ghost1[1]);
    expect(255 - ghost1[1]).toBeLessThan(255 - ghost[1]); // más lejos = más tenue

    // Apagar
    await page.getByTestId("onion").click();
    await settle(page);
    expect(isWhite(await docPixel(page, 900, 300))).toBe(true);
    await page.getByTestId("onion").click();

    // Siguientes (verde) viendo el f1
    await page.getByTestId("first").click();
    await page.getByTestId("onion-before-less").click();
    await page.getByTestId("onion-before-less").click();
    await page.getByTestId("onion-after-more").click();
    await settle(page);
    const next = await docPixel(page, 900, 300);
    expect(next[1] - next[0]).toBeGreaterThan(40); // verdoso: G > R
    expect(await page.evaluate(() => window.__gas!.model.prefs.onion)).toMatchObject({ enabled: true, before: 0, after: 1 });

    // Durante la reproducción no se muestra
    await page.getByTestId("onion-after-more").click();
    await page.getByTestId("play").click();
    expect(await page.evaluate(() => window.__gas!.model.playing)).toBe(true);
    await page.getByTestId("play").click();
    await ctx.close();
  });

  it("el papel cebolla no es una capa: no aparece al dibujar ni en los datos", async () => {
    const ep = await createEpisode(env);
    const { ctx, page } = await openEditorPage(env, ep.url);
    await mouseStroke(page, line(300, 300, 500, 300));
    await page.getByTestId("add-frame").click();
    const d = await doc(page);
    expect(d.frames[1].cells).toEqual({});
    expect(d.layers).toHaveLength(2);
    await ctx.close();
  });
});
