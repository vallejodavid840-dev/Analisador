import type { Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AnimationSchema } from "@gas/core";
import { boneGeo, boneRow, createEpisode, docPixel, dragDoc, isRed, isWhite, line, mouseStroke, openEditorPage, poseRot, settle, setColor, setNum, skeletonOf, startEnv, strokes, type Env } from "./helpers";

let env: Env;
beforeAll(async () => (env = await startEnv()));
afterAll(() => env.close());

const bones = (page: Page) => skeletonOf(page).then((s) => s.bones as Array<{ id: string; name: string; parent: string | null; length: number; angle: number; min: number; max: number }>);
const names = async (page: Page) => (await bones(page)).map((b) => b.name);

/** Crea un esqueleto de 3 huesos encadenados dibujándolos con el ratón (modo «Dibujar hueso»). */
async function chainOf3(page: Page) {
  await page.getByTestId("tool-rig").click();
  await page.getByTestId("rig-new").click(); // esqueleto vacío, modo editar y «dibujar hueso» activo
  await dragDoc(page, [300, 560], [300, 420]); // raíz
  await dragDoc(page, [300, 420], [420, 340]); // hijo: nace en la cola del anterior
  await dragDoc(page, [420, 340], [560, 300]); // nieto
}

describe("esqueleto: crear y editar", () => {
  it("dibujar huesos arrastrando en el lienzo crea la jerarquía (cada hueso se engancha al anterior)", async () => {
    const ep = await createEpisode(env, { width: 1280, height: 720 });
    const { ctx, page, errors } = await openEditorPage(env, ep.url);
    await chainOf3(page);
    const bs = await bones(page);
    expect(bs).toHaveLength(3);
    expect(bs.map((b) => b.parent)).toEqual([null, bs[0]!.id, bs[1]!.id]);
    // longitud y orientación salen del arrastre: (300,560)→(300,420) = 140 px hacia arriba (-90°)
    expect(Math.round(bs[0]!.length)).toBe(140);
    expect(Math.round(bs[0]!.angle)).toBe(-90);
    const g = await boneGeo(page, bs[1]!.name);
    expect(Math.round(g.head[0])).toBe(300); // enganchado a la cola del padre
    expect(Math.round(g.head[1])).toBe(420);
    expect(Math.round(g.tail[0])).toBe(420);
    expect(AnimationSchema.safeParse(await page.evaluate(() => window.__gas!.model.doc)).success).toBe(true);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it("seleccionar, renombrar, límites, longitud y ángulo desde el panel; reorganizar la jerarquía", async () => {
    const ep = await createEpisode(env, { width: 1280, height: 720 });
    const { ctx, page } = await openEditorPage(env, ep.url);
    await chainOf3(page);
    await page.getByTestId("rig-create").click(); // salir de «dibujar hueso»
    const [a, b, c] = await bones(page);

    await boneRow(page, b!.name).click();
    await page.getByTestId("bone-name").fill("Antebrazo");
    await page.getByTestId("bone-name").blur();
    expect(await names(page)).toContain("Antebrazo");
    await setNum(page, "bone-min", -20);
    await setNum(page, "bone-max", 130);
    await setNum(page, "bone-length", 200);
    await setNum(page, "bone-angle", 10);
    const nb = (await bones(page))[1]!;
    expect([nb.min, nb.max, nb.length, nb.angle]).toEqual([-20, 130, 200, 10]);

    // límites inválidos: el panel NO los acepta y avisa (el valor anterior se conserva)
    await setNum(page, "bone-min", 500);
    expect((await bones(page))[1]!.min).toBe(-20);
    expect(await page.getByTestId("toast").textContent()).toContain("límite mínimo");

    // reparentar: el nieto pasa a colgar directamente del primer hueso, sin moverse en el lienzo
    await boneRow(page, c!.name).click();
    const before = await boneGeo(page, c!.name);
    await page.getByTestId("bone-parent").selectOption(a!.id);
    expect((await bones(page))[2]!.parent).toBe(a!.id);
    const after = await boneGeo(page, c!.name);
    expect(Math.abs(after.head[0] - before.head[0])).toBeLessThan(0.5);
    expect(Math.abs(after.tail[1] - before.tail[1])).toBeLessThan(0.5);
    // un hueso no puede colgar de su propio descendiente: la lista de padres no lo ofrece
    await boneRow(page, a!.name).click();
    const options = await page.getByTestId("bone-parent").locator("option").allTextContents();
    expect(options).not.toContain("Antebrazo");
    await ctx.close();
  });

  it("seleccionar y mover articulaciones y extremos con el ratón; eliminar un hueso elimina a sus descendientes; deshacer lo recupera", async () => {
    const ep = await createEpisode(env, { width: 1280, height: 720 });
    const { ctx, page } = await openEditorPage(env, ep.url);
    await chainOf3(page);
    await page.getByTestId("rig-create").click();
    const [a, b] = await bones(page);

    // clic en el cuerpo del primer hueso lo selecciona
    await dragDoc(page, [300, 500], [300, 500], 1);
    expect(await page.evaluate(() => window.__gas!.model.rig.boneId)).toBe(a!.id);

    // arrastrar el EXTREMO del segundo hueso cambia su longitud y orientación
    await dragDoc(page, [420, 340], [500, 380]);
    const g = await boneGeo(page, b!.name);
    expect(Math.round(g.tail[0])).toBe(500);
    expect(Math.round(g.tail[1])).toBe(380);

    // arrastrar la raíz entera (su articulación) la traslada y los hijos la siguen
    const before = await boneGeo(page, a!.name);
    const childBefore = await boneGeo(page, b!.name);
    await dragDoc(page, before.head, [before.head[0] + 100, before.head[1] - 40]);
    const root = await boneGeo(page, a!.name);
    const child = await boneGeo(page, b!.name);
    expect(Math.round(root.head[0] - before.head[0])).toBe(100);
    expect(Math.round(child.head[0] - childBefore.head[0])).toBe(100); // el hijo sigue

    // un gesto = una entrada de historial
    await page.keyboard.press("Control+z");
    expect(Math.round((await boneGeo(page, a!.name)).head[0])).toBe(Math.round(before.head[0]));

    // eliminar el segundo hueso elimina también al nieto
    await boneRow(page, b!.name).click();
    await page.getByTestId("bone-remove").click();
    expect(await bones(page)).toHaveLength(1);
    expect(await page.getByTestId("toast").textContent()).toContain("2 huesos");
    await page.keyboard.press("Control+z");
    expect(await bones(page)).toHaveLength(3);
    await ctx.close();
  });

  it("la plantilla humanoide es solo un punto de partida: 16 huesos que se pueden quitar, añadir y reorganizar", async () => {
    const ep = await createEpisode(env, { width: 1280, height: 720 });
    const { ctx, page } = await openEditorPage(env, ep.url);
    await page.getByTestId("tool-rig").click();
    await page.getByTestId("rig-humanoid").click();
    const ns = await names(page);
    expect(ns).toHaveLength(16);
    for (const n of ["Cabeza", "Cuello", "Torso", "Cadera", "Brazo superior izq.", "Brazo inferior izq.", "Brazo superior der.", "Brazo inferior der.", "Pierna superior izq.", "Pierna inferior izq.", "Pierna superior der.", "Pierna inferior der.", "Mano izq.", "Mano der.", "Pie izq.", "Pie der."]) expect(ns).toContain(n);
    // quitar un brazo entero (3 huesos)
    await boneRow(page, "Brazo superior der.").click();
    await page.getByTestId("bone-remove").click();
    expect(await bones(page)).toHaveLength(13);
    // añadir huesos nuevos (una coleta colgando de la cabeza) y reorganizar
    await boneRow(page, "Cabeza").click();
    await page.getByTestId("bone-add-child").click();
    await page.getByTestId("bone-name").fill("Coleta");
    await page.getByTestId("bone-name").blur();
    await page.getByTestId("bone-add-child").click(); // hijo de la coleta
    expect(await bones(page)).toHaveLength(15);
    const all = await bones(page);
    const coleta = all.find((x) => x.name === "Coleta")!;
    expect(all.find((x) => x.parent === coleta.id)).toBeDefined();
    await ctx.close();
  });
});

describe("vincular capas y deformar el dibujo", () => {
  /** Brazo de 2 huesos (hombro→codo→muñeca) + un trazo ROJO grueso dibujado a lo largo (un solo trazo recto). */
  async function armSetup(page: Page, mode: "rigid" | "skin") {
    await page.getByTestId("brush-size").fill("40");
    await setColor(page, "#ff0000");
    await mouseStroke(page, line(300, 300, 600, 300, 2)); // UN trazo, tres puntos: hombro, medio, muñeca
    await page.getByTestId("tool-rig").click();
    await page.getByTestId("rig-new").click();
    await dragDoc(page, [300, 300], [450, 300]);
    await dragDoc(page, [450, 300], [600, 300]);
    await page.getByTestId("rig-create").click();
    await page.getByTestId("rig-mode-pose").click();
    const [up, lo] = await bones(page);
    // vincular la capa activa («Líneas»)
    await page.getByTestId("bind-mode").selectOption(mode);
    if (mode === "skin") {
      await page.getByTestId("bind-bone").selectOption(up!.id);
      for (const cb of await page.getByTestId("bind-infl").all()) await cb.check();
    } else await page.getByTestId("bind-bone").selectOption(lo!.id);
    // El esqueleto se dibuja encima del lienzo: para comprobar píxeles del DIBUJO se oculta (función real de la interfaz).
    await page.getByTestId("rig-toggle-show").click();
    return { up: up!, lo: lo! };
  }

  it("deformable: el trazo recto se DOBLA en el codo (la muñeca sigue al antebrazo, el hombro no se mueve)", async () => {
    const ep = await createEpisode(env, { width: 1280, height: 720 });
    const { ctx, page, errors } = await openEditorPage(env, ep.url, { viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
    await page.keyboard.press("o"); // sin papel cebolla
    const { lo } = await armSetup(page, "skin");
    await settle(page);
    // sin pose, todo igual: línea roja horizontal
    expect(isRed(await docPixel(page, 520, 300))).toBe(true);

    const rawBefore = await strokes(page);
    await boneRow(page, lo.name).click();
    await setNum(page, "bone-rot", 90); // el antebrazo gira 90° (de horizontal a vertical hacia abajo)
    await settle(page);
    expect(isWhite(await docPixel(page, 560, 300))).toBe(true); // ya no hay rojo donde estaba la muñeca
    expect(isRed(await docPixel(page, 450, 440))).toBe(true); // el antebrazo cuelga del codo
    expect(isRed(await docPixel(page, 330, 300))).toBe(true); // el hombro/brazo superior se queda
    // curva suave en el codo: en la esquina exterior NO hay el cuadrado de un giro rígido
    expect(isWhite(await docPixel(page, 468, 282))).toBe(true);
    // los datos NO cambian (solo cambia lo que se muestra): el trazo guardado es EXACTAMENTE el que se dibujó
    const raw = await strokes(page);
    expect(raw).toHaveLength(1);
    expect(raw[0]).toEqual(rawBefore[0]);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it("rígido: toda la capa gira alrededor de la articulación de su hueso", async () => {
    const ep = await createEpisode(env, { width: 1280, height: 720 });
    const { ctx, page } = await openEditorPage(env, ep.url, { viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
    await page.keyboard.press("o");
    const { lo } = await armSetup(page, "rigid"); // la capa entera sigue al antebrazo (articulación en el codo)
    await boneRow(page, lo.name).click();
    await setNum(page, "bone-rot", 90);
    await settle(page);
    // la capa entera giró 90° alrededor del codo (450,300): el tramo (300→600,300) pasa a vertical por x=450
    expect(isRed(await docPixel(page, 450, 200))).toBe(true);
    expect(isRed(await docPixel(page, 450, 400))).toBe(true);
    expect(isWhite(await docPixel(page, 330, 300))).toBe(true);
    await ctx.close();
  });

  it("«Ver sin deformar» muestra el arte original; dibujar sobre una capa vinculada solo es posible sin deformar", async () => {
    const ep = await createEpisode(env, { width: 1280, height: 720 });
    const { ctx, page } = await openEditorPage(env, ep.url, { viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
    await page.keyboard.press("o");
    const { lo } = await armSetup(page, "skin");
    await boneRow(page, lo.name).click();
    await setNum(page, "bone-rot", 90);
    await settle(page);
    expect(isWhite(await docPixel(page, 560, 300))).toBe(true);

    // dibujar con la capa vinculada y el personaje deformado: bloqueado, con explicación
    await page.getByTestId("tool-pen").click();
    await mouseStroke(page, line(100, 500, 200, 500));
    expect(await page.getByTestId("toast").textContent()).toContain("vinculada a un esqueleto");
    expect(await strokes(page)).toHaveLength(1);

    // con «Ver sin deformar» se ve el original y SÍ se puede dibujar
    await page.getByTestId("tool-rig").click();
    await page.getByTestId("rig-toggle-rest").click();
    await settle(page);
    expect(isRed(await docPixel(page, 560, 300))).toBe(true);
    await page.getByTestId("tool-pen").click();
    await mouseStroke(page, line(100, 500, 200, 500));
    expect(await strokes(page)).toHaveLength(2);
    await ctx.close();
  });

  it("un hueso con límites no se pasa de su rango aunque se arrastre más; deshacer/rehacer la pose", async () => {
    const ep = await createEpisode(env, { width: 1280, height: 720 });
    const { ctx, page } = await openEditorPage(env, ep.url, { viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
    await page.keyboard.press("o");
    const { lo } = await armSetup(page, "skin");
    await boneRow(page, lo.name).click();
    await page.getByTestId("rig-mode-edit").click();
    await setNum(page, "bone-min", 0);
    await setNum(page, "bone-max", 60);
    await page.getByTestId("rig-mode-pose").click();
    // arrastrar el extremo del antebrazo (600,300) mucho más allá de 60° (hasta abajo del todo)
    await dragDoc(page, [600, 300], [450, 560]);
    expect(Math.round(await poseRot(page, lo.name))).toBe(60); // se queda en el límite
    await setNum(page, "bone-rot", 200);
    expect(await poseRot(page, lo.name)).toBe(60);
    await setNum(page, "bone-rot", -30);
    expect(await poseRot(page, lo.name)).toBe(0);

    await setNum(page, "bone-rot", 45);
    await page.keyboard.press("Control+z");
    expect(Math.round(await poseRot(page, lo.name))).toBe(0);
    await page.keyboard.press("Control+Shift+z");
    expect(Math.round(await poseRot(page, lo.name))).toBe(45);
    await ctx.close();
  });

  it("la rotación se hereda: girar el brazo superior arrastra al antebrazo; ver pesos y contorno de capas vinculadas no rompen nada", async () => {
    const ep = await createEpisode(env, { width: 1280, height: 720 });
    const { ctx, page, errors } = await openEditorPage(env, ep.url, { viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
    await page.keyboard.press("o");
    const { up, lo } = await armSetup(page, "skin");
    await boneRow(page, up.name).click();
    await setNum(page, "bone-rot", 90); // todo el brazo gira alrededor del hombro: queda vertical hacia abajo
    const elbow = await boneGeo(page, lo.name);
    expect(Math.round(elbow.head[0])).toBe(300);
    expect(Math.round(elbow.head[1])).toBe(450);
    expect(Math.round(elbow.tail[1])).toBe(600);
    expect(Math.round(await poseRot(page, lo.name))).toBe(0); // el hijo conserva su giro propio (0) pero se mueve con el padre
    // Pesos de influencia: con el esqueleto visible se pintan puntos de color sobre la capa deformable
    await page.getByTestId("rig-toggle-show").click();
    await page.getByTestId("rig-toggle-weights").click();
    await settle(page);
    const withWeights = await docPixel(page, 300, 520);
    expect(isRed(withWeights)).toBe(false); // hay overlay de pesos/huesos encima
    await page.getByTestId("rig-toggle-weights").click();
    await page.getByTestId("rig-toggle-show").click();
    await settle(page);
    expect(isRed(await docPixel(page, 300, 520))).toBe(true); // sin overlay: el dibujo siguió al esqueleto
    expect(errors).toEqual([]);
    await ctx.close();
  });
});
