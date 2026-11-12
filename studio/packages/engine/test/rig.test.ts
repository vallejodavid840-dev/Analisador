import { describe, expect, it } from "vitest";
import { SkeletonSchema, createAnimation, shortId, AnimationSchema, type Animation, type Bone, type Stroke } from "@gas/core";
import {
  EngineError, History, _clearRigMemo, _rigMemoStats, addBone, addChildBone, ancestors, bindingOfLayer, boneMatrix, childrenOf, clampRotation, copyPose, createHumanoid, createSkeleton,
  deformStrokes, densify, deleteFrame, descendants, duplicateFrame, easeValue, frameStartTicks, hasKey, hasRig, hitBone, keyFrames, moveBoneHead, moveStrokes, pastePose, pointWeights,
  poseStates, posedFrame, removeBone, removeLayer, removeSkeleton, reparentBone, resetPose, resolveBones, resolvePose, restPose, restStates, setBinding, setBonePose, setBoneTail, setKeyEase,
  setPose, skinMatrices, syncLayers, toDeg, toRad, updateBone, addStroke, setHold, addFrame, type Vec,
} from "../src";

const near = (a: number, b: number, d = 1e-6) => expect(Math.abs(a - b), `${a} ≈ ${b}`).toBeLessThan(d);
const nearV = (a: readonly number[], b: readonly number[], d = 1e-6) => a.forEach((v, i) => near(v, b[i]!, d));

const bone = (id: string, parent: string | null, o: Partial<Bone> = {}): Bone => ({ id, name: id, parent, x: 0, y: 0, ax: 1, ay: 0, angle: 0, length: 100, min: -180, max: 180, ...o });
const stroke = (points: number[], id = shortId()): Stroke => ({ id, kind: "pen", color: "#000000", size: 8, opacity: 1, sens: 0, points });

/** Brazo: hombro (100,100) → codo (200,100) → muñeca (300,100), apuntando a +x. */
const arm = (): { a: Animation; skId: string; layerId: string } => {
  let a = createAnimation({ episodeId: "e", fps: 24, width: 800, height: 600 });
  const bones = [bone("up", null, { x: 100, y: 100, angle: 0, length: 100 }), bone("lo", "up", { length: 100 })];
  const r = createSkeleton(a, "Brazo", bones);
  a = r.doc;
  return { a, skId: r.skeletonId, layerId: a.layers[1]!.id };
};
const sk = (a: Animation) => a.rigs![0]!;

describe("jerarquía y transformaciones de huesos", () => {
  it("la geometría de reposo encadena cabeza→cola a través de los padres", () => {
    const { a } = arm();
    const R = restStates(sk(a));
    nearV(R.get("up")!.head, [100, 100]);
    nearV(R.get("up")!.tail, [200, 100]);
    nearV(R.get("lo")!.head, [200, 100]); // anclado en la cola del padre (ax=1)
    nearV(R.get("lo")!.tail, [300, 100]);
  });

  it("el punto de anclaje (ax, ay) coloca al hijo a lo largo y a un lado del padre", () => {
    const s = { bones: [bone("p", null, { x: 0, y: 0, angle: 90, length: 200 }), bone("c", "p", { ax: 0.5, ay: 30, angle: 0, length: 50 })] };
    const R = restStates(s);
    // padre apunta hacia abajo (+y). A mitad de su longitud: (0,100). Su normal es (-1,0): ay=30 → x=-30
    nearV(R.get("c")!.head, [-30, 100]);
    near(R.get("c")!.angle, Math.PI / 2); // hereda la orientación del padre (0 relativo)
  });

  it("rotación heredada: girar el padre arrastra a toda la cadena", () => {
    const { a } = arm();
    const P = poseStates(sk(a), resolveBones(sk(a), { up: { r: 90 } }));
    nearV(P.get("up")!.tail, [100, 200]); // 90° horario en pantalla: de +x a +y
    nearV(P.get("lo")!.head, [100, 200]);
    nearV(P.get("lo")!.tail, [100, 300]); // el antebrazo sigue al brazo
  });

  it("rotación individual: girar solo el hijo no mueve al padre", () => {
    const { a } = arm();
    const P = poseStates(sk(a), resolveBones(sk(a), { lo: { r: 90 } }));
    nearV(P.get("up")!.tail, [200, 100]);
    nearV(P.get("lo")!.head, [200, 100]);
    nearV(P.get("lo")!.tail, [200, 200]);
  });

  it("la raíz admite traslación y los hijos la heredan", () => {
    const { a } = arm();
    const P = poseStates(sk(a), resolveBones(sk(a), { up: { r: 0, x: 30, y: -10 } }));
    nearV(P.get("up")!.head, [130, 90]);
    nearV(P.get("lo")!.tail, [330, 90]);
  });

  it("la matriz de cada hueso lleva su cabeza y su cola de reposo exactamente a la pose", () => {
    const { a } = arm();
    const pose = resolveBones(sk(a), { up: { r: 35, x: 12, y: 7 }, lo: { r: -50 } });
    const R = restStates(sk(a));
    const P = poseStates(sk(a), pose);
    const M = skinMatrices(sk(a), P);
    for (const id of ["up", "lo"]) {
      const m = M.get(id)!;
      for (const key of ["head", "tail"] as const) {
        const p = R.get(id)![key];
        nearV([m.a * p[0] + m.c * p[1] + m.e, m.b * p[0] + m.d * p[1] + m.f], P.get(id)![key], 1e-9);
      }
    }
  });

  it("sin pose, las matrices son la identidad", () => {
    const { a } = arm();
    const m = boneMatrix(restStates(sk(a)).get("up")!, poseStates(sk(a), restPose(sk(a))).get("up")!);
    nearV([m.a, m.b, m.c, m.d, m.e, m.f], [1, 0, 0, 1, 0, 0], 1e-12);
  });

  it("descendientes y ancestros", () => {
    const s = { bones: [bone("a", null), bone("b", "a"), bone("c", "b"), bone("d", "a")] };
    expect(descendants(s, "b").sort()).toEqual(["b", "c"]);
    expect(descendants(s, "a").sort()).toEqual(["a", "b", "c", "d"]);
    expect(ancestors(s, "c")).toEqual(["b", "a"]);
    expect(childrenOf(s, "a").map((b) => b.id)).toEqual(["b", "d"]);
  });

  it("el esquema rechaza ciclos, padres inexistentes y límites invertidos", () => {
    const ok = { id: "s", name: "S", bindings: [] as never[] };
    expect(SkeletonSchema.safeParse({ ...ok, bones: [bone("a", null), bone("b", "a")] }).success).toBe(true);
    expect(SkeletonSchema.safeParse({ ...ok, bones: [bone("b", "a"), bone("a", null)] }).success).toBe(false); // padre después del hijo
    expect(SkeletonSchema.safeParse({ ...ok, bones: [bone("a", "a")] }).success).toBe(false); // se autoreferencia
    expect(SkeletonSchema.safeParse({ ...ok, bones: [bone("a", null, { min: 10, max: -10 })] }).success).toBe(false);
    expect(SkeletonSchema.safeParse({ ...ok, bones: [bone("a", null), bone("a", null)] }).success).toBe(false); // id duplicado
  });
});

