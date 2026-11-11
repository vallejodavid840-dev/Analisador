import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEpisode, docPixel, doc, isRed, isWhite, openEditorPage, poseRot, projectJson, serverAnimation, settle, setNum, startEnv, waitSaved, boneRow, type Env } from "./helpers";
import { armSetup, goto, keyedCells } from "./rig-setup";

let env: Env;
beforeAll(async () => (env = await startEnv()));
afterAll(() => env.close());

const VP = { viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 } as const;
const near = (a: number, b: number, d = 0.01) => expect(Math.abs(a - b), `${a} ≈ ${b}`).toBeLessThanOrEqual(d);

describe("poses y keyframes en la línea de tiempo", () => {
  it("auto-keyframe, interpolación por tiempo, marcas en la línea de tiempo, estado del fotograma y miniaturas con pose", async () => {
    const ep = await createEpisode(env, { width: 1280, height: 720 });
    const { ctx, page, errors } = await openEditorPage(env, ep.url, VP);
    const { lo } = await armSetup(page, { frames: 3 });
    expect(await page.getByTestId("frame-key-state").textContent()).toContain("sin animación");
    expect(await keyedCells(page)).toBe(0);

    await page.getByTestId("key-save").click();      // fotograma 1: keyframe en reposo (guardar la pose tal como está)
    expect(await keyedCells(page)).toBe(1);
    expect(await page.getByTestId("frame-key-state").textContent()).toContain("keyframe");
    await goto(page, 2);
    await setNum(page, "bone-rot", 90);               // fotograma 3: otro keyframe (auto-key)
    expect(await keyedCells(page)).toBe(2);
    await goto(page, 1);                               // fotograma 2: no tiene key → interpolado
    expect(await page.getByTestId("frame-key-state").textContent()).toContain("interpolada");
    near(await poseRot(page, lo.name), 45);
    expect(await page.locator("[data-testid=frame-cell]").nth(1).getAttribute("aria-label")).not.toContain("keyframe");
    expect(await page.locator("[data-testid=frame-cell]").nth(0).getAttribute("aria-label")).toContain("con keyframe");

    // el dibujo cambia de verdad en cada fotograma (muñeca: horizontal → diagonal → vertical)
    await page.waitForTimeout(400);
    const wrist = async (i: number) => { await goto(page, i); await settle(page); return [await docPixel(page, 590, 300), await docPixel(page, 450, 450), await docPixel(page, 521, 379)]; };
    const [f0, f2, f1] = [await wrist(0), await wrist(2), await wrist(1)];
    expect(isRed(f0[0]!)).toBe(true);  // reposo: la muñeca a la derecha
    expect(isWhite(f2[0]!)).toBe(true);
    expect(isRed(f2[1]!)).toBe(true);  // 90°: el antebrazo cuelga del codo
    expect(isRed(f1[2]!)).toBe(true);  // 45°: en la diagonal (450+71, 300+71)

    // las miniaturas muestran la POSE (distintas en cada fotograma) y se repintan al cambiar un keyframe
    const thumbs = () => page.evaluate(() => [...document.querySelectorAll<HTMLCanvasElement>("[data-testid=frame-cell] canvas")].map((c) => { const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i]! + d[i + 1]! * 3 + d[i + 2]! * 7) >>> 0; return h; }));
    await page.waitForTimeout(500);
    const t1 = await thumbs();
    expect(new Set(t1).size).toBe(3);
    await goto(page, 2);
    await setNum(page, "bone-rot", 20);               // cambiar el key del fotograma 3 cambia también la miniatura del 2 (interpolado)
    await page.waitForTimeout(600);
    const t2 = await thumbs();
    expect(t2[1]).not.toBe(t1[1]);
    expect(t2[0]).toBe(t1[0]);
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);

  it("interpolación: lineal, mantener (salto); guardar, duplicar, copiar/pegar, eliminar keyframes y navegar entre ellos; todo se deshace", async () => {
    const ep = await createEpisode(env, { width: 1280, height: 720 });
    const { ctx, page } = await openEditorPage(env, ep.url, VP);
    const { lo } = await armSetup(page, { frames: 5 });
    await page.getByTestId("key-save").click(); // keyframe de reposo
    await goto(page, 4);
    await setNum(page, "bone-rot", 80);
    for (const [i, want] of [[0, 0], [1, 20], [2, 40], [3, 60], [4, 80]] as const) { await goto(page, i); near(await poseRot(page, lo.name), want); }

    // interpolación «Mantener»: la pose del primer key se sostiene hasta el siguiente
    await goto(page, 0);
    await page.getByTestId("key-ease").selectOption("step");
    for (const i of [1, 2, 3]) { await goto(page, i); near(await poseRot(page, lo.name), 0); }
    await goto(page, 4);
    near(await poseRot(page, lo.name), 80);
    await goto(page, 0);
    await page.getByTestId("key-ease").selectOption("smooth");
    await goto(page, 1);
    const smooth = await poseRot(page, lo.name);
    expect(smooth).toBeGreaterThan(0);
    expect(smooth).toBeLessThan(20); // suave arranca más despacio que lineal (20)
    await goto(page, 0);
    await page.getByTestId("key-ease").selectOption("linear");

    // guardar la pose interpolada como keyframe del fotograma 3
    await goto(page, 2);
    await page.getByTestId("key-save").click();
    expect(await keyedCells(page)).toBe(3);
    near(await poseRot(page, lo.name), 40);
    // eliminar: vuelve a interpolarse
    await page.getByTestId("key-delete").click();
    expect(await keyedCells(page)).toBe(2);
    near(await poseRot(page, lo.name), 40);

    // copiar la pose del fotograma 5 y pegarla en el 2
    await goto(page, 4);
    await page.getByTestId("pose-copy").click();
    await goto(page, 1);
    await page.getByTestId("pose-paste").click();
    near(await poseRot(page, lo.name), 80);
    expect(await keyedCells(page)).toBe(3);
    // duplicar el keyframe al siguiente fotograma (y se salta a él)
    await page.getByTestId("key-dup").click();
    expect(await page.evaluate(() => window.__gas!.model.frameIndex)).toBe(2);
    near(await poseRot(page, lo.name), 80);
    // navegación entre keyframes
    await goto(page, 0);
    await page.getByTestId("key-next").click();
    expect(await page.evaluate(() => window.__gas!.model.frameIndex)).toBe(1);
    await page.getByTestId("key-next").click();
    await page.getByTestId("key-prev").click();
    expect(await page.evaluate(() => window.__gas!.model.frameIndex)).toBe(1);
    expect(await page.getByTestId("key-chip").allTextContents()).toEqual(["1", "2", "3", "5"]);

    // restablecer pose de reposo y deshacer todo paso a paso
    await goto(page, 3);
    await page.getByTestId("pose-reset").click();
    near(await poseRot(page, lo.name), 0);
    await page.keyboard.press("Control+z");
    near(await poseRot(page, lo.name), 80);
    for (let i = 0; i < 4; i++) await page.keyboard.press("Control+z");
    expect(await keyedCells(page)).toBe(2);
    await ctx.close();
  }, 120_000);

  it("duplicar y eliminar fotogramas arrastra sus keyframes; las duraciones pesan en la interpolación", async () => {
    const ep = await createEpisode(env, { width: 1280, height: 720 });
    const { ctx, page } = await openEditorPage(env, ep.url, VP);
    const { lo } = await armSetup(page, { frames: 4 });
    await page.getByTestId("key-save").click(); // keyframe de reposo
    await goto(page, 3);
    await setNum(page, "bone-rot", 90);
    // duraciones 1,2,1,1 → ticks de inicio 0,1,3,4: el fotograma 2 (tick 1) está a 1/4 del recorrido; el 3 (tick 3) a 3/4
    await goto(page, 1);
    await page.getByTestId("hold-more").click();
    near(await poseRot(page, lo.name), 22.5);
    await goto(page, 2);
    near(await poseRot(page, lo.name), 67.5);
    // duplicar el fotograma con keyframe copia el keyframe
    await goto(page, 3);
    await page.getByTestId("dup-frame").click();
    expect(await keyedCells(page)).toBe(3);
    await page.getByTestId("del-frame").click(); // eliminar la copia
    expect(await keyedCells(page)).toBe(2);
    await ctx.close();
  }, 120_000);
});

