import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SHOTS, createCharacter, createEpisode, docPixel, openEditorPage, serverAnimation, settle, startEnv, waitSaved, type Env } from "./helpers";
import { charDoc, openSection, setRange } from "./char-helpers";
import { goto } from "./rig-setup";

let env: Env;
beforeAll(async () => (env = await startEnv()));
afterAll(() => env.close());

const V = { viewport: { width: 1440, height: 900 } } as const;
const fetchFile = async (href: string) => Buffer.from(await (await fetch(env.base + href)).arrayBuffer());

/** Diseña en el editor un personaje mínimo pero completo (cuerpo, ropa, pelo, expresiones, pose) y lo deja guardado en la biblioteca. */
async function designCharacter(name: string) {
  const c = await createCharacter(env, name);
  const { page, ctx } = await openEditorPage(env, c.url, V);
  await page.getByTestId("char-build").click();
  for (const [slot, type] of [["pantalon", "pantalon"], ["calzado", "zapatillas"], ["camiseta", "camiseta"], ["chaqueta", "chaqueta"]] as const) {
    await page.getByTestId(`slot-${slot}`).click();
    await page.getByTestId("g-type").selectOption(type);
    await page.getByTestId("g-apply").click();
  }
  await openSection(page, "cp-hair");
  await page.getByTestId("hair-style").selectOption("puntiagudo");
  await openSection(page, "cp-expr");
  await page.getByTestId("expr-preset-serio").click();
  await page.getByTestId("expr-name").fill("Serio");
  await page.getByTestId("expr-save").click();
  await page.getByTestId("expr-preset-enojado").click();
  await page.getByTestId("expr-name").fill("Enfadado");
  await page.getByTestId("expr-save").click();
  await page.getByTestId("expr-preset-serio").click();
  // una pose: brazo izquierdo arriba
  await page.evaluate(() => {
    const m = window.__gas!.model;
    const sk = m.skeleton!;
    const arm = sk.bones.find((b) => b.name === "Brazo superior izq.")!;
    m.poseBoneLive(arm.id, { r: -110 });
    m.rigEnd();
  });
  await openSection(page, "cp-poses");
  await page.getByTestId("pose-name").fill("Saludo");
  await page.getByTestId("pose-save").click();
  await waitSaved(page);
  await ctx.close();
  return c;
}