describe("límites articulares", () => {
  it("clampRotation y resolveBones recortan al rango", () => {
    const b = { min: -30, max: 90 };
    expect([clampRotation(b, -100), clampRotation(b, 45), clampRotation(b, 200)]).toEqual([-30, 45, 90]);
    const { a } = arm();
    const lim = updateBone(a, a.rigs![0]!.id, "lo", { min: 0, max: 120 });
    const p = resolveBones(sk(lim), { lo: { r: -40 }, up: { r: 500 } });
    expect(p.get("lo")!.r).toBe(0);
    expect(p.get("up")!.r).toBe(180); // el límite por defecto
  });

  it("los límites se aplican también al interpolar y a keys guardados con límites anteriores", () => {
    let { a, skId } = arm();
    a = setPose(a, 0, skId, { up: { r: 0 }, lo: { r: 0 } });
    a = addFrame(a, 0).doc;
    a = setPose(a, 1, skId, { up: { r: 0 }, lo: { r: 160 } }); // permitido: límites ±180
    a = updateBone(a, skId, "lo", { min: 0, max: 100 }); // luego se endurece el límite
    expect(resolvePose(a.frames, sk(a), 1).get("lo")!.r).toBe(100);
    a = addFrame(a, 0).doc; // intermedio (índice 1): interpolado 80 → dentro
    expect(resolvePose(a.frames, sk(a), 1).get("lo")!.r).toBeLessThanOrEqual(100);
  });

  it("setBonePose respeta los límites", () => {
    let { a, skId } = arm();
    a = updateBone(a, skId, "lo", { min: -10, max: 20 });
    a = setBonePose(a, 0, skId, "lo", { r: 90 });
    expect(a.frames[0]!.poses![skId]!.bones["lo"]!.r).toBe(20);
  });

  it("updateBone valida: nombre vacío, longitud, límites invertidos, no finitos", () => {
    const { a, skId } = arm();
    for (const bad of [{ name: "  " }, { length: 0 }, { min: 50, max: 10 }, { angle: NaN }, { ax: Infinity }]) expect(() => updateBone(a, skId, "up", bad)).toThrowError(EngineError);
    expect(() => updateBone(a, skId, "nada", { name: "x" })).toThrowError(/no existe/);
  });
});