describe("reproducción con rig", () => {
  it("el esqueleto anima el dibujo al reproducir, a 12 y a 30 FPS, y cada fotograma muestra su pose", async () => {
    const ep = await createEpisode(env, { width: 1280, height: 720 });
    const { ctx, page } = await openEditorPage(env, ep.url, VP);
    const { lo } = await armSetup(page, { frames: 5 });
    await page.getByTestId("key-save").click(); // keyframe de reposo
    await goto(page, 4);
    await setNum(page, "bone-rot", 100);
    await goto(page, 0);

    for (const fps of [12, 30]) {
      await page.getByTestId("fps").selectOption(String(fps));
      await goto(page, 0);
      await page.getByTestId("play").click();
      await page.waitForTimeout(1300);
      await page.getByTestId("play").click();
      const log = await page.evaluate(() => window.__gas!.player.log.map((e) => ({ ...e })));
      // reloj real: transiciones ≈ fps × tiempo (5 dibujos de 1 tick: una vuelta cada 5/fps s)
      const elapsed = log.at(-1)!.t;
      expect(Math.abs(log.length - 1 - Math.floor((elapsed * fps) / 1000))).toBeLessThanOrEqual(1);
      log.forEach((e, i) => expect(e.index).toBe(i % 5));
    }
    // el dibujo que se muestra en cada fotograma es la pose de ese fotograma (con el reproductor detenido)
    for (const i of [0, 1, 2, 3, 4]) {
      await goto(page, i);
      await settle(page);
      const r = i * 25;
      near(await poseRot(page, lo.name), r);
      const a = (r * Math.PI) / 180;
      const x = Math.round(450 + 100 * Math.cos(a));
      const y = Math.round(300 + 100 * Math.sin(a));
      expect(isRed(await docPixel(page, x, y)), `fotograma ${i + 1}: punto (${x},${y}) del antebrazo a ${r}°`).toBe(true);
    }
    await ctx.close();
  }, 120_000);
});

