import { execFile } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeFrames } from "../packages/export/test/helpers";
import { SHOTS, boneGeo, boneRow, createEpisode, line, mouseStroke, openEditorPage, poseRot, settle, setColor, setNum, startEnv, type Env } from "./helpers";
import { goto } from "./rig-setup";

let env: Env;
beforeAll(async () => (env = await startEnv()));
afterAll(() => env.close());

const OUT = join(SHOTS, "personaje");
const VP = { viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 } as const;
const SKIN = "#f6d5bd";
const JACKET = "#e8323c";
const PANTS = "#1d1a26";
const INK = "#111111";
const HAIR = "#3b2a20";
const waitDone = (page: Page) => page.getByTestId("export-done").waitFor({ timeout: 180_000 });
const run = (cmd: string, args: string[]) => new Promise<string>((res, rej) => execFile(cmd, args, (e, out, err) => (e ? rej(new Error(String(err))) : res(String(out).trim()))));

/** Tamaño de pincel en px → posición del deslizador (el mapa del panel es cuadrático). */
const setSize = (page: Page, px: number) => page.getByTestId("brush-size").fill(String(Math.round(100 * Math.sqrt((px - 1) / 199))));
const ellipse = (cx: number, cy: number, rx: number, ry: number, n = 36): Array<[number, number]> => Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos((i / n) * 2 * Math.PI) * rx, cy + Math.sin((i / n) * 2 * Math.PI) * ry] as [number, number]);
const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

async function renameActiveLayer(page: Page, name: string) {
  await page.locator("[data-testid=layer-row].active [data-testid=layer-rename]").click();
  await page.getByTestId("layer-name-input").fill(name);
  await page.keyboard.press("Enter");
}
const selectLayer = (page: Page, name: string) => page.locator("[data-testid=layer-row]", { hasText: name }).locator("[data-testid=layer-name]").click();

async function bind(page: Page, layer: string, mode: "rigid" | "skin", bone: string, influences: string[] = []) {
  await selectLayer(page, layer);
  await page.getByTestId("bind-mode").selectOption(mode);
  await page.getByTestId("bind-bone").selectOption({ label: bone });
  for (const n of influences) await page.locator("label.infl-row", { hasText: n }).locator("input").check();
}

