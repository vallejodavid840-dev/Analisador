import { describe, expect, it } from "vitest";
import { AnimationSchema, DEFAULT_PROPORTIONS, parseAnimation, createAnimation, type Animation, type Proportions } from "@gas/core";
import {
  EXPRESSIONS, DEFAULT_FACE, DEFAULT_GARMENT, DEFAULT_HAIR, applyExpression, applyGarment, removeGarment, applyInstanceExpression, applyInstancePose, applyProportions, applySavedPose, applySpecs, bodyLayers, copyViewLayers,
  deleteExpression, drawExpressionPreset, ensureSkeleton, faceLayers, garmentLayers, hairLayers, headLayers, insertCharacter, newCharacterDoc, planBody, planBones, poseAtFrame, posedFrame,
  removeInstance, restOf, restStates, saveExpression, savePoseFromFrame, setBonePose, viewFrameIndex, VIEW_ORDER, type GarmentParams,
} from "../src";

function fullCharacter(props: Partial<Proportions> = {}): Animation {
  let d = newCharacterDoc("pj1");
  d = { ...d, character: { ...d.character!, proportions: { ...DEFAULT_PROPORTIONS, ...props } } };
  d = ensureSkeleton(d);
  const r = restOf(d)!;
  d = applySpecs(d, 0, bodyLayers(r, { skin: "#f0c8a8" }));
  d = applySpecs(d, 0, headLayers(r, DEFAULT_FACE));
  for (const t of ["pantalon", "zapatillas", "camiseta", "chaqueta"] as const) d = applySpecs(d, 0, garmentLayers(r, { ...DEFAULT_GARMENT[t] } as GarmentParams));
  d = applySpecs(d, 0, faceLayers(r, DEFAULT_FACE, EXPRESSIONS.neutral!.p));
  d = applySpecs(d, 0, hairLayers(r, DEFAULT_HAIR));
  return d;
}

const bbox = (d: Animation, layerId: string, fi = 0) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of d.frames[fi]!.cells[layerId] ?? []) for (let i = 0; i < s.points.length; i += 3) { x0 = Math.min(x0, s.points[i]!); x1 = Math.max(x1, s.points[i]!); y0 = Math.min(y0, s.points[i + 1]!); y1 = Math.max(y1, s.points[i + 1]!); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
};
const layerByGroup = (d: Animation, g: string) => d.layers.find((l) => l.group === g)!;