describe("reutilizar personajes de la biblioteca en episodios", () => {
  it("insertar, expresiones, poses guardadas, exportar idéntico al editor, y reutilizar en OTRO episodio; borrar de la biblioteca no rompe las copias", async () => {
    const pj = await designCharacter("Kenji");
    const ep = await createEpisode(env, { name: "Serie A", width: 640, height: 360, fps: 12 });
    const { ctx, page, errors } = await openEditorPage(env, ep.url, V);
    await page.getByTestId("fps").selectOption("12");
    await page.getByTestId("open-chars").evaluate((b) => (b as HTMLElement).click()).catch(() => undefined);
    await page.getByTestId("insert-open").click();
    await page.getByTestId("insert-dialog").waitFor();
    await page.getByTestId("insert-name").fill("Kenji");
    await page.getByTestId("insert-ok").click();
    await page.getByTestId("instance").waitFor();
    let d = await charDoc(page);
    expect(d.instances).toHaveLength(1);
    const inst = d.instances[0];
    expect(inst.expressions.map((e: { name: string }) => e.name).sort()).toEqual(["Enfadado", "Serio"]);
    expect(inst.poses.map((p: { name: string }) => p.name)).toEqual(["Saludo"]);
    expect(d.rigs).toHaveLength(1);
    expect(d.layers.filter((l: { group?: string }) => l.group === "Kenji").length).toBe(inst.layerIds.length);
    // el personaje se ve en el lienzo (no hay pixeles blancos en su torso)
    await page.getByTestId("zoom-fit").click();
    await settle(page);
    const feet = inst.ty;
    const chest = await docPixel(page, 320, feet - 0.62 * 360 * 0.6);
    expect(chest.every((v: number) => v >= 250), "el torso del personaje está pintado").toBe(false);

    // 3 dibujos; expresión «Enfadado» solo en el 2.º (cambia sus ojos/cejas/boca; el 1.º y el 3.º no)
    await page.getByTestId("dup-frame").click();
    await page.getByTestId("dup-frame").click();
    await goto(page, 1);
    const eyes = (x: typeof d) => x.layers.find((l: { group?: string; part?: string }) => l.group === "Kenji" && l.part === "eyes").id as string;
    const before = await charDoc(page);
    await page.getByTestId("inst-expr").selectOption({ label: "Enfadado" });
    d = await charDoc(page);
    expect(JSON.stringify(d.frames[1].cells[eyes(d)])).not.toBe(JSON.stringify(before.frames[1].cells[eyes(d)]));
    expect(d.frames[0].cells[eyes(d)]).toEqual(before.frames[0].cells[eyes(d)]);
    expect(d.frames[2].cells[eyes(d)]).toEqual(before.frames[2].cells[eyes(d)]);
    // pose guardada como keyframe en el 3.º → el personaje se anima por rigging entre 1.º (reposo) y 3.º
    await goto(page, 0);
    await page.getByTestId("tool-rig").click();
    await page.getByTestId("key-save").click();
    await goto(page, 2);
    await page.getByTestId("inst-pose").selectOption({ label: "Saludo" });
    d = await charDoc(page);
    const skId = inst.skeletonId;
    const arm = d.rigs[0].bones.find((b: { name: string }) => b.name === "Brazo superior izq.").id;
    expect(d.frames[2].poses[skId].bones[arm].r).toBe(-110);
    await goto(page, 1);
    const mid = await page.evaluate(([, a]) => window.__gas!.model.rigStates()!.pose.get(a!)!.r, [skId, arm]);
    expect(mid).toBeCloseTo(-55, 0); // a mitad de camino (lineal)
    await page.getByTestId("rig-toggle-show").click();
    await page.getByTestId("tool-pen").click();
    await page.screenshot({ path: join(SHOTS, "49-episodio-personaje-insertado.png") });
    await waitSaved(page);

    // exportar el dibujo 3 (pose del saludo) a PNG y compararlo con lo que muestra el editor
    await goto(page, 2);
    await page.evaluate(() => window.__gas!.viewport.setView({ zoom: 1, x: 100, y: 60 }));
    await settle(page);
    const shot = await page.evaluate(() => {
      const g = window.__gas!;
      const src = document.querySelector("canvas.stage-canvas") as HTMLCanvasElement;
      const out = document.createElement("canvas");
      out.width = g.model.doc.width; out.height = g.model.doc.height;
      const k = src.width / src.clientWidth;
      out.getContext("2d")!.drawImage(src, g.viewport.view.x * k, g.viewport.view.y * k, out.width, out.height, 0, 0, out.width, out.height);
      return out.toDataURL("image/png");
    });
    await page.getByTestId("export-open").click();
    await page.getByTestId("export-dialog").waitFor();
    await page.getByTestId("export-format-png").click();
    await page.getByTestId("export-name").fill("kenji_saludo");
    await page.getByTestId("export-start").click();
    await page.getByTestId("export-done").waitFor({ timeout: 120_000 });
    const exported = await loadImage(await fetchFile((await page.getByTestId("export-download").getAttribute("href"))!));
    const editorImg = await loadImage(Buffer.from(shot.split(",")[1]!, "base64"));
    const read = (img: Awaited<ReturnType<typeof loadImage>>) => { const c = createCanvas(640, 360); const cx = c.getContext("2d"); cx.drawImage(img, 0, 0); return cx.getImageData(0, 0, 640, 360).data; };
    const A = read(editorImg), B = read(exported);
    let sum = 0, over = 0, ink = 0;
    for (let i = 0; i < A.length; i += 4) { const m = Math.max(Math.abs(A[i]! - B[i]!), Math.abs(A[i + 1]! - B[i + 1]!), Math.abs(A[i + 2]! - B[i + 2]!)); sum += m; if (m > 40) over++; if (B[i]! < 240) ink++; }
    const px = A.length / 4;
    writeFileSync(join(SHOTS, "comparacion-personaje-editor-exportacion.json"), JSON.stringify({ pixeles: px, diferenciaMedia: +(sum / px).toFixed(4), pixelesConDiferenciaMayorQue40: over, pixelesConDibujo: ink }, null, 2));
    expect(ink, "el PNG contiene al personaje").toBeGreaterThan(8_000);
    expect(sum / px).toBeLessThan(1.5);
    expect(over / px).toBeLessThan(0.01);
    await page.getByTestId("export-dialog-close").click().catch(() => undefined);
    await ctx.close();

    // ── otro episodio (otro proyecto) reutiliza el mismo personaje; luego lo borramos de la biblioteca: las copias siguen
    const ep2 = await createEpisode(env, { name: "Serie B", width: 1920, height: 1080, fps: 24 });
    const second = await openEditorPage(env, ep2.url, V);
    await second.page.getByTestId("insert-open").click();
    await second.page.getByTestId("insert-ok").click();
    await second.page.getByTestId("instance").waitFor();
    const d2 = await charDoc(second.page);
    expect(d2.instances[0].characterId).toBe(pj.id);
    expect(d2.instances[0].scale).not.toBe(inst.scale); // se adapta a la resolución del otro episodio
    await waitSaved(second.page);
    expect((await fetch(`${env.base}/api/characters/${pj.id}`, { method: "DELETE" })).status).toBe(204);
    expect(await (await fetch(`${env.base}/api/characters`)).json()).toMatchObject({ characters: [] });
    const reopened = await serverAnimation(env, ep2.projectId, ep2.episodeId);
    expect(reopened.instances).toHaveLength(1);
    expect(reopened.rigs).toHaveLength(1);
    expect(reopened.instances![0]!.expressions).toHaveLength(2);
    await second.ctx.close();
    const third = await openEditorPage(env, ep2.url, V);
    expect((await charDoc(third.page)).instances).toHaveLength(1);
    await third.page.screenshot({ path: join(SHOTS, "50-episodio-reutilizado.png") });
    expect(errors).toEqual([]);
    expect(third.errors).toEqual([]);
    void setRange;
    await third.ctx.close();
  }, 300_000);
});