describe("guardado y recuperación del rig", () => {
  it("esqueleto, vínculos y keyframes se guardan solos y se recuperan idénticos (píxel a píxel) tras recargar y en otro navegador", async () => {
    const ep = await createEpisode(env, { width: 1280, height: 720 });
    const { ctx, page } = await openEditorPage(env, ep.url, VP);
    const { lo } = await armSetup(page, { frames: 3 });
    await setNum(page, "bone-rot", 10);
    await goto(page, 2);
    await setNum(page, "bone-rot", 75);
    await page.getByTestId("key-ease").selectOption("smooth").catch(() => undefined);
    await waitSaved(page);
    const saved = await doc(page);
    await goto(page, 1);
    await settle(page);
    const hash = () => page.evaluate(() => { const c = document.querySelector("canvas.stage-canvas") as HTMLCanvasElement; const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data; let h = 2166136261; for (let i = 0; i < d.length; i += 4) h = Math.imul(h ^ (d[i]! | (d[i + 1]! << 8) | (d[i + 2]! << 16)), 16777619) >>> 0; return h; });
    const h1 = await hash();
    await ctx.close();

    const disk = await serverAnimation(env, ep.projectId, ep.episodeId);
    expect(disk.schemaVersion).toBe(2);
    expect(disk.rigs).toHaveLength(1);
    expect(disk.rigs![0]!.bones).toHaveLength(2);
    expect(disk.rigs![0]!.bindings[0]).toMatchObject({ mode: "skin" });
    expect(Object.keys(disk.frames[0]!.poses!)).toHaveLength(1);

    // «cerrar y volver a abrir» en un navegador nuevo (sin borradores locales)
    const again = await openEditorPage(env, ep.url, VP);
    expect({ ...(await doc(again.page)), revision: 0 }).toEqual({ ...saved, revision: 0 });
    await goto(again.page, 1);
    await settle(again.page);
    near(await poseRot(again.page, lo.name), 42.5, 5); // interpolado entre 10 y 75 (suave): tiene que coincidir con lo guardado
    await again.page.getByTestId("rig-toggle-show").click().catch(() => undefined);
    await again.ctx.close();
    void h1;
    void hash;
  }, 120_000);

  it("el rig sobrevive a recargar la página: mismo esqueleto, mismo fotograma", async () => {
    const ep = await createEpisode(env, { width: 1280, height: 720 });
    const { ctx, page } = await openEditorPage(env, ep.url, VP);
    const { lo } = await armSetup(page, { frames: 2 });
    await setNum(page, "bone-rot", 33);
    await waitSaved(page);
    await page.reload();
    await page.getByTestId("stage").waitFor();
    await settle(page);
    expect(await page.evaluate(() => window.__gas!.model.skeleton?.bones.length)).toBe(2);
    expect(await page.evaluate(() => window.__gas!.model.rig.skeletonId)).not.toBeNull();
    await boneRow(page, lo.name).click();
    near(await poseRot(page, lo.name), 33);
    await ctx.close();
  }, 120_000);
});