describe("keyframes e interpolación", () => {
  /** 5 fotogramas con duraciones 1,1,2,1,3: ticks de inicio 0,1,2,4,5. */
  const timeline = () => {
    let { a, skId } = arm();
    for (let i = 0; i < 4; i++) a = addFrame(a, a.frames.length - 1).doc;
    [1, 1, 2, 1, 3].forEach((h, i) => (a = setHold(a, a.frames[i]!.id, h)));
    return { a, skId };
  };
  const r = (a: Animation, skId: string, i: number, bone = "up") => resolvePose(a.frames, a.rigs!.find((s) => s.id === skId)!, i).get(bone)!.r;

  it("ticks de inicio = suma de duraciones (el mismo reloj que reproducción y exportación)", () => {
    const { a } = timeline();
    expect([...frameStartTicks(a.frames)]).toEqual([0, 1, 2, 4, 5]);
  });

  it("sin keyframes: reposo; antes del primero y después del último se mantiene la pose", () => {
    let { a, skId } = timeline();
    expect(r(a, skId, 2)).toBe(0);
    a = setPose(a, 1, skId, { up: { r: 20 } });
    a = setPose(a, 3, skId, { up: { r: 100 } });
    expect(r(a, skId, 0)).toBe(20); // antes del primero
    expect(r(a, skId, 4)).toBe(100); // después del último
    expect(r(a, skId, 1)).toBe(20);
    expect(r(a, skId, 3)).toBe(100);
  });

  it("interpola linealmente por TIEMPO (las duraciones pesan): ticks 1→4, el fotograma de tick 2 está a 1/3", () => {
    let { a, skId } = timeline();
    a = setPose(a, 1, skId, { up: { r: 0 } });
    a = setPose(a, 3, skId, { up: { r: 90 } });
    near(r(a, skId, 2), 30); // (2-1)/(4-1) · 90
  });

  it("suave (ease in-out) y mantener (step)", () => {
    let { a, skId } = timeline();
    a = setPose(a, 0, skId, { up: { r: 0 } }, "smooth");
    a = setPose(a, 3, skId, { up: { r: 100 } });
    const t = (2 - 0) / (4 - 0); // fotograma 2: tick 2 de 4
    near(r(a, skId, 2), 100 * easeValue("smooth", t));
    expect(r(a, skId, 2)).toBeLessThan(100 * t + 1e-9); // arranca más lento que lineal
    a = setKeyEase(a, 0, skId, "step");
    expect(r(a, skId, 2)).toBe(0); // se mantiene hasta el siguiente key
    expect(r(a, skId, 3)).toBe(100);
  });

  it("interpola también el desplazamiento de la raíz y cada hueso por separado", () => {
    let { a, skId } = timeline();
    a = setPose(a, 0, skId, { up: { r: 0, x: 0, y: 0 }, lo: { r: 0 } });
    a = setPose(a, 3, skId, { up: { r: 40, x: 80, y: -40 }, lo: { r: -60 } });
    const p = resolvePose(a.frames, sk(a), 2); // tick 2 de 4 → mitad
    near(p.get("up")!.r, 20);
    near(p.get("up")!.x, 40);
    near(p.get("up")!.y, -20);
    near(p.get("lo")!.r, -30);
  });

  it("auto-keyframe: editar un fotograma intermedio crea un key con la pose que ya se veía + el cambio", () => {
    let { a, skId } = timeline();
    a = setPose(a, 0, skId, { up: { r: 0 }, lo: { r: 0 } });
    a = setPose(a, 3, skId, { up: { r: 60 }, lo: { r: 60 } });
    expect(hasKey(a, 2, skId)).toBe(false);
    const before = r(a, skId, 2, "lo");
    a = setBonePose(a, 2, skId, "up", { r: 5 });
    expect(hasKey(a, 2, skId)).toBe(true);
    expect(r(a, skId, 2, "up")).toBe(5);
    near(r(a, skId, 2, "lo"), before); // lo demás se conserva (interpolado)
    expect(keyFrames(a, skId)).toEqual([0, 2, 3]);
  });

  it("copiar/pegar y duplicar/eliminar keyframes", () => {
    let { a, skId } = timeline();
    a = setPose(a, 0, skId, { up: { r: 33 }, lo: { r: -12 } }, "smooth");
    a = copyPose(a, 0, 4, skId);
    expect(a.frames[4]!.poses![skId]!.bones["up"]!.r).toBe(33);
    const clip = a.frames[0]!.poses![skId]!;
    a = pastePose(a, 2, skId, clip);
    expect(r(a, skId, 2, "lo")).toBe(-12);
    expect(a.frames[2]!.poses![skId]!.ease).toBe("smooth");
    a = setPose(a, 4, skId, null); // eliminar key
    expect(hasKey(a, 4, skId)).toBe(false);
    expect(a.frames[4]!.poses).toBeUndefined(); // sin entradas vacías
    expect(keyFrames(a, skId)).toEqual([0, 2]);
  });

  it("duplicar un fotograma copia su keyframe; eliminar el fotograma elimina su keyframe", () => {
    let { a, skId } = timeline();
    a = setPose(a, 1, skId, { up: { r: 45 } });
    const d = duplicateFrame(a, 1);
    expect(d.doc.frames[2]!.poses![skId]!.bones["up"]!.r).toBe(45);
    expect(d.doc.frames[2]!.poses).toBe(d.doc.frames[1]!.poses); // compartido (inmutable)
    const del = deleteFrame(d.doc, 1);
    expect(keyFrames(del, skId)).toEqual([1]); // queda el de la copia
  });

  it("resetPose vuelve al reposo sin quitar el keyframe", () => {
    let { a, skId } = timeline();
    a = setPose(a, 1, skId, { up: { r: 45 } });
    a = resetPose(a, 1, skId);
    expect(r(a, skId, 1)).toBe(0);
    expect(hasKey(a, 1, skId)).toBe(true);
  });
});

