import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SHOTS, boneRow, createCharacter, docPixel, line, mouseStroke, openEditorPage, setColor, setNum, settle, startEnv, waitSaved, type Env } from "./helpers";
import { restOf } from "../packages/engine/src";
import { bboxOf, charDoc, layerByGroup, openSection, setRange } from "./char-helpers";

let env: Env;
beforeAll(async () => (env = await startEnv()));
afterAll(() => env.close());

const V = { viewport: { width: 1440, height: 900 } } as const;

async function fresh(name: string) {
  const c = await createCharacter(env, name);
  const r = await openEditorPage(env, c.url, V);
  await r.page.getByTestId("char-build").click();
  return { ...c, ...r };
}

describe("editor de personajes", () => {
  it("crea el cuerpo, edita proporciones (esqueleto + dibujo), y deshacer/rehacer lo restituye", async () => {
    const { page, errors } = await fresh("Prop");
    const d0 = await charDoc(page);
    expect(d0.rigs[0].bones).toHaveLength(16);
    const bodyId = layerByGroup(d0, "cuerpo")!.id;
    const h0 = bboxOf(d0, bodyId).h;
    const thigh = (d: typeof d0) => d.rigs[0].bones.find((b: { name: string }) => b.name === "Pierna superior izq.").length as number;

    await setRange(page, "prop-legs", 1.2);
    const d1 = await charDoc(page);
    expect(d1.character.proportions.legs).toBe(1.2);
    const torsoLen = (d: typeof d0) => d.rigs[0].bones.find((b: { name: string }) => b.name === "Torso").length as number;
    expect(thigh(d1)).toBeGreaterThan(thigh(d0) * 1.04); // piernas más largas…
    expect(torsoLen(d1)).toBeLessThan(torsoLen(d0)); // …a costa del torso: la altura total se conserva
    expect(Math.abs(bboxOf(d1, bodyId).h - h0)).toBeLessThan(2);
    expect(JSON.stringify(d1.frames[0].cells[bodyId])).not.toBe(JSON.stringify(d0.frames[0].cells[bodyId])); // el DIBUJO vinculado se reescaló
    // presets
    await page.getByTestId("prop-preset-corpulento").click();
    const d2 = await charDoc(page);
    expect(d2.character.proportions.build).toBe(0.95);
    expect(d2.character.proportions.shoulders).toBe(1.3);
    expect(bboxOf(d2, bodyId).w).toBeGreaterThan(bboxOf(d0, bodyId).w);
    await page.screenshot({ path: `${SHOTS}/44-editor-proporciones.png` });
    // deshacer ×2 y rehacer ×2
    await page.getByTestId("undo").click();
    expect((await charDoc(page)).character.proportions.legs).toBe(1.2);
    await page.getByTestId("undo").click();
    expect(JSON.stringify((await charDoc(page)).frames[0])).toBe(JSON.stringify(d0.frames[0]));
    await page.getByTestId("redo").click();
    await page.getByTestId("redo").click();
    expect((await charDoc(page)).character.proportions.build).toBe(0.95);
    expect(errors).toEqual([]);
  }, 120_000);

  it("ropa paramétrica: anchura, largo, mangas, bolsillos, cremallera, textura; y la prenda se puede quitar", async () => {
    const { page, errors } = await fresh("Ropa");
    await page.getByTestId("slot-pantalon").click();
    await page.getByTestId("g-apply").click();
    const legW = async () => {
      const d = await charDoc(page);
      const hip = d.rigs[0].bones[0];
      return bboxOf(d, layerByGroup(d, "pantalon")!.id, 0, hip.y + 330).w as number;
    };
    await setRange(page, "g-width", 1);
    const slim = await legW();
    await setRange(page, "g-width", 3.2);
    const baggy = await legW();
    expect(baggy).toBeGreaterThan(slim * 1.5);
    await setRange(page, "g-sag", 0.9);
    await page.getByTestId("g-texture").selectOption("cuadros");
    await page.getByTestId("g-color").fill("#2d3a55");
    await page.getByTestId("g-color").blur();
    let d = await charDoc(page);
    const g = d.character.garments.find((x: { type: string }) => x.type === "pantalon");
    expect(g.params.width).toBe(3.2);
    expect(g.params.texture).toBe("cuadros");
    expect(g.params.color).toBe("#2d3a55");
    expect(layerByGroup(d, "pantalon-det")).toBeTruthy(); // textura = capa recortada a la prenda

    // chaqueta: mangas (0 = no hay capa), largo, cremallera y botones
    await page.getByTestId("slot-chaqueta").click();
    await page.getByTestId("g-type").selectOption("bomber");
    d = await charDoc(page);
    expect(layerByGroup(d, "chaqueta")).toBeTruthy();
    expect(layerByGroup(d, "chaqueta-mangas")).toBeTruthy();
    const jh = (x: typeof d) => bboxOf(x, layerByGroup(x, "chaqueta")!.id).h as number;
    const h1 = jh(d);
    await setRange(page, "g-length", 1.8);
    expect(jh(await charDoc(page))).toBeGreaterThan(h1 * 1.3);
    await setRange(page, "g-sleeve", 0);
    expect(layerByGroup(await charDoc(page), "chaqueta-mangas")).toBeUndefined();
    await setRange(page, "g-sleeve", 1.1);
    await setRange(page, "g-buttons", 5);
    await page.getByTestId("g-zipper").check();
    expect(layerByGroup(await charDoc(page), "chaqueta-mangas")).toBeTruthy();
    // quitar prenda: desaparecen sus capas y su vínculo
    await page.getByTestId("g-remove").click();
    d = await charDoc(page);
    expect(d.layers.some((l: { group?: string }) => l.group?.startsWith("chaqueta"))).toBe(false);
    expect(d.character.garments.some((x: { type: string }) => x.type === "chaqueta")).toBe(false);
    expect(d.rigs[0].bindings.every((b: { layerId: string }) => d.layers.some((l: { id: string }) => l.id === b.layerId))).toBe(true);
    await page.screenshot({ path: `${SHOTS}/45-editor-ropa.png` });
    expect(errors).toEqual([]);
  }, 120_000);

  it("rostro, cabello, accesorios y marcas se generan, se editan a mano y se guardan como expresiones reutilizables", async () => {
    const { page, errors } = await fresh("Rostro");
    await openSection(page, "cp-face");
    await page.getByTestId("face-eye-style").selectOption("intenso");
    await page.getByTestId("face-jaw").selectOption("marcada");
    await page.getByTestId("face-brow-style").selectOption("cortada");
    await page.getByTestId("mark-kind").selectOption("cicatriz-ceja");
    await page.getByTestId("mark-add").click();
    await openSection(page, "cp-hair");
    await page.getByTestId("hair-style").selectOption("largo");
    await page.getByTestId("hair-color").fill("#4a2f22");
    await page.getByTestId("hair-color").blur();
    await openSection(page, "cp-acc");
    await page.getByTestId("acc-hachimaki").click();
    await page.getByTestId("acc-pendientes").click();
    let d = await charDoc(page);
    expect(d.character.look.face.eyeStyle).toBe("intenso");
    expect(d.character.look.hair.style).toBe("largo");
    expect(d.character.look.hair.color).toBe("#4a2f22");
    for (const g of ["ojos", "cejas", "boca", "nariz", "cabeza", "pelo", "pelo-atras", "marcas", "accc-hachimaki", "accc-pendientes"]) expect(layerByGroup(d, g), g).toBeTruthy();

    // expresiones: dibujar un preset, retocarlo con el pincel y guardarlo
    await openSection(page, "cp-expr");
    const sig = async () => JSON.stringify((await charDoc(page)).frames[0].cells[layerByGroup(await charDoc(page), "cejas")!.id]);
    const neutral = await sig();
    await page.getByTestId("expr-preset-enojado").click();
    const angry = await sig();
    expect(angry).not.toBe(neutral);
    // retoque a mano en la capa de la boca (el pincel dibuja SIN deformar)
    const boca = layerByGroup(await charDoc(page), "boca")!.id;
    await page.evaluate((id) => window.__gas!.model.setLayer(id), boca);
    await setColor(page, "#c4232d");
    const hp = restOf(await charDoc(page))!.at("Cabeza", 0.22);
    await page.getByTestId("tool-pen").click();
    await setColor(page, "#12ab34");
    await mouseStroke(page, line(hp[0] - 14, hp[1], hp[0] + 14, hp[1] + 4, 6));
    expect((await charDoc(page)).frames[0].cells[boca].some((s: { color: string }) => s.color === "#12ab34")).toBe(true);
    await page.getByTestId("expr-name").fill("Rugido");
    await page.getByTestId("expr-save").click();
    d = await charDoc(page);
    expect(d.character.expressions.map((e: { name: string }) => e.name)).toEqual(["Rugido"]);
    // otra expresión y volver a la guardada (con el retoque)
    await page.getByTestId("expr-preset-sonrisaLeve").click();
    expect(await sig()).not.toBe(angry);
    await page.getByTestId("expr-apply").click();
    expect(await sig()).toBe(angry);
    const mouth = (await charDoc(page)).frames[0].cells[boca];
    expect(mouth.some((s: { color: string }) => s.color === "#12ab34")).toBe(true); // el retoque manual se conservó en la expresión
    await page.screenshot({ path: `${SHOTS}/46-editor-rostro-expresion.png` });
    // se puede eliminar
    await page.getByTestId("expr-del").click();
    expect((await charDoc(page)).character.expressions).toHaveLength(0);
    expect(errors).toEqual([]);
  }, 120_000);

  it("capas con acabado: sombra recortada a la prenda, desenfoque, opacidad y relleno; pixeles reales en el lienzo", async () => {
    const { page, errors } = await fresh("Acabado");
    // una prenda roja y, encima, una capa de sombra recortada
    await page.getByTestId("slot-camiseta").click();
    await page.getByTestId("g-color").fill("#ff0000"); await page.getByTestId("g-color").blur();
    await page.getByTestId("g-apply").click();
    let d = await charDoc(page);
    const tee = layerByGroup(d, "camiseta")!;
    await page.evaluate((id) => window.__gas!.model.setLayer(id), tee.id);
    await openSection(page, "cp-fx");
    await page.getByTestId("fx-add-shadow").click(); // crea «Sombra: Camiseta» (multiplicar + recortada) y selecciona Relleno
    d = await charDoc(page);
    const shadow = d.layers.find((l: { name: string }) => l.name.startsWith("Sombra: Camiseta"));
    expect(shadow).toMatchObject({ blend: "multiply", clip: true });
    expect(d.layers[d.layers.findIndex((l: { id: string }) => l.id === shadow.id) - 1].id).toBe(tee.id);
    // con la herramienta Relleno se pinta una forma cerrada GRANDE que se sale de la camiseta
    const [cx, cy] = restOf(d)!.at("Torso", 0.5);
    await setColor(page, "#000000");
    await page.getByTestId("tool-fill").click();
    await mouseStroke(page, [[cx - 300, cy - 100], [cx + 300, cy - 100], [cx + 300, cy + 120], [cx - 300, cy + 120], [cx - 300, cy - 100]]);
    d = await charDoc(page);
    expect(d.frames[0].cells[shadow.id][0].kind).toBe("fill");
    await settle(page);
    const inside = await docPixel(page, cx, cy);
    const outside = await docPixel(page, cx + 250, cy);
    expect(inside[0], "sombra multiplicada sobre rojo → oscuro").toBeLessThan(150);
    expect(outside, "fuera de la prenda no se pinta (recorte)").toEqual([255, 255, 255]);
    // quitar el recorte → se sale de la prenda
    await page.evaluate((id) => window.__gas!.model.setLayer(id), shadow.id);
    await page.getByTestId("fx-clip").uncheck();
    await settle(page);
    expect((await docPixel(page, cx + 250, cy))[0]).toBeLessThan(150);
    await page.getByTestId("fx-clip").check();
    // opacidad: con 0,5 sobre el rojo se aclara respecto a 1
    const dark = (await docPixel(page, cx, cy))[0];
    await setRange(page, "fx-opacity", 0.2);
    expect((await docPixel(page, cx, cy))[0]).toBeGreaterThan(dark + 30);
    // desenfoque: el borde de la camiseta recortada se suaviza (valores intermedios cerca del borde)
    await setRange(page, "fx-opacity", 1);
    await setRange(page, "fx-blur", 12);
    expect(((await charDoc(page)).layers.find((l: { id: string }) => l.id === shadow.id)).blur).toBe(12);
    await page.screenshot({ path: `${SHOTS}/47-editor-acabado.png` });
    // deshacer el relleno elimina la forma
    expect(errors).toEqual([]);
  }, 120_000);

  it("las vistas son dibujos independientes y guardar/recuperar conserva todo (personaje, referencias, expresiones)", async () => {
    const { page, id, errors, ctx } = await fresh("Vistas");
    await page.getByTestId("slot-pantalon").click();
    await page.getByTestId("g-apply").click();
    const front0 = JSON.stringify((await charDoc(page)).frames[0]);
    // vista lateral: dibujar un trazo
    await page.getByTestId("view-side").click();
    expect(await page.evaluate(() => window.__gas!.model.frameIndex)).toBe(2);
    await page.getByTestId("tool-pen").click();
    const sketch = (await charDoc(page)).layers.find((l: { part?: string }) => l.part === "sketch");
    await page.evaluate((i) => window.__gas!.model.setLayer(i), sketch.id);
    await setColor(page, "#3355ff");
    await mouseStroke(page, line(400, 300, 600, 500, 6));
    let d = await charDoc(page);
    expect(d.frames[2].cells[sketch.id]).toHaveLength(1);
    expect(JSON.stringify(d.frames[0])).toBe(front0); // la vista frontal no cambió
    expect(d.frames[1].cells).toEqual({}); expect(d.frames[3].cells).toEqual({});
    // copiar la vista frontal a la espalda como punto de partida (no la gira)
    await page.getByTestId("view-back").click();
    await openSection(page, "cp-views");
    await page.getByTestId("view-copy-from").selectOption("front");
    await page.getByTestId("view-copy").click();
    d = await charDoc(page);
    expect(Object.keys(d.frames[3].cells).length).toBeGreaterThan(2);
    expect(d.frames[3].cells[layerByGroupId(d, "pantalon")]).toEqual(d.frames[0].cells[layerByGroupId(d, "pantalon")]);
    // referencia: subir una imagen (1×1 px) a la vista actual; se guarda en la biblioteca y no se exporta
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    await page.getByTestId("ref-file").setInputFiles({ name: "boceto.png", mimeType: "image/png", buffer: png });
    await page.waitForFunction(() => (window.__gas!.model.doc.character?.refs.length ?? 0) === 1);
    expect((await (await fetch(`${env.base}/api/characters/${id}/files`)).json()).files).toHaveLength(1);
    await waitSaved(page);

    // «cerrar y abrir»: recarga completa → mismo documento
    const saved = await charDoc(page);
    await page.reload();
    await page.getByTestId("stage").waitFor();
    await settle(page);
    const back = await charDoc(page);
    expect({ ...back, revision: 0 }).toEqual({ ...saved, revision: 0 });
    expect(back.rigs[0].bindings.length).toBe(saved.rigs[0].bindings.length);
    expect(back.character.refs).toHaveLength(1);
    await ctx.close();
    expect(errors).toEqual([]);
  }, 120_000);

  it("compatible con el rigging: el personaje se posa con los huesos, y ropa, cuerpo y rostro siguen al esqueleto", async () => {
    const { page, errors } = await fresh("Pose");
    for (const s of ["pantalon", "camiseta", "chaqueta"]) { await page.getByTestId(`slot-${s}`).click(); await page.getByTestId("g-apply").click(); }
    const before = await page.screenshot({ clip: { x: 360, y: 60, width: 500, height: 640 } });
    await page.getByTestId("tool-rig").click();
    await page.getByTestId("rig-mode-pose").click();
    await page.getByTestId("rig-toggle-show").click(); // sin esqueleto superpuesto
    await boneRow(page, "Brazo superior izq.").click();
    await setNum(page, "bone-rot", -100);
    await boneRow(page, "Brazo inferior izq.").click();
    await setNum(page, "bone-rot", 40);
    await boneRow(page, "Cabeza").click();
    await setNum(page, "bone-rot", 12);
    await page.getByTestId("key-save").click();
    const after = await page.screenshot({ clip: { x: 360, y: 60, width: 500, height: 640 } });
    expect(Buffer.compare(before, after)).not.toBe(0);
    const d = await charDoc(page);
    // cada capa generada está vinculada (nada se queda atrás)
    const generated = d.layers.filter((l: { group?: string }) => l.group);
    const bound = new Set(d.rigs[0].bindings.map((b: { layerId: string }) => b.layerId));
    for (const l of generated) expect(bound.has(l.id), l.name).toBe(true);
    // guardar la pose con nombre y reutilizarla en otro fotograma (vista)
    await page.getByTestId("tool-pen").click();
    await openSection(page, "cp-poses");
    await page.getByTestId("pose-name").fill("Saludo");
    await page.getByTestId("pose-save").click();
    expect((await charDoc(page)).character.poses.map((p: { name: string }) => p.name)).toEqual(["Saludo"]);
    await page.screenshot({ path: `${SHOTS}/48-editor-pose.png` });
    expect(errors).toEqual([]);
  }, 120_000);
});

const layerByGroupId = (d: { layers: Array<{ id: string; group?: string }> }, g: string) => d.layers.find((l) => l.group === g)!.id;
void [boneRow, setNum];