describe("personaje: documento y generadores", () => {
  it("un personaje completo es un documento válido con 4 vistas independientes y su esqueleto", () => {
    const d = fullCharacter();
    expect(() => AnimationSchema.parse(d)).not.toThrow();
    expect(parseAnimation(JSON.parse(JSON.stringify(d))).layers.length).toBe(d.layers.length);
    expect(d.character!.views.map((v) => v.kind)).toEqual([...VIEW_ORDER]);
    expect(d.frames).toHaveLength(4);
    expect(d.rigs![0]!.bones).toHaveLength(16);
    expect(d.layers.length).toBeGreaterThan(15);
    // las demás vistas están vacías: no se finge que la vista frontal se pueda girar
    for (let i = 1; i < 4; i++) expect(Object.values(d.frames[i]!.cells).flat()).toHaveLength(0);
  });

  it("las capas se apilan en el orden correcto y las de sombra recortan a su base", () => {
    const d = fullCharacter();
    const keys = d.layers.map((l) => l.group);
    expect(keys.indexOf("cuerpo")).toBeLessThan(keys.indexOf("pantalon"));
    expect(keys.indexOf("pantalon")).toBeLessThan(keys.indexOf("camiseta"));
    expect(keys.indexOf("camiseta")).toBeLessThan(keys.indexOf("chaqueta"));
    expect(keys.indexOf("chaqueta")).toBeLessThan(keys.indexOf("cabeza"));
    expect(keys.indexOf("cabeza")).toBeLessThan(keys.indexOf("pelo"));
    for (const l of d.layers.filter((x) => x.group?.endsWith("-sombra"))) {
      expect(l.clip).toBe(true);
      expect(l.blend).toBe("multiply");
      const i = d.layers.indexOf(l);
      expect(d.layers[i - 1]!.group, `base de ${l.group}`).toBe(l.group!.replace("-sombra", ""));
    }
  });

  it("el mismo preset con la misma semilla genera el mismo peinado; otra semilla, otro", () => {
    const r = restOf(fullCharacter())!;
    const pts = (seed: number) => JSON.stringify(hairLayers(r, { ...DEFAULT_HAIR, seed })[0]!.strokes.map((s) => s.points));
    expect(pts(5)).toBe(pts(5));
    expect(pts(5)).not.toBe(pts(6));
  });

  it("regenerar una prenda reemplaza su dibujo en vez de duplicar capas", () => {
    let d = fullCharacter();
    const n = d.layers.length;
    const r = restOf(d)!;
    d = applySpecs(d, 0, garmentLayers(r, { ...DEFAULT_GARMENT.pantalon, width: 3 }));
    expect(d.layers.length).toBe(n);
  });

  it("la anchura del pantalón cambia de verdad la silueta (baggy mucho más ancho que ajustado)", () => {
    const wid = (w: number) => {
      let d = fullCharacter();
      d = applyGarment(d, 0, { ...DEFAULT_GARMENT.pantalon, width: w, texture: "liso" }, restOf(d)!);
      const ys = restOf(d)!.plan.hipY + restOf(d)!.plan.thigh; // solo de la rodilla para abajo: ahí manda el ancho de pernera
      let x0 = Infinity, x1 = -Infinity;
      for (const s of d.frames[0]!.cells[layerByGroup(d, "pantalon").id]!) for (let i = 0; i < s.points.length; i += 3) if (s.points[i + 1]! > ys) { x0 = Math.min(x0, s.points[i]!); x1 = Math.max(x1, s.points[i]!); }
      return x1 - x0;
    };
    expect(wid(3.2)).toBeGreaterThan(wid(1) * 1.5);
  });

  it("largo y mangas de la chaqueta se controlan por parámetros", () => {
    const at = (len: number, sleeve: number) => {
      let d = fullCharacter();
      d = applyGarment(d, 0, { ...DEFAULT_GARMENT.chaqueta, length: len, sleeve }, restOf(d)!);
      const m = d.layers.find((l) => l.group === "chaqueta-mangas");
      return { jacketH: bbox(d, layerByGroup(d, "chaqueta").id).h, sleeveH: m ? bbox(d, m.id).h : 0 };
    };
    expect(at(2, 1).jacketH).toBeGreaterThan(at(1, 1).jacketH * 1.3);
    expect(at(1.4, 1.1).sleeveH).toBeGreaterThan(at(1.4, 0.45).sleeveH * 1.4);
    expect(at(1.4, 0).sleeveH).toBe(0); // sin mangas = la capa de mangas desaparece
    expect(removeGarment(applyGarment(fullCharacter(), 0, { ...DEFAULT_GARMENT.chaqueta }, restOf(fullCharacter())!), "chaqueta").layers.some((l) => l.group?.startsWith("chaqueta"))).toBe(false);
  });

  it("las expresiones cambian ojos, cejas y boca (formas distintas) y son parte del dibujo", () => {
    const d = fullCharacter();
    const r = restOf(d)!;
    const sig = (k: string) => JSON.stringify(faceLayers(r, DEFAULT_FACE, EXPRESSIONS[k]!.p).flatMap((s) => s.strokes.map((x) => x.points)));
    const keys = Object.keys(EXPRESSIONS);
    expect(keys).toHaveLength(9);
    expect(new Set(keys.map(sig)).size).toBe(9);
  });
});