describe("vinculación rígida", () => {
  it("la capa vinculada gira alrededor de la articulación de su hueso", () => {
    let { a, skId, layerId } = arm();
    a = setBinding(a, skId, layerId, { mode: "rigid", bone: "lo", influences: [], softness: 20, sharpness: 3 });
    a = addStroke(a, a.frames[0]!.id, layerId, stroke([200, 100, 1, 300, 100, 1])); // el antebrazo dibujado
    a = setBonePose(a, 0, skId, "lo", { r: 90 });
    const f = posedFrame(a, 0);
    const pts = f.cells[layerId]![0]!.points;
    nearV(pts.slice(0, 2), [200, 100]); // el codo no se mueve
    nearV(pts.slice(3, 5), [200, 200]); // la muñeca gira 90° alrededor del codo
  });

  it("varias capas en distintos huesos se mueven cada una con el suyo (el personaje no se desarma)", () => {
    let { a, skId } = arm();
    const [l0, l1] = [a.layers[0]!.id, a.layers[1]!.id];
    a = setBinding(a, skId, l0, { mode: "rigid", bone: "up", influences: [], softness: 20, sharpness: 3 });
    a = setBinding(a, skId, l1, { mode: "rigid", bone: "lo", influences: [], softness: 20, sharpness: 3 });
    a = addStroke(a, a.frames[0]!.id, l0, stroke([100, 100, 1, 200, 100, 1]));
    a = addStroke(a, a.frames[0]!.id, l1, stroke([200, 100, 1, 300, 100, 1]));
    a = setPose(a, 0, skId, { up: { r: 40 }, lo: { r: 30 } });
    const f = posedFrame(a, 0);
    const upper = f.cells[l0]![0]!.points;
    const lower = f.cells[l1]![0]!.points;
    nearV(upper.slice(3, 5), lower.slice(0, 2), 1e-6); // el codo del brazo y el del antebrazo siguen unidos
  });

  it("sin pose devuelve exactamente el mismo fotograma (no se pierde ninguna caché)", () => {
    let { a, skId, layerId } = arm();
    a = setBinding(a, skId, layerId, { mode: "rigid", bone: "up", influences: [], softness: 20, sharpness: 3 });
    a = addStroke(a, a.frames[0]!.id, layerId, stroke([100, 100, 1, 200, 100, 1]));
    expect(posedFrame(a, 0)).toBe(a.frames[0]);
    expect(posedFrame(a, 0).cells[layerId]).toBe(a.frames[0]!.cells[layerId]);
  });

  it("un vínculo solo existe una vez por capa: pasar a otro esqueleto lo mueve", () => {
    let { a, layerId } = arm();
    const second = createSkeleton(a, "Otro", [bone("z", null)]);
    a = setBinding(second.doc, a.rigs![0]!.id, layerId, { mode: "rigid", bone: "up", influences: [], softness: 20, sharpness: 3 });
    expect(bindingOfLayer(a, layerId)!.skeleton.name).toBe("Brazo");
    a = setBinding(a, second.skeletonId, layerId, { mode: "rigid", bone: "z", influences: [], softness: 20, sharpness: 3 });
    expect(bindingOfLayer(a, layerId)!.skeleton.name).toBe("Otro");
    expect(a.rigs![0]!.bindings).toEqual([]);
    a = setBinding(a, second.skeletonId, layerId, null);
    expect(bindingOfLayer(a, layerId)).toBeNull();
  });

  it("eliminar la capa quita su vínculo; el eraser también se deforma con la capa", () => {
    let { a, skId, layerId } = arm();
    a = setBinding(a, skId, layerId, { mode: "rigid", bone: "up", influences: [], softness: 20, sharpness: 3 });
    a = addStroke(a, a.frames[0]!.id, layerId, stroke([100, 100, 1, 200, 100, 1]));
    a = addStroke(a, a.frames[0]!.id, layerId, { ...stroke([150, 100, 1, 160, 100, 1]), kind: "eraser" });
    a = setPose(a, 0, skId, { up: { r: 90 } });
    const cells = posedFrame(a, 0).cells[layerId]!;
    expect(cells.map((s) => s.kind)).toEqual(["pen", "eraser"]);
    nearV(cells[1]!.points.slice(0, 2), [100, 150]); // el borrador giró con la capa
    const b = removeLayer(a, layerId);
    expect(bindingOfLayer(b, layerId)).toBeNull();
    expect(AnimationSchema.safeParse(b).success).toBe(true);
  });
});

