import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildApp } from "../apps/server/src/app";
import type { Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEpisode, docPixel, doc, isRed, line, mouseStroke, openEditorPage, openPage, projectJson, serverAnimation, settle, setColor, startEnv, strokes, toScreen, waitSaved, type Env } from "./helpers";

let env: Env;
beforeAll(async () => (env = await startEnv()));
afterAll(() => env.close());

const canvasHash = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector("canvas.stage-canvas") as HTMLCanvasElement;
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let h = 2166136261;
    for (let i = 0; i < d.length; i += 4) h = Math.imul(h ^ (d[i]! | (d[i + 1]! << 8) | (d[i + 2]! << 16)), 16777619) >>> 0;
    return h;
  });

describe("guardado automático y recuperación", () => {
  it("guarda solo, sin tocar project.json (compatibilidad Fase 0), y el dibujo sobrevive a recargar", async () => {
    const ep = await createEpisode(env, { fps: 12 });
    const before = await projectJson(env, ep.projectId);
    const { ctx, page, errors } = await openEditorPage(env, ep.url);
    expect(await page.getByTestId("fps").inputValue()).toBe("12"); // hereda el FPS del proyecto

    await setColor(page, "#ff0000");
    await page.getByTestId("brush-size").fill("31");
    await mouseStroke(page, line(300, 300, 700, 300));
    expect(await page.getByTestId("save-status").getAttribute("data-status")).toBe("dirty");
    await waitSaved(page);
    expect(await page.getByTestId("save-status").textContent()).toBe("Guardado");

    const onDisk = await serverAnimation(env, ep.projectId, ep.episodeId);
    expect(onDisk.revision).toBe(1);
    expect(Object.values(onDisk.frames[0]!.cells)[0]).toHaveLength(1);
    expect(await projectJson(env, ep.projectId)).toBe(before); // el proyecto no se tocó

    const hash = await canvasHash(page);
    await page.reload();
    await page.getByTestId("stage").waitFor();
    await settle(page);
    expect(await strokes(page)).toHaveLength(1);
    expect(isRed(await docPixel(page, 500, 300))).toBe(true);
    expect(await canvasHash(page)).toBe(hash); // píxel a píxel idéntico
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it("estructura completa (capas, fotogramas, duraciones, FPS, borrador, opacidad) idéntica tras cerrar y reabrir", async () => {
    const ep = await createEpisode(env);
    const { ctx, page } = await openEditorPage(env, ep.url);
    await page.getByTestId("brush-size").fill("31");
    await page.getByTestId("add-layer").click();
    await page.locator("[data-testid=layer-row].active [data-testid=layer-rename]").click();
    await page.getByTestId("layer-name-input").fill("Humo");
    await page.keyboard.press("Enter");
    await page.getByTestId("brush-opacity").fill("60");
    await setColor(page, "#35a7ff");
    await mouseStroke(page, line(200, 200, 600, 260));
    await page.getByTestId("tool-eraser").click();
    await mouseStroke(page, line(400, 150, 400, 330));
    await page.getByTestId("tool-pen").click();
    await page.getByTestId("add-frame").click();
    await mouseStroke(page, line(200, 400, 600, 400));
    await page.getByTestId("hold-more").click();
    await page.getByTestId("add-frame").click();
    await page.getByTestId("dup-frame").click();
    await page.getByTestId("fps").selectOption("30");
    await page.locator("[data-testid=layer-row]", { hasText: "Color" }).locator("[data-testid=layer-vis]").click();
    await page.locator("[data-testid=layer-row]", { hasText: "Líneas" }).locator("[data-testid=layer-lock]").click();
    await waitSaved(page);
    const saved = await doc(page);
    const hashOf = async () => { await page.getByTestId("first").click().catch(() => undefined); await settle(page); return canvasHash(page); };
    const h0 = await hashOf();
    await ctx.close();

    // «Cerrar y volver a abrir»: contexto nuevo (sin localStorage ni IndexedDB)
    const again = await openEditorPage(env, ep.url);
    const reopened = await doc(again.page);
    expect({ ...reopened, revision: 0 }).toEqual({ ...saved, revision: 0 });
    expect(reopened.fps).toBe(30);
    expect(reopened.frames).toHaveLength(4);
    expect(reopened.frames[1].hold).toBe(2);
    expect(reopened.layers.map((l: { name: string }) => l.name)).toEqual(["Color", "Líneas", "Humo"]);
    expect(reopened.layers.map((l: { visible: boolean }) => l.visible)).toEqual([false, true, true]);
    expect(reopened.layers.map((l: { locked: boolean }) => l.locked)).toEqual([false, true, false]);
    await again.page.getByTestId("first").click().catch(() => undefined);
    await settle(again.page);
    expect(await canvasHash(again.page)).toBe(h0);
    await again.ctx.close();
  });

  it("no guarda a mitad de un trazo ni de un arrastre; guarda al terminar", async () => {
    const ep = await createEpisode(env);
    const { ctx, page } = await openEditorPage(env, ep.url);
    await mouseStroke(page, line(300, 200, 500, 200));
    await waitSaved(page);
    const rev1 = (await serverAnimation(env, ep.projectId, ep.episodeId)).revision;

    // Arrastre de selección sostenido más que el tiempo de guardado
    await page.getByTestId("tool-select").click();
    const a = await toScreen(page, 400, 200);
    const b = await toScreen(page, 500, 320);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.waitForTimeout(2600); // > 1,2 s de espera del autoguardado
    const mid = await serverAnimation(env, ep.projectId, ep.episodeId);
    expect(mid.revision).toBe(rev1); // no se guardó el estado intermedio
    await page.mouse.up();
    await waitSaved(page);
    const end = await serverAnimation(env, ep.projectId, ep.episodeId);
    expect(end.revision).toBe(rev1 + 1);
    const moved = Object.values(end.frames[0]!.cells)[0]![0]!;
    expect(moved.points[1]).toBeCloseTo(320, 0); // y: 200 → 320 (se movió 120)
    await ctx.close();
  });

  it("servidor caído al cerrar la pestaña: el borrador local recupera el trabajo y se sincroniza al volver", async () => {
    const ep = await createEpisode(env);
    const { ctx, page } = await openEditorPage(env, ep.url);
    await setColor(page, "#ff0000");
    await page.getByTestId("brush-size").fill("31");

    // Se cae el servidor de verdad (ni el guardado normal ni el de salida pueden llegar)
    const port = (env.app.server.address() as { port: number }).port;
    await env.app.close();
    await mouseStroke(page, line(300, 300, 700, 300));
    await mouseStroke(page, line(300, 400, 700, 400));
    await page.waitForFunction(() => window.__gas!.autosave.status === "offline", undefined, { timeout: 10_000 });
    expect(await page.getByTestId("save-status").textContent()).toContain("Sin conexión");
    await page.waitForTimeout(400); // deja escribir el borrador
    await page.close();

    // El servidor vuelve; el proyecto en disco no recibió nada
    env.app = await buildApp({ dataDir: env.dataDir, staticDir: resolve("apps/studio/dist") });
    await env.app.listen({ port, host: "127.0.0.1" });
    expect((await serverAnimation(env, ep.projectId, ep.episodeId)).revision).toBe(0);

    // Se reabre el episodio: el trabajo reaparece desde el borrador local
    const again = await ctx.newPage();
    await again.goto(ep.url);
    await again.getByTestId("stage").waitFor();
    await settle(again);
    expect(await again.getByTestId("toast").textContent()).toContain("recuperó");
    expect(await strokes(again)).toHaveLength(2);
    expect(isRed(await docPixel(again, 500, 300))).toBe(true);
    expect(isRed(await docPixel(again, 500, 400))).toBe(true);

    // ...y se sincroniza solo
    await waitSaved(again);
    const onDisk = await serverAnimation(env, ep.projectId, ep.episodeId);
    expect(Object.values(onDisk.frames[0]!.cells)[0]).toHaveLength(2);
    // El borrador se limpia: una nueva apertura ya no «recupera» nada
    await again.reload();
    await again.getByTestId("stage").waitFor();
    await settle(again);
    expect(await again.getByTestId("toast").textContent()).toBe("");
    await ctx.close();
  });

  it("un cambio sin guardar tampoco se pierde si se cierra la pestaña de golpe", async () => {
    const ep = await createEpisode(env);
    const { ctx, page } = await openEditorPage(env, ep.url);
    page.on("dialog", (d) => void d.accept());
    await mouseStroke(page, line(300, 300, 700, 300));
    await page.close({ runBeforeUnload: false });
    // Reabre: o el guardado de salida llegó al servidor o el borrador local lo recupera
    const again = await openEditorPage(env, ep.url, {});
    expect(await strokes(again.page)).toHaveLength(1);
    await again.ctx.close();
    await ctx.close();
  });

  it("conflicto entre dos dispositivos: se detiene, avisa y no pisa el trabajo del otro", async () => {
    const ep = await createEpisode(env);
    const A = await openEditorPage(env, ep.url);
    const B = await openEditorPage(env, ep.url);
    await mouseStroke(A.page, line(300, 200, 700, 200));
    await waitSaved(A.page);

    await mouseStroke(B.page, line(300, 500, 700, 500));
    await B.page.waitForFunction(() => window.__gas!.autosave.status === "conflict", undefined, { timeout: 10_000 });
    await B.page.getByRole("alert").waitFor();
    expect(await B.page.getByRole("alert").textContent()).toContain("Otro dispositivo");
    const disk = await serverAnimation(env, ep.projectId, ep.episodeId);
    expect(Object.values(disk.frames[0]!.cells)[0]![0]!.points[1]).toBe(200); // sigue lo de A

    B.page.on("dialog", (d) => void d.accept());
    await Promise.all([B.page.waitForEvent("load"), B.page.getByTestId("conflict-reload").click()]);
    await B.page.getByTestId("stage").waitFor();
    await settle(B.page);
    expect(await strokes(B.page)).toHaveLength(1);
    expect((await strokes(B.page))[0]!.points[1]).toBe(200);
    await A.ctx.close();
    await B.ctx.close();
  });

  it("un archivo de dibujo dañado se informa y NO se sobrescribe", async () => {
    const ep = await createEpisode(env);
    const dir = join(env.dataDir, `${ep.projectId}.gangstudio`, "episodes");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${ep.episodeId}.json`), "{ esto no es json");
    const { ctx, page } = await openPage(env);
    await page.goto(ep.url);
    await page.getByRole("alert").waitFor();
    expect(await page.getByRole("alert").textContent()).toContain("dañado");
    expect(await readFile(join(dir, `${ep.episodeId}.json`), "utf8")).toBe("{ esto no es json");
    await ctx.close();
  });
});

describe("flujo completo desde la interfaz (Fase 0 + Fase 1)", () => {
  it("crear proyecto → episodio → Dibujar → volver → reabrir con el dibujo intacto", async () => {
    const { ctx, page, errors } = await openPage(env);
    await page.goto(env.base);
    await page.fill("#p-name", "Los Colmillos");
    await page.selectOption("#p-fps", "30");
    await page.getByRole("button", { name: "Crear proyecto" }).click();
    await page.getByTestId("add-season").click();
    await page.getByTestId("add-episode").click();
    await page.getByTestId("episode-title").first().fill("Ep. 1 — Humo y neón");
    await page.getByTestId("draw").click(); // guarda el proyecto y abre el editor
    await page.getByTestId("stage").waitFor();
    expect(page.url()).toMatch(/#\/p\/[\w-]+\/e\/[\w-]+$/);
    expect(await page.locator(".doc-title strong").textContent()).toBe("Ep. 1 — Humo y neón");
    expect(await page.getByTestId("fps").inputValue()).toBe("30");

    await setColor(page, "#e8323c");
    await mouseStroke(page, line(300, 300, 800, 300));
    await page.getByTestId("exit").click(); // sale guardando
    await page.getByTestId("proj-name").waitFor();
    expect(page.url()).toMatch(/#\/p\/[\w-]+$/);

    await page.getByTestId("draw").click();
    await page.getByTestId("stage").waitFor();
    await settle(page);
    expect(await strokes(page)).toHaveLength(1);
    expect(isRed(await docPixel(page, 500, 300))).toBe(true);

    // El botón «atrás» del navegador vuelve al proyecto
    await page.goBack();
    await page.getByTestId("proj-name").waitFor();
    expect(errors).toEqual([]);
    await ctx.close();
  });
});