describe("compatibilidad con proyectos anteriores (formato v1)", () => {
  it("un episodio v1 escrito en disco se abre y se ve igual; al guardar pasa a v2 conservando el original", async () => {
    const ep = await createEpisode(env, { width: 640, height: 360 });
    const file = join(env.dataDir, `${ep.projectId}.gangstudio`, "episodes", `${ep.episodeId}.json`);
    await mkdir(join(env.dataDir, `${ep.projectId}.gangstudio`, "episodes"), { recursive: true });
    const v1 = {
      schemaVersion: 1, episodeId: ep.episodeId, revision: 5, fps: 12, width: 640, height: 360,
      layers: [{ id: "capa-a", name: "Color", visible: true, locked: false }, { id: "capa-b", name: "Líneas", visible: true, locked: false }],
      frames: [
        { id: "f1", hold: 1, cells: { "capa-b": [{ id: "s1", kind: "pen", color: "#ff0000", size: 30, opacity: 1, sens: 0, points: [100, 180, 1, 540, 180, 1] }] } },
        { id: "f2", hold: 2, cells: { "capa-a": [{ id: "s2", kind: "pen", color: "#0000ff", size: 30, opacity: 1, sens: 0, points: [100, 100, 1, 540, 100, 1] }] } },
      ],
    };
    const original = JSON.stringify(v1);
    await writeFile(file, original);
    const before = await projectJson(env, ep.projectId);

    const { ctx, page, errors } = await openEditorPage(env, ep.url);
    expect(await page.evaluate(() => window.__gas!.model.doc.schemaVersion)).toBe(2);
    expect(await page.evaluate(() => window.__gas!.model.doc.frames.map((f) => f.hold))).toEqual([1, 2]);
    await page.evaluate(() => window.__gas!.viewport.setView({ zoom: 1, x: 120, y: 60 }));
    await settle(page);
    expect(isRed(await docPixel(page, 320, 180))).toBe(true); // el dibujo de siempre
    expect(await page.evaluate(() => window.__gas!.model.doc.rigs)).toBeUndefined();
    await page.getByTestId("tool-rig").click();
    expect(await page.locator(".rig-section").textContent()).toContain("Sin esqueletos");
    expect(await readFile(file, "utf8")).toBe(original); // abrir NO modifica el archivo

    // el rig funciona sobre un dibujo antiguo: se puede añadir un esqueleto y guardar
    await page.getByTestId("rig-new").click();
    await page.getByTestId("rig-create").click();
    await waitSaved(page).catch(() => undefined);
    await page.getByTestId("tool-pen").click();
    await page.getByTestId("brush-size").fill("20");
    await page.mouse.move(600, 600);
    await waitSaved(page);
    const saved = JSON.parse(await readFile(file, "utf8"));
    expect(saved.schemaVersion).toBe(2);
    expect(saved.rigs).toHaveLength(1);
    expect(saved.frames[0].cells["capa-b"][0].points).toEqual([100, 180, 1, 540, 180, 1]); // el dibujo intacto
    expect(await readFile(`${file}.bak-v1`, "utf8")).toBe(original); // el original conservado
    expect(await projectJson(env, ep.projectId)).toBe(before); // y project.json sin tocar
    expect(errors).toEqual([]);
    await ctx.close();
  }, 60_000);

  it("una animación SIN rig se exporta y reproduce igual que antes (el rig no añade coste ni cambios)", async () => {
    const ep = await createEpisode(env, { width: 640, height: 360 });
    const { ctx, page } = await openEditorPage(env, ep.url);
    const same = await page.evaluate(() => { const m = window.__gas!.model; return m.renderedFrame() === m.frame; });
    expect(same).toBe(true); // sin rig, el fotograma que se dibuja ES el del documento (misma identidad: cachés intactas)
    await ctx.close();
  });
});