describe("deformación por pesos (skinning de los puntos de los trazos)", () => {
  const skinned = (softness = 20, sharpness = 3, mode: "skin" | "rigid" = "skin") => {
    let { a, skId, layerId } = arm();
    a = setBinding(a, skId, layerId, { mode, bone: "up", influences: ["up", "lo"], softness, sharpness });
    // UN solo trazo de DOS puntos: del hombro a la muñeca. Sin subdividir no podría doblarse.
    a = addStroke(a, a.frames[0]!.id, layerId, stroke([100, 100, 1, 300, 100, 1]));
    return { a, skId, layerId };
  };

  it("densify subdivide los tramos largos e interpola la presión", () => {
    const d = densify(stroke([0, 0, 0, 100, 0, 1]), 4);
    expect(d.points.length / 3).toBe(26);
    near(d.points[3 * 13 + 2]!, 0.5, 0.05);
    expect(densify(stroke([5, 5, 1]), 4).points).toEqual([5, 5, 1]); // un punto: igual
  });

  it("los pesos suman 1 y dominan los huesos cercanos", () => {
    const rest = restStates(sk(arm().a));
    const states = [rest.get("up")!, rest.get("lo")!];
    for (const [x, y] of [[100, 100], [150, 100], [200, 100], [260, 100], [200, 160]] as Vec[]) {
      const w = pointWeights(x, y, states, 20, 3);
      near(w[0]! + w[1]!, 1);
    }
    const nearUp = pointWeights(120, 100, states, 20, 3);
    const nearLo = pointWeights(290, 100, states, 20, 3);
    expect(nearUp[0]!).toBeGreaterThan(0.95);
    expect(nearLo[1]!).toBeGreaterThan(0.95);
    const mid = pointWeights(200, 100, states, 20, 3);
    near(mid[0]!, 0.5, 1e-9); // justo en el codo, mitad y mitad
  });

  it("DOBLA de verdad: el trazo recto se curva en el codo (más puntos, no colineales) y los extremos siguen a su hueso", () => {
    let { a, skId, layerId } = skinned();
    a = setPose(a, 0, skId, { up: { r: 0 }, lo: { r: 90 } });
    const out = posedFrame(a, 0).cells[layerId]![0]!;
    const n = out.points.length / 3;
    expect(n).toBeGreaterThan(20); // subdividido (muestreo ≈ softness/2.5 = 8 px): de 2 puntos a ~26
    const P = (i: number): Vec => [out.points[i * 3]!, out.points[i * 3 + 1]!];
    nearV(P(0), [100, 100], 1); // el hombro no se mueve
    // la muñeca está casi enteramente ligada al antebrazo: debería quedar cerca de (200,200)
    const end = P(n - 1);
    expect(Math.hypot(end[0] - 200, end[1] - 200)).toBeLessThan(6);
    // y el trazo YA NO es una recta: hay un punto lejos de la recta hombro-muñeca
    const [sx, sy] = P(0);
    const [ex, ey] = end;
    let maxDev = 0;
    for (let i = 0; i < n; i++) {
      const [x, y] = P(i);
      maxDev = Math.max(maxDev, Math.abs((ex - sx) * (sy - y) - (sx - x) * (ey - sy)) / Math.hypot(ex - sx, ey - sy));
    }
    expect(maxDev).toBeGreaterThan(30);
    // a mitad del arco, el codo es una curva suave: el ángulo entre tramos consecutivos nunca es brusco
    let maxTurn = 0;
    for (let i = 2; i < n; i++) {
      const [x0, y0] = P(i - 2), [x1, y1] = P(i - 1), [x2, y2] = P(i);
      const t = Math.abs(Math.atan2(y2 - y1, x2 - x1) - Math.atan2(y1 - y0, x1 - x0));
      maxTurn = Math.max(maxTurn, Math.min(t, 2 * Math.PI - t));
    }
    expect(toDeg(maxTurn)).toBeLessThan(40); // con vínculo RÍGIDO sería un quiebre de 90° en un solo punto
  });

  it("no es lo mismo que rotar la capa entera: el vínculo rígido quiebra, el deformable curva", () => {
    const skin = skinned();
    const rigid = skinned(20, 3, "rigid");
    for (const t of [skin, rigid]) t.a = setPose(t.a, 0, t.skId, { up: { r: 0 }, lo: { r: 90 } });
    const sPts = posedFrame(skin.a, 0).cells[skin.layerId]![0]!.points;
    const rPts = posedFrame(rigid.a, 0).cells[rigid.layerId]![0]!.points;
    expect(rPts.length).toBe(6); // rígido: los mismos 2 puntos (solo se transforman)
    expect(sPts.length).toBeGreaterThan(60); // deformable: subdividido
    // con rigid vinculado a «up», una rotación de «lo» no mueve nada: la capa solo sigue a su hueso
    expect(posedFrame(rigid.a, 0)).toBe(rigid.a.frames[0]);
  });

  it("combinación convexa: ningún punto se sale de lo que darían sus huesos por separado (sin explosiones)", () => {
    const { a, skId, layerId } = skinned(10, 2);
    const A = setPose(a, 0, skId, { up: { r: 70 }, lo: { r: 110 } });
    const s = sk(A);
    const mats = skinMatrices(s, poseStates(s, resolvePose(A.frames, s, 0)));
    const src = A.frames[0]!.cells[layerId]!;
    const binding = s.bindings[0]!;
    const out = deformStrokes(src, binding, s, mats)[0]!;
    const d = densify(src[0]!);
    for (let i = 0; i < d.points.length / 3; i++) {
      const x = d.points[i * 3]!, y = d.points[i * 3 + 1]!;
      const cands = ["up", "lo"].map((id) => { const m = mats.get(id)!; return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]; });
      const lo = [Math.min(cands[0]![0]!, cands[1]![0]!), Math.min(cands[0]![1]!, cands[1]![1]!)];
      const hi = [Math.max(cands[0]![0]!, cands[1]![0]!), Math.max(cands[0]![1]!, cands[1]![1]!)];
      expect(out.points[i * 3]!).toBeGreaterThanOrEqual(lo[0]! - 1e-6);
      expect(out.points[i * 3]!).toBeLessThanOrEqual(hi[0]! + 1e-6);
      expect(out.points[i * 3 + 1]!).toBeGreaterThanOrEqual(lo[1]! - 1e-6);
      expect(out.points[i * 3 + 1]!).toBeLessThanOrEqual(hi[1]! + 1e-6);
    }
  });

  it("suavidad y nitidez controlan la zona de mezcla", () => {
    const rest = restStates(sk(arm().a));
    const st = [rest.get("up")!, rest.get("lo")!];
    const wSoft = pointWeights(170, 100, st, 120, 1)[0]!; // 30 px antes del codo, mezcla muy suave
    const wSharp = pointWeights(170, 100, st, 5, 6)[0]!; // mezcla muy nítida
    expect(wSharp).toBeGreaterThan(wSoft);
    expect(wSharp).toBeGreaterThan(0.99);
    expect(wSoft).toBeLessThan(0.7);
  });

  it("la caché de pesos no cambia el resultado entre llamadas y respeta cambios del esqueleto", () => {
    let { a, skId, layerId } = skinned();
    a = setPose(a, 0, skId, { up: { r: 0 }, lo: { r: 60 } });
    const f1 = posedFrame(a, 0).cells[layerId]![0]!.points;
    _clearRigMemo();
    const f2 = posedFrame(a, 0).cells[layerId]![0]!.points;
    expect(f2).toEqual(f1);
    // mover el codo (cambia el reposo) debe recalcular los pesos
    const moved = setBoneTail(a, skId, "up", [200, 140]);
    expect(posedFrame(moved, 0).cells[layerId]![0]!.points).not.toEqual(f1);
  });
});