describe("personaje: proporciones", () => {
  it("el plan respeta la altura y la cabeza (cabezas de alto) sin proporciones infantiles", () => {
    for (const heads of [6.8, 7.6, 8.2]) {
      const pl = planBody({ ...DEFAULT_PROPORTIONS, heads });
      expect(pl.H / pl.head).toBeCloseTo(heads, 5);
      expect(pl.H - pl.foot - pl.thigh - pl.shin - pl.pelvis - pl.torso - pl.neck - pl.head).toBeCloseTo(0, 5); // todo suma la altura
      expect(pl.groundY - pl.hipY).toBeCloseTo(pl.foot + pl.thigh + pl.shin, 5);
    }
    expect(DEFAULT_PROPORTIONS.heads).toBeGreaterThanOrEqual(7); // por defecto: anime adolescente/adulto
  });

  it("piernas más largas alargan los huesos y el dibujo vinculado; los hombros más anchos ensanchan el torso", () => {
    const d0 = fullCharacter();
    const legs0 = bbox(d0, layerByGroup(d0, "pantalon").id).h;
    const torsoW0 = bbox(d0, layerByGroup(d0, "chaqueta").id).w;
    const d1 = applyProportions(d0, { ...d0.character!.proportions, legs: 1.2, shoulders: 1.3 });
    const thigh = (d: Animation) => d.rigs![0]!.bones.find((b) => b.name === "Pierna superior izq.")!.length;
    expect(thigh(d1)).toBeGreaterThan(thigh(d0));
    expect(bbox(d1, layerByGroup(d1, "pantalon").id).h).toBeGreaterThan(legs0);
    expect(bbox(d1, layerByGroup(d1, "chaqueta").id).w).toBeGreaterThan(torsoW0);
    expect(() => AnimationSchema.parse(d1)).not.toThrow();
    // el esqueleto nuevo coincide con el plan de las proporciones nuevas
    const pl = planBody(d1.character!.proportions);
    expect(thigh(d1)).toBeCloseTo(pl.thigh, 2);
  });

  it("volver a las proporciones originales casi restituye el dibujo (ida y vuelta)", () => {
    const d0 = fullCharacter();
    const p0 = d0.character!.proportions;
    const back = applyProportions(applyProportions(d0, { ...p0, heads: 8.4, legs: 1.15, build: 0.8 }), p0);
    for (const g of ["pantalon", "cuerpo", "chaqueta", "pelo"]) {
      const a = bbox(d0, layerByGroup(d0, g).id), b = bbox(back, layerByGroup(back, g).id);
      expect(Math.abs(a.w - b.w), g).toBeLessThan(a.w * 0.08);
      expect(Math.abs(a.h - b.h), g).toBeLessThan(a.h * 0.08);
    }
  });

  it("el cambio de proporciones mantiene el esqueleto con sus vínculos y no rompe la pose", () => {
    let d = applyProportions(fullCharacter(), { ...DEFAULT_PROPORTIONS, heads: 8, arms: 1.15 });
    const sk = d.rigs![0]!;
    expect(sk.bindings.length).toBeGreaterThan(10);
    const arm = sk.bones.find((b) => b.name === "Brazo superior izq.")!;
    d = setBonePose(d, 0, sk.id, arm.id, { r: -80 });
    expect(poseAtFrame(d, 0, sk.id).get(arm.id)!.r).toBeCloseTo(-80, 5);
    expect(posedFrame(d, 0)).not.toBe(d.frames[0]);
  });
});

describe("personaje: expresiones, poses y vistas", () => {
  it("guardar y reaplicar una expresión restituye exactamente ojos, cejas y boca", () => {
    let d = fullCharacter();
    const r = restOf(d)!;
    d = drawExpressionPreset(d, 0, DEFAULT_FACE, EXPRESSIONS.enojado!.p, r);
    const angryBrows = d.frames[0]!.cells[layerByGroup(d, "cejas").id];
    const { doc: d2, id } = saveExpression(d, 0, "Enfado fuerte");
    d = drawExpressionPreset(d2, 0, DEFAULT_FACE, EXPRESSIONS.sonrisaLeve!.p, r);
    expect(d.frames[0]!.cells[layerByGroup(d, "cejas").id]).not.toBe(angryBrows);
    d = applyExpression(d, 0, id);
    expect(d.frames[0]!.cells[layerByGroup(d, "cejas").id]).toEqual(angryBrows);
    // reguardar con el mismo nombre actualiza, no duplica
    expect(saveExpression(d, 0, "enfado fuerte").doc.character!.expressions).toHaveLength(1);
    expect(deleteExpression(d2, id).character!.expressions).toHaveLength(0);
  });

  it("una pose guardada se reaplica como keyframe en otro fotograma", () => {
    let d = fullCharacter();
    const sk = d.rigs![0]!;
    const arm = sk.bones.find((b) => b.name === "Brazo superior der.")!;
    d = setBonePose(d, 0, sk.id, arm.id, { r: 70 });
    d = savePoseFromFrame(d, 0, "Brazo arriba");
    const id = d.character!.poses[0]!.id;
    d = applySavedPose(d, 2, id);
    expect(d.frames[2]!.poses![sk.id]!.bones[arm.id]!.r).toBe(70);
  });

  it("las vistas son dibujos independientes: copiar es solo un punto de partida", () => {
    const d = fullCharacter();
    expect(viewFrameIndex(d, "side")).toBe(2);
    const c = copyViewLayers(d, "front", "side");
    expect(Object.keys(c.frames[2]!.cells).length).toBeGreaterThan(10);
    expect(c.frames[1]!.cells).toEqual({});
  });

  it("cada vista conserva su pose de reposo propia: posar la frontal no afecta a las demás", () => {
    let d = fullCharacter();
    const sk = d.rigs![0]!;
    const arm = sk.bones.find((b) => b.name === "Brazo superior izq.")!;
    d = setBonePose(d, 0, sk.id, arm.id, { r: -90 });
    expect(poseAtFrame(d, 2, sk.id).get(arm.id)!.r).toBe(0);
  });
});