describe("personaje de prueba dibujado en el editor", () => {
  it("dibujo → esqueleto → vínculos → 4 poses con keyframes → reproducción → MP4", async () => {
    mkdirSync(OUT, { recursive: true });
    const ep = await createEpisode(env, { name: "Kenji", width: 1280, height: 720, fps: 12 });
    const { ctx, page, errors } = await openEditorPage(env, ep.url, VP);
    await page.keyboard.press("o");

    /* 1 · Esqueleto humanoide (plantilla): sirve de guía para dibujar cada parte donde le toca */
    await page.getByTestId("tool-rig").click();
    await page.getByTestId("rig-humanoid").click();
    const G = async (n: string) => boneGeo(page, n);
    const head = await G("Cabeza"), neck = await G("Cuello"), torso = await G("Torso"), hip = await G("Cadera");

    /* 2 · Capas: una por parte del cuerpo (de atrás hacia delante) */
    await selectLayer(page, "Color");
    await renameActiveLayer(page, "Pierna der.");
    await page.getByTestId("add-layer").click(); await renameActiveLayer(page, "Pierna izq.");
    await page.getByTestId("add-layer").click(); await renameActiveLayer(page, "Torso");
    await page.getByTestId("add-layer").click(); await renameActiveLayer(page, "Brazo der.");
    await page.getByTestId("add-layer").click(); await renameActiveLayer(page, "Cabeza");
    await selectLayer(page, "Líneas");
    await renameActiveLayer(page, "Brazo izq.");
    const layerNames = await page.locator("[data-testid=layer-name]").allTextContents();
    expect(layerNames).toEqual(["Brazo izq.", "Cabeza", "Brazo der.", "Torso", "Pierna izq.", "Pierna der."]);

    /* 3 · Dibujo (modo editar: el arte se ve sin deformar). El pincel es el del propio editor. */
    await page.getByTestId("tool-pen").click();
    const poly = (pts: Array<[number, number]>) => pts.flatMap((p, i) => (i ? line(pts[i - 1]![0], pts[i - 1]![1], p[0], p[1], 6).slice(1) : [p]));
    // piernas: pantalón + zapato
    for (const side of ["izq.", "der."] as const) {
      await selectLayer(page, `Pierna ${side}`);
      const th = await G(`Pierna superior ${side}`), sh = await G(`Pierna inferior ${side}`), ft = await G(`Pie ${side}`);
      await setColor(page, PANTS); await setSize(page, 46);
      await mouseStroke(page, poly([th.head, th.tail, sh.tail]));
      await setColor(page, "#f4f4f4"); await setSize(page, 34);
      await mouseStroke(page, poly([[ft.head[0], ft.head[1] - 4], [ft.tail[0] + (side === "izq." ? 14 : -14), ft.tail[1] - 8]]));
    }
    // torso: chaqueta + cuello
    await selectLayer(page, "Torso");
    await setColor(page, JACKET); await setSize(page, 120);
    await mouseStroke(page, poly([[hip.head[0], hip.head[1] - 6], [torso.tail[0], torso.tail[1] + 30]]));
    await setColor(page, SKIN); await setSize(page, 30);
    await mouseStroke(page, poly([[neck.head[0], neck.head[1] + 14], [neck.tail[0], neck.tail[1] + 4]]));
    await setColor(page, INK); await setSize(page, 6);
    await mouseStroke(page, poly([[torso.tail[0], torso.tail[1] + 26], [torso.tail[0], hip.head[1] - 20]])); // cremallera
    // brazos: manga + antebrazo/mano
    for (const side of ["izq.", "der."] as const) {
      await selectLayer(page, `Brazo ${side}`);
      const up = await G(`Brazo superior ${side}`), lo = await G(`Brazo inferior ${side}`), ha = await G(`Mano ${side}`);
      await setColor(page, JACKET); await setSize(page, 38);
      await mouseStroke(page, poly([[up.head[0], up.head[1] - 6], up.tail, mid(lo.head, lo.tail)]));
      await setColor(page, SKIN); await setSize(page, 28);
      await mouseStroke(page, poly([mid(lo.head, lo.tail), lo.tail, ha.tail]));
    }
    // cabeza: cara, pelo, ojos y boca
    await selectLayer(page, "Cabeza");
    const hc: [number, number] = [head.head[0], (head.head[1] + head.tail[1]) / 2 - 4];
    await setColor(page, SKIN); await setSize(page, 112);
    await mouseStroke(page, [hc, [hc[0], hc[1] + 0.2]]);
    await setColor(page, HAIR); await setSize(page, 30);
    await mouseStroke(page, poly([[hc[0] - 52, hc[1] - 14], [hc[0] - 40, hc[1] - 46], [hc[0], hc[1] - 62], [hc[0] + 40, hc[1] - 46], [hc[0] + 52, hc[1] - 14]]));
    await setSize(page, 20);
    await mouseStroke(page, poly([[hc[0] - 28, hc[1] - 44], [hc[0] - 6, hc[1] - 36], [hc[0] + 20, hc[1] - 52]])); // flequillo
    await setColor(page, INK); await setSize(page, 12);
    await mouseStroke(page, [[hc[0] - 22, hc[1] - 2], [hc[0] - 22, hc[1] + 0.3]]);
    await mouseStroke(page, [[hc[0] + 22, hc[1] - 2], [hc[0] + 22, hc[1] + 0.3]]);
    await setSize(page, 5);
    await mouseStroke(page, poly([[hc[0] - 16, hc[1] + 28], [hc[0], hc[1] + 36], [hc[0] + 16, hc[1] + 28]]));
    await setSize(page, 5);
    await mouseStroke(page, ellipse(hc[0], hc[1] + 2, 55, 57)); // contorno
    await page.waitForTimeout(300);
    await page.getByTestId("rig-toggle-show").click(); // dibujo limpio (sin esqueleto)
    await settle(page);
    await page.screenshot({ path: join(OUT, "01-personaje-dibujado.png") });
    await page.getByTestId("rig-toggle-show").click();

    /* 4 · Vínculos: cabeza rígida; el resto deformable (se dobla en codos, rodillas y cintura) */
    await bind(page, "Cabeza", "rigid", "Cabeza");
    await bind(page, "Torso", "skin", "Torso", ["Cadera", "Cuello"]);
    for (const side of ["izq.", "der."] as const) {
      await bind(page, `Brazo ${side}`, "skin", `Brazo superior ${side}`, [`Brazo inferior ${side}`, `Mano ${side}`]);
      await bind(page, `Pierna ${side}`, "skin", `Pierna superior ${side}`, [`Pierna inferior ${side}`, `Pie ${side}`]);
    }
    const sk = await page.evaluate(() => JSON.parse(JSON.stringify(window.__gas!.model.skeleton)));
    expect(sk.bindings).toHaveLength(6);
    expect(sk.bindings.filter((b: { mode: string }) => b.mode === "skin")).toHaveLength(5);
    await selectLayer(page, "Brazo izq.");
    await page.getByTestId("rig-toggle-weights").click();
    await boneRow(page, "Brazo inferior izq.").click();
    await settle(page);
    await page.screenshot({ path: join(OUT, "02-esqueleto-vinculos-pesos.png") });
    await page.getByTestId("rig-toggle-weights").click();

    /* 5 · Animación: 25 fotogramas (12 FPS, 2 s). «Duplicar» copia el dibujo y se anima solo con poses. */
    await page.getByTestId("rig-mode-pose").click();
    for (let i = 1; i < 25; i++) await page.getByTestId("dup-frame").click();
    await goto(page, 0);
    await page.getByTestId("key-save").click(); // keyframe 1: reposo
    expect(await page.evaluate(() => window.__gas!.model.doc.frames.length)).toBe(25);
    const pose = async (frame: number, edits: Array<[string, number]>, ty?: number) => {
      await goto(page, frame);
      for (const [bone, r] of edits) { await boneRow(page, bone).click(); await setNum(page, "bone-rot", r); }
      if (ty !== undefined) { await boneRow(page, "Cadera").click(); await setNum(page, "bone-ty", ty); }
    };
    await pose(6, [["Brazo superior izq.", -125], ["Brazo inferior izq.", 25], ["Cabeza", 10], ["Torso", 6]]);                                                  // saludo
    await pose(12, [["Brazo superior izq.", -125], ["Brazo superior der.", 125], ["Pierna inferior izq.", -50], ["Pierna inferior der.", 50], ["Torso", -4], ["Cabeza", 0]], -45); // salto
    await pose(18, [["Brazo superior izq.", 0], ["Brazo inferior izq.", 0], ["Brazo superior der.", 120], ["Brazo inferior der.", -30], ["Cabeza", -10], ["Torso", -6]], 0);   // saludo der.
    await goto(page, 0);
    await page.getByTestId("pose-copy").click();
    await goto(page, 24);
    await page.getByTestId("pose-paste").click(); // vuelve al reposo
    expect(await page.evaluate(() => window.__gas!.model.keyFrameList)).toEqual([0, 6, 12, 18, 24]);
    await goto(page, 6);
    expect(Math.round(await poseRot(page, "Brazo superior izq."))).toBe(-125);
    await goto(page, 3); // fotograma intermedio: interpolado a mitad de camino (suave en el punto medio = lineal)
    expect(await poseRot(page, "Brazo superior izq.")).toBeCloseTo(-62.5, 0);
    await goto(page, 12);
    expect(Math.round(await poseRot(page, "Pierna inferior izq."))).toBe(-50);

    /* capturas de las poses */
    await goto(page, 6); await settle(page); await page.screenshot({ path: join(OUT, "03-pose-saludo-con-esqueleto.png") });
    await goto(page, 12); await settle(page); await page.screenshot({ path: join(OUT, "04-pose-salto-con-esqueleto.png") });
    const posedGeo = { hand6: null as null | [number, number][] };
    await goto(page, 6);
    const fore6 = await G("Brazo inferior izq."); // posición del antebrazo en la pose del saludo
    posedGeo.hand6 = [fore6.head, fore6.tail];
    await goto(page, 0);
    const foreRest = await G("Brazo inferior izq.");
    await page.getByTestId("rig-toggle-show").click();
    await goto(page, 6); await settle(page); await page.screenshot({ path: join(OUT, "05-pose-saludo.png") });
    await page.getByTestId("rig-toggle-show").click();
    await page.waitForTimeout(600);

    /* 6 · Reproducción a 12 FPS con el rig */
    await goto(page, 0);
    await page.getByTestId("play").click();
    await page.waitForTimeout(1500);
    await page.getByTestId("play").click();
    const log = await page.evaluate(() => window.__gas!.player.log.map((e) => ({ ...e })));
    expect(Math.abs(log.length - 1 - Math.floor((log.at(-1)!.t * 12) / 1000))).toBeLessThanOrEqual(1);
    await page.getByTestId("tool-pen").click();
    await goto(page, 6);
    await page.waitForFunction(() => window.__gas!.autosave.status === "saved" && !window.__gas!.autosave.dirty, undefined, { timeout: 20_000 });
    await page.screenshot({ path: join(OUT, "06-editor-linea-de-tiempo-con-keyframes.png") });

    /* 7 · Exportar a MP4 (720p, 12 FPS) con la ventana de exportación */
    await page.getByTestId("export-open").click();
    await page.getByTestId("export-dialog").waitFor();
    await page.getByTestId("export-name").fill("kenji_rig_720p_12fps");
    await page.selectOption("[data-testid=export-resolution]", "720");
    await page.selectOption("[data-testid=export-fps]", "same");
    await page.getByTestId("export-start").click();
    await waitDone(page);
    const href = (await page.getByTestId("export-download").getAttribute("href"))!;
    const mp4 = join(OUT, "kenji_rig_720p_12fps.mp4");
    writeFileSync(mp4, Buffer.from(await (await fetch(env.base + href)).arrayBuffer()));
    // + 4 poses clave como PNG con fondo transparente
    for (const [idx, nm] of [[0, "reposo"], [6, "saludo"], [12, "salto"], [18, "saludo-der"]] as const) {
      await page.getByTestId("export-new").click();
      await page.evaluate((k) => window.__gas!.model.setFrameIndex(k), idx);
      await page.getByTestId("export-format-png").click();
      await page.getByTestId("export-bg-transparent").click();
      await page.getByTestId("export-name").fill(`kenji_pose_${idx + 1}_${nm}`);
      await page.getByTestId("export-start").click();
      await waitDone(page);
      const h = (await page.getByTestId("export-download").getAttribute("href"))!;
      writeFileSync(join(OUT, `kenji_pose_${idx + 1}_${nm}.png`), Buffer.from(await (await fetch(env.base + h)).arrayBuffer()));
    }

    /* 8 · Comprobaciones sobre el vídeo exportado */
    expect(await run("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,nb_read_frames,avg_frame_rate", "-of", "csv=p=0", mp4])).toBe("h264,1280,720,12/1,25");
    const frames = await decodeFrames(mp4, 1280, 720);
    expect(frames).toHaveLength(25);
    const px = (f: Buffer, x: number, y: number) => { const i = (Math.round(y) * 1280 + Math.round(x)) * 4; return [f[i]!, f[i + 1]!, f[i + 2]!]; };
    const isSkin = (c: number[]) => Math.abs(c[0]! - 246) < 28 && Math.abs(c[1]! - 213) < 28 && Math.abs(c[2]! - 189) < 28;
    const midOf = (g: [number, number][]) => mid(g[0]!, g[1]!);
    const [fx, fy] = midOf(posedGeo.hand6!);
    const [rx, ry] = mid(foreRest.head, foreRest.tail);
    expect(isSkin(px(frames[6]!, fx, fy)), "el antebrazo está levantado en la pose del saludo").toBe(true);
    expect(isSkin(px(frames[6]!, rx, ry)), "y ya no donde estaba en reposo").toBe(false);
    expect(isSkin(px(frames[0]!, rx, ry)), "en reposo el antebrazo cuelga en su sitio").toBe(true);
    // el personaje SE MUEVE: los fotogramas clave son distintos entre sí, y el último vuelve al primero
    const diff = (a: Buffer, b: Buffer) => { let d = 0; for (let i = 0; i < a.length; i += 4 * 7) d += Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!); return d; };
    expect(diff(frames[0]!, frames[6]!)).toBeGreaterThan(20_000);
    expect(diff(frames[6]!, frames[12]!)).toBeGreaterThan(20_000);
    expect(diff(frames[12]!, frames[18]!)).toBeGreaterThan(20_000);
    expect(diff(frames[0]!, frames[24]!)).toBeLessThan(diff(frames[0]!, frames[6]!) / 6); // vuelve al reposo (hasta compresión)
    // movimiento gradual: dos fotogramas consecutivos se parecen mucho más que dos poses clave
    expect(diff(frames[3]!, frames[4]!)).toBeLessThan(diff(frames[0]!, frames[6]!));

    // hoja de contacto del vídeo (13 de los 25 fotogramas)
    await run("ffmpeg", ["-v", "error", "-y", "-i", mp4, "-vf", "select='not(mod(n,2))',scale=320:-1,tile=5x3:padding=4:color=0x333333", "-frames:v", "1", join(OUT, "contacto-kenji.png")]);
    expect(errors).toEqual([]);

    // y todo se guarda y se recupera: otro navegador abre el episodio con el esqueleto, los vínculos y las 5 poses clave
    await ctx.close();
    const again = await openEditorPage(env, ep.url, VP);
    expect(await again.page.evaluate(() => window.__gas!.model.skeleton!.bones.length)).toBe(16);
    expect(await again.page.evaluate(() => window.__gas!.model.keyFrameList)).toEqual([0, 6, 12, 18, 24]);
    expect(await again.page.evaluate(() => window.__gas!.model.skeleton!.bindings.length)).toBe(6);
    await again.ctx.close();
    copyFileSync(join(OUT, "kenji_rig_720p_12fps.mp4"), join(OUT, "kenji_rig_720p_12fps.mp4"));
  }, 600_000);
});