describe("fotograma con pose aplicada (posedFrame)", () => {
  it("sin esqueletos o sin vínculos devuelve el mismo fotograma", () => {
    const a = createAnimation({ episodeId: "e", fps: 24, width: 100, height: 100 });
    expect(posedFrame(a, 0)).toBe(a.frames[0]);
    const r = createSkeleton(a, "Vacío", [bone("x", null)]);
    expect(hasRig(r.doc)).toBe(false);
    expect(posedFrame(r.doc, 0)).toBe(r.doc.frames[0]);
  });

  it("se memoriza por (fotograma, pose): misma pose → mismo objeto; otra pose → otro", () => {
    let { a, skId, layerId } = arm();
    a = setBinding(a, skId, layerId, { mode: "rigid", bone: "up", influences: [], softness: 20, sharpness: 3 });
    a = addStroke(a, a.frames[0]!.id, layerId, stroke([100, 100, 1, 200, 100, 1]));
    a = setPose(a, 0, skId, { up: { r: 30 } });
    const p1 = posedFrame(a, 0);
    expect(posedFrame(a, 0)).toBe(p1);
    const b = setPose(a, 0, skId, { up: { r: 31 } });
    expect(posedFrame(b, 0)).not.toBe(p1);
  });

  it("una pose «en vivo» (override) se previsualiza sin guardarla", () => {
    let { a, skId, layerId } = arm();
    a = setBinding(a, skId, layerId, { mode: "rigid", bone: "up", influences: [], softness: 20, sharpness: 3 });
    a = addStroke(a, a.frames[0]!.id, layerId, stroke([100, 100, 1, 200, 100, 1]));
    const f = posedFrame(a, 0, { skeletonId: skId, bones: { up: { r: 90 } } });
    nearV(f.cells[layerId]![0]!.points.slice(3, 5), [100, 200]);
    expect(a.frames[0]!.poses).toBeUndefined(); // el documento no cambió
  });

  it("las capas sin vínculo no se tocan y la memoria está acotada", () => {
    let { a, skId, layerId } = arm();
    const free = a.layers[0]!.id;
    a = setBinding(a, skId, layerId, { mode: "skin", bone: "up", influences: ["up", "lo"], softness: 20, sharpness: 3 });
    a = addStroke(a, a.frames[0]!.id, free, stroke([5, 5, 1, 50, 50, 1]));
    a = addStroke(a, a.frames[0]!.id, layerId, stroke([100, 100, 1, 300, 100, 1]));
    a = setPose(a, 0, skId, { up: { r: 20 }, lo: { r: 50 } });
    const f = posedFrame(a, 0);
    expect(f.cells[free]).toBe(a.frames[0]!.cells[free]);
    expect(_rigMemoStats().cost).toBeLessThanOrEqual(4_000_000 + 100_000);
  });
});