describe("personaje: insertar en un episodio", () => {
  const ep = () => {
    const e = createAnimation({ episodeId: "ep1", fps: 12, width: 1280, height: 720 });
    return { ...e, frames: [...e.frames, { ...e.frames[0]!, id: "f2" }, { ...e.frames[0]!, id: "f3" }] };
  };

  it("copia capas, dibujo, esqueleto con vínculos, expresiones y poses; coloca y escala al personaje", () => {
    let c = fullCharacter();
    const r = restOf(c)!;
    c = saveExpression(drawExpressionPreset(c, 0, DEFAULT_FACE, EXPRESSIONS.sorpresa!.p, r), 0, "Sorpresa").doc;
    const sk = c.rigs![0]!;
    c = setBonePose(c, 0, sk.id, sk.bones[4]!.id, { r: -50 });
    c = savePoseFromFrame(c, 0, "Saludo");
    const e0 = ep();
    const { doc, instanceId } = insertCharacter(e0, c, { characterId: "pj1", name: "Kenji", view: "front", heightPx: 500, feet: [640, 680] });
    expect(() => AnimationSchema.parse(doc)).not.toThrow();
    const inst = doc.instances!.find((i) => i.id === instanceId)!;
    expect(inst.layerIds.length).toBe(c.layers.filter((l) => l.part !== "sketch").length);
    expect(doc.layers.length).toBe(e0.layers.length + inst.layerIds.length);
    expect(doc.rigs).toHaveLength(1);
    expect(doc.rigs![0]!.bindings.length).toBe(sk.bindings.length);
    expect(doc.layers.filter((l) => l.group === "Kenji").length).toBe(inst.layerIds.length);
    // todos los dibujos del episodio llevan al personaje
    for (const f of doc.frames) expect(Object.keys(f.cells).length).toBeGreaterThan(10);
    // tamaño y colocación: 500 px de alto, pies en y=680
    const ys: number[] = [];
    for (const lid of inst.layerIds) for (const s of doc.frames[0]!.cells[lid] ?? []) for (let i = 1; i < s.points.length; i += 3) ys.push(s.points[i]!);
    const top = Math.min(...ys);
    expect(680 - top).toBeGreaterThan(470);
    expect(680 - top).toBeLessThan(560);
    // expresión y pose copiadas, reaplicables
    expect(inst.expressions.map((x) => x.name)).toEqual(["Sorpresa"]);
    expect(inst.poses.map((x) => x.name)).toEqual(["Saludo"]);
    const withExpr = applyInstanceExpression(doc, instanceId, inst.expressions[0]!.id, 1, 2);
    const eyes = doc.layers.find((l) => l.group === "Kenji" && l.part === "eyes")!;
    expect(withExpr.frames[1]!.cells[eyes.id]).toEqual(inst.expressions[0]!.cells[eyes.id]);
    expect(withExpr.frames[0]!.cells[eyes.id]).toBe(doc.frames[0]!.cells[eyes.id]); // el dibujo 1 no cambia
    const posed = applyInstancePose(doc, instanceId, inst.poses[0]!.id, 1);
    expect(posed.frames[1]!.poses![inst.skeletonId!]).toBeDefined();
    // el personaje insertado es una copia autónoma: se puede quitar entero
    const gone = removeInstance(doc, instanceId);
    expect(gone.layers).toEqual(e0.layers);
    expect(gone.rigs).toBeUndefined();
    expect(gone.instances).toBeUndefined();
  });

  it("insertar dos veces el mismo personaje da dos copias independientes con ids distintos", () => {
    const c = fullCharacter();
    const a = insertCharacter(ep(), c, { characterId: "pj1", name: "A", view: "front", feet: [300, 680] });
    const b = insertCharacter(a.doc, c, { characterId: "pj1", name: "B", view: "front", feet: [900, 680] });
    expect(b.doc.rigs).toHaveLength(2);
    expect(new Set(b.doc.layers.map((l) => l.id)).size).toBe(b.doc.layers.length);
  });

  it("las vistas distintas de la frontal se insertan sin esqueleto", () => {
    let c = fullCharacter();
    c = copyViewLayers(c, "front", "side");
    const { doc } = insertCharacter(ep(), c, { characterId: "pj1", name: "Lado", view: "side" });
    expect(doc.rigs).toBeUndefined();
    expect(doc.instances![0]!.skeletonId).toBeNull();
  });

  it("no cabe más de lo que permite el formato (capas) y avisa", () => {
    const c = fullCharacter();
    let e = ep();
    const per = c.layers.filter((l) => l.part !== "sketch").length;
    const fit = Math.floor((128 - e.layers.length) / per);
    for (let i = 0; i < fit; i++) e = insertCharacter(e, c, { characterId: "p", name: `P${i}`, view: "front" }).doc;
    expect(() => insertCharacter(e, c, { characterId: "p", name: "Sobra", view: "front" })).toThrow(/capas/);
  });
});

void restStates; void planBones;