describe("edición del esqueleto", () => {
  it("addBone calcula los parámetros locales a partir de cabeza y cola en el lienzo", () => {
    let { a, skId } = arm();
    const r = addBone(a, skId, { name: "Mano", parent: "lo", head: [300, 100], tail: [300, 160] });
    a = r.doc;
    const R = restStates(sk(a));
    const m = R.get(r.boneId)!;
    nearV(m.head, [300, 100], 1e-3);
    nearV(m.tail, [300, 160], 1e-2);
    near(sk(a).bones.at(-1)!.angle, 90, 1e-2); // relativo al padre (que apunta a +x)
  });

  it("addChildBone continúa desde la cola del padre; el resultado cumple el esquema", () => {
    let { a, skId } = arm();
    a = addChildBone(a, skId, "lo").doc;
    nearV(restStates(sk(a)).get(sk(a).bones.at(-1)!.id)!.head, [300, 100], 1e-3);
    expect(SkeletonSchema.safeParse(sk(a)).success).toBe(true);
  });

  it("mover una articulación conserva la orientación y longitud; los hijos la siguen", () => {
    let { a, skId } = arm();
    a = moveBoneHead(a, skId, "up", [150, 180]);
    const R = restStates(sk(a));
    nearV(R.get("up")!.head, [150, 180]);
    nearV(R.get("up")!.tail, [250, 180]);
    nearV(R.get("lo")!.tail, [350, 180]); // el hijo sigue
    a = moveBoneHead(a, skId, "lo", [260, 200]); // un hijo: cambia su anclaje en el padre
    nearV(restStates(sk(a)).get("lo")!.head, [260, 200], 1e-3);
  });

  it("setBoneTail cambia longitud y orientación", () => {
    let { a, skId } = arm();
    a = setBoneTail(a, skId, "up", [100, 250]);
    near(sk(a).bones[0]!.length, 150);
    near(sk(a).bones[0]!.angle, 90);
  });

  it("reparentar conserva la posición en el lienzo, mantiene el orden topológico y evita ciclos", () => {
    let { a, skId } = arm();
    a = addBone(a, skId, { name: "otro", parent: null, head: [500, 100], tail: [600, 100] }).doc;
    const otherId = sk(a).bones.at(-1)!.id;
    const before = restStates(sk(a)).get("lo")!;
    a = reparentBone(a, skId, "lo", otherId);
    const after = restStates(sk(a)).get("lo")!;
    nearV(after.head, before.head, 1e-2);
    nearV(after.tail, before.tail, 1e-2);
    expect(SkeletonSchema.safeParse(sk(a)).success).toBe(true);
    expect(() => reparentBone(a, skId, "up", "up")).toThrowError(EngineError);
    a = reparentBone(a, skId, "lo", "up");
    expect(() => reparentBone(a, skId, "up", "lo")).toThrowError(/descendientes/);
    a = reparentBone(a, skId, "lo", null); // convertir en raíz
    expect(sk(a).bones.find((b) => b.id === "lo")!.parent).toBeNull();
  });

  it("eliminar un hueso elimina su subárbol y limpia vínculos y keyframes", () => {
    let { a, skId, layerId } = arm();
    a = setBinding(a, skId, layerId, { mode: "skin", bone: "lo", influences: ["up", "lo"], softness: 20, sharpness: 3 });
    a = setPose(a, 0, skId, { up: { r: 10 }, lo: { r: 20 } });
    const r = removeBone(a, skId, "lo");
    expect(r.removed).toEqual(["lo"]);
    expect(sk(r.doc).bones.map((b) => b.id)).toEqual(["up"]);
    expect(sk(r.doc).bindings[0]).toMatchObject({ bone: "up", influences: ["up"] }); // el skin sobrevive con lo que queda
    expect(r.doc.frames[0]!.poses![skId]!.bones).toEqual({ up: { r: 10, x: 0, y: 0 } });
    const all = removeBone(a, skId, "up");
    expect(all.removed.sort()).toEqual(["lo", "up"]);
    expect(sk(all.doc).bindings).toEqual([]);
    expect(AnimationSchema.safeParse(all.doc).success).toBe(true);
  });

  it("eliminar un esqueleto limpia sus keyframes", () => {
    let { a, skId } = arm();
    a = setPose(a, 0, skId, { up: { r: 10 } });
    const b = removeSkeleton(a, skId);
    expect(b.rigs).toBeUndefined();
    expect(b.frames[0]!.poses).toBeUndefined();
  });

  it("las operaciones son inmutables y se deshacen con el historial global", () => {
    const { a, skId } = arm();
    const snap = JSON.stringify(a);
    const h = new History(a);
    h.commit(setBonePose(h.present, 0, skId, "up", { r: 40 }));
    h.commit(addChildBone(h.present, skId, "lo").doc);
    h.commit(setBinding(h.present, skId, a.layers[1]!.id, { mode: "rigid", bone: "up", influences: [], softness: 20, sharpness: 3 }));
    expect(JSON.stringify(a)).toBe(snap);
    h.undo();
    h.undo();
    expect(sk(h.present).bones).toHaveLength(2);
    h.undo();
    expect(JSON.stringify(h.present)).toBe(snap);
    h.redo();
    h.redo();
    h.redo();
    expect(sk(h.present).bindings).toHaveLength(1);
  });

  it("moveStrokes separa partes en capas; syncLayers propaga un dibujo a todos los fotogramas", () => {
    let { a } = arm();
    const [l0, l1] = [a.layers[0]!.id, a.layers[1]!.id];
    a = addStroke(a, a.frames[0]!.id, l1, stroke([1, 1, 1, 2, 2, 1], "s1"));
    a = addStroke(a, a.frames[0]!.id, l1, stroke([3, 3, 1, 4, 4, 1], "s2"));
    a = moveStrokes(a, a.frames[0]!.id, l1, l0, new Set(["s2"]));
    expect(a.frames[0]!.cells[l1]!.map((s) => s.id)).toEqual(["s1"]);
    expect(a.frames[0]!.cells[l0]!.map((s) => s.id)).toEqual(["s2"]);
    a = addFrame(addFrame(a, 0).doc, 0).doc;
    a = syncLayers(a, a.frames[0]!.id, [l0, l1]);
    expect(a.frames.every((f) => f.cells[l0]!.length === 1 && f.cells[l1]!.length === 1)).toBe(true);
    expect(a.frames[2]!.cells[l0]).toBe(a.frames[0]!.cells[l0]); // compartido
  });

  it("la plantilla humanoide trae cabeza, cuello, torso, cadera, brazos, piernas, manos y pies, y es solo un punto de partida", () => {
    const { doc, skeletonId } = createHumanoid(createAnimation({ episodeId: "e", fps: 24, width: 1280, height: 720 }), 640, 650, 500);
    const s = doc.rigs!.find((x) => x.id === skeletonId)!;
    expect(SkeletonSchema.safeParse(s).success).toBe(true);
    const names = s.bones.map((b) => b.name);
    for (const n of ["Cabeza", "Cuello", "Torso", "Cadera", "Brazo superior izq.", "Brazo inferior izq.", "Brazo superior der.", "Brazo inferior der.", "Pierna superior izq.", "Pierna inferior izq.", "Pierna superior der.", "Pierna inferior der.", "Mano izq.", "Mano der.", "Pie izq.", "Pie der."]) expect(names).toContain(n);
    expect(s.bones).toHaveLength(16);
    // anatomía básica: la cabeza queda por encima de los pies y entre los hombros
    const R = restStates(s);
    const by = (n: string) => R.get(s.bones.find((b) => b.name === n)!.id)!;
    expect(by("Cabeza").tail[1]).toBeLessThan(by("Pie izq.").tail[1]);
    expect(by("Pie izq.").tail[1]).toBeLessThanOrEqual(650 + 1);
    expect(by("Mano izq.").tail[0]).toBeGreaterThan(by("Mano der.").tail[0]); // «izq.» es el lado derecho de la pantalla
    // es editable: se puede quitar y reorganizar sin estructura fija
    const sin = removeBone(doc, skeletonId, s.bones.find((b) => b.name === "Brazo superior der.")!.id);
    expect(sin.doc.rigs![0]!.bones).toHaveLength(13);
    const extra = addChildBone(sin.doc, skeletonId, s.bones.find((b) => b.name === "Cabeza")!.id, "Coleta");
    expect(extra.doc.rigs![0]!.bones).toHaveLength(14);
  });

  it("hitBone: prioriza articulaciones y respeta la tolerancia", () => {
    const { a } = arm();
    const R = restStates(sk(a));
    expect(hitBone(sk(a), R, 202, 101, 12)).toEqual({ boneId: "up", part: "tail" }); // cola del brazo (empate con la cabeza del hijo → el primero)
    expect(hitBone(sk(a), R, 150, 105, 12)).toEqual({ boneId: "up", part: "body" });
    expect(hitBone(sk(a), R, 150, 160, 12)).toBeNull();
    expect(hitBone(sk(a), R, 102, 99, 12)).toEqual({ boneId: "up", part: "head" });
  });

  it("toRad/toDeg son inversas", () => near(toDeg(toRad(37.5)), 37.5));
});

describe("rendimiento del motor", () => {
  it("un esqueleto de 128 huesos con una capa deformable de ~20 000 puntos se evalúa en milisegundos tras la primera vez", () => {
    let a = createAnimation({ episodeId: "e", fps: 24, width: 4000, height: 4000 });
    const bones: Bone[] = [bone("b0", null, { x: 100, y: 2000, length: 30 })];
    for (let i = 1; i < 128; i++) bones.push(bone(`b${i}`, `b${i - 1}`, { length: 30, angle: i % 2 ? 3 : -3 }));
    const r = createSkeleton(a, "Largo", bones);
    a = r.doc;
    const layer = a.layers[1]!.id;
    a = setBinding(a, r.skeletonId, layer, { mode: "skin", bone: "b0", influences: bones.map((b) => b.id).slice(0, 24), softness: 20, sharpness: 3 });
    const strokes: Stroke[] = Array.from({ length: 200 }, (_, i) => stroke(Array.from({ length: 100 }, (_, k) => [100 + k * 36, 2000 + ((i * 7 + k) % 40), 1]).flat()));
    for (const s of strokes) a = addStroke(a, a.frames[0]!.id, layer, s);
    const t0 = performance.now();
    a = setPose(a, 0, r.skeletonId, { b0: { r: 5 }, b10: { r: 20 } });
    posedFrame(a, 0); // primera vez: calcula los pesos
    const first = performance.now() - t0;
    const t1 = performance.now();
    for (let i = 0; i < 20; i++) posedFrame(setPose(a, 0, r.skeletonId, { b0: { r: 5 + i }, b10: { r: 20 - i } }), 0); // poses nuevas, pesos en caché
    const perPose = (performance.now() - t1) / 20;
    expect(a.rigs![0]!.bones).toHaveLength(128);
    expect(first).toBeLessThan(5000);
    expect(perPose).toBeLessThan(120);
  }, 30_000);

  it("resolver la pose en una animación de 2000 fotogramas con keyframes es instantáneo", () => {
    let { a, skId } = arm();
    for (let i = 0; i < 1999; i++) a = addFrame(a, a.frames.length - 1).doc;
    for (let i = 0; i < 2000; i += 50) a = setPose(a, i, skId, { up: { r: (i / 50) % 90 } });
    const t = performance.now();
    for (let i = 0; i < 2000; i++) resolvePose(a.frames, sk(a), i);
    expect(performance.now() - t).toBeLessThan(400);
  });
});
