import { MAX_LAYERS, longId, shortId, type Animation, type Bone, type Expression, type Instance, type Layer, type PoseKey, type Proportions, type Skeleton, type Stroke, type ViewKind } from "@gas/core";
import { pointWeights, restStates, type BoneState } from "../rig";
import { setPose, keyFrames } from "../rig-ops";
import { viewFrameIndex, applySpecs } from "./assemble";
import type { Rest } from "./spec";
import { faceLayers, type ExprParams, type FaceParams } from "./face";
import { planBody, planBones, CHAR_H, CHAR_W } from "./plan";

/* ───────────────────────── Proporciones: re-escalar el dibujo sobre el esqueleto nuevo ───────────────────────── */

const FACE_PARTS = new Set(["eyes", "brows", "mouth"]);
export const isFaceLayer = (l: Layer) => !!l.part && FACE_PARTS.has(l.part);

/** Medidas de un hueso en un estado: dirección y normal. */
const dirOf = (s: BoneState): [number, number] => [Math.cos(s.angle), Math.sin(s.angle)];

/**
 * Lleva los puntos de `strokes` de la geometría de reposo ANTIGUA a la NUEVA. Cada punto se expresa en el sistema de cada
 * hueso influyente (distancia a lo largo del hueso `u` y perpendicular `v`), se reescala (`u` por la razón de longitudes,
 * `v` por la razón de grosores) y se recompone con los mismos pesos que usa la deformación. Es la «deformación con escala
 * de hueso» que la pose normal no tiene: sirve para cambiar proporciones sin redibujar.
 */
export function retargetStrokes(
  strokes: readonly Stroke[],
  oldStates: ReadonlyMap<string, BoneState>,
  newStates: ReadonlyMap<string, BoneState>,
  influences: readonly string[],
  widthRatio: ReadonlyMap<string, number>,
  softness: number,
  sharpness: number,
): Stroke[] {
  const ids = influences.filter((id) => oldStates.has(id) && newStates.has(id));
  if (ids.length === 0) return strokes.slice();
  const olds = ids.map((id) => oldStates.get(id)!);
  const news = ids.map((id) => newStates.get(id)!);
  const w: number[] = new Array(ids.length);
  let scaleSum = 0;
  return strokes.map((s) => {
    const pts = s.points.slice();
    let sizeK = 0;
    let n = 0;
    for (let i = 0; i < pts.length; i += 3) {
      const x = pts[i]!, y = pts[i + 1]!;
      pointWeights(x, y, olds, softness, sharpness, w);
      let nx = 0, ny = 0, k = 0;
      for (let b = 0; b < ids.length; b++) {
        const o = olds[b]!, nw = news[b]!;
        const od = dirOf(o), nd = dirOf(nw);
        const dx = x - o.head[0], dy = y - o.head[1];
        const u = dx * od[0] + dy * od[1];
        const v = -dx * od[1] + dy * od[0];
        const su = nw.length / Math.max(1e-6, o.length);
        const sv = widthRatio.get(ids[b]!) ?? su;
        const uu = u * su, vv = v * sv;
        nx += w[b]! * (nw.head[0] + nd[0] * uu - nd[1] * vv);
        ny += w[b]! * (nw.head[1] + nd[1] * uu + nd[0] * vv);
        k += w[b]! * sv;
      }
      pts[i] = Math.round(nx * 10) / 10;
      pts[i + 1] = Math.round(ny * 10) / 10;
      sizeK += k;
      n++;
    }
    scaleSum += 1;
    return { ...s, size: Math.max(0.5, Math.round(s.size * (n ? sizeK / n : 1) * 100) / 100), points: pts };
  });
  void scaleSum;
}

/**
 * Cambia las proporciones del personaje: ajusta la geometría de los huesos del humanoide (por nombre) y reescala TODO el
 * dibujo vinculado (cuerpo, ropa, rostro, pelo, accesorios) para que siga encajando. Las capas sin vincular no se tocan.
 * Los huesos que el usuario haya añadido se mantienen. Mantiene el nombre, las poses guardadas y las expresiones
 * (los trazos de las expresiones guardadas también se reescalan).
 */
export function applyProportions(doc: Animation, next: Proportions): Animation {
  const block = doc.character;
  const sk = doc.rigs?.[0];
  if (!block) return doc;
  if (!sk) return { ...doc, character: { ...block, proportions: next } };
  const oldPlan = planBody(block.proportions);
  const newPlan = planBody(next);
  const ref = planBones(newPlan, next);
  const byName = new Map(ref.map((b) => [b.name, b]));
  const bones: Bone[] = sk.bones.map((b) => {
    const t = byName.get(b.name);
    if (!t) return b;
    return { ...b, length: t.length, ax: t.ax, ay: t.ay, angle: t.angle, x: t.x, y: t.y };
  });
  const newSk: Skeleton = { ...sk, bones };
  const oldRest = restStates(sk);
  const newRest = restStates(newSk);
  const ratio = new Map<string, number>();
  for (const b of sk.bones) {
    const o = oldPlan.widthOf[b.name], n = newPlan.widthOf[b.name];
    if (o && n) ratio.set(b.id, n / o);
  }
  const bindings = new Map(sk.bindings.map((b) => [b.layerId, b]));
  const frames = doc.frames.map((f) => {
    const cells: Record<string, Stroke[]> = { ...f.cells };
    for (const [layerId, strokes] of Object.entries(f.cells)) {
      const bd = bindings.get(layerId);
      if (!bd || strokes.length === 0) continue;
      const infl = bd.mode === "rigid" ? [bd.bone] : bd.influences.length ? bd.influences : [bd.bone];
      cells[layerId] = retargetStrokes(strokes, oldRest, newRest, infl, ratio, bd.softness, bd.sharpness);
    }
    return { ...f, cells };
  });
  const expressions = block.expressions.map((e) => {
    const cells: Record<string, Stroke[]> = {};
    for (const [layerId, strokes] of Object.entries(e.cells)) {
      const bd = bindings.get(layerId);
      cells[layerId] = bd && strokes.length ? retargetStrokes(strokes as Stroke[], oldRest, newRest, bd.mode === "rigid" ? [bd.bone] : bd.influences, ratio, bd.softness, bd.sharpness) : (strokes as Stroke[]);
    }
    return { ...e, cells };
  });
  return { ...doc, frames, rigs: [newSk, ...(doc.rigs!.slice(1))], character: { ...block, proportions: next, expressions } };
}

/* ───────────────────────── Expresiones ───────────────────────── */

const faceLayerIds = (doc: Animation) => doc.layers.filter(isFaceLayer).map((l) => l.id);

/** Guarda como expresión lo que hay ahora dibujado en las capas de rostro (ojos, cejas, boca) del fotograma. */
export function saveExpression(doc: Animation, frameIndex: number, name: string, id = longId()): { doc: Animation; id: string } {
  const block = doc.character;
  if (!block) throw new Error("No es un documento de personaje");
  const fr = doc.frames[frameIndex];
  if (!fr) throw new Error("Fotograma inexistente");
  const cells: Record<string, Stroke[]> = {};
  for (const lid of faceLayerIds(doc)) cells[lid] = [...(fr.cells[lid] ?? [])];
  const clean = name.trim().slice(0, 60) || "Expresión";
  const existing = block.expressions.findIndex((e) => e.name.toLowerCase() === clean.toLowerCase());
  const expr: Expression = { id: existing >= 0 ? block.expressions[existing]!.id : id, name: clean, cells };
  const expressions = existing >= 0 ? block.expressions.map((e, i) => (i === existing ? expr : e)) : [...block.expressions, expr];
  if (expressions.length > 40) throw new Error("Máximo 40 expresiones");
  return { doc: { ...doc, character: { ...block, expressions } }, id: expr.id };
}

/** Sustituye los dibujos de ojos, cejas y boca del fotograma por los de la expresión (se puede deshacer). */
export function applyExpression(doc: Animation, frameIndex: number, exprId: string): Animation {
  const e = doc.character?.expressions.find((x) => x.id === exprId);
  if (!e) throw new Error("Expresión inexistente");
  return applyCells(doc, frameIndex, e.cells as Record<string, Stroke[]>);
}

function applyCells(doc: Animation, frameIndex: number, cells: Record<string, Stroke[]>): Animation {
  const fr = doc.frames[frameIndex];
  if (!fr) throw new Error("Fotograma inexistente");
  const next = { ...fr.cells };
  for (const [lid, strokes] of Object.entries(cells)) {
    if (!doc.layers.some((l) => l.id === lid)) continue;
    if (strokes.length === 0) delete next[lid];
    else next[lid] = strokes;
  }
  return { ...doc, frames: doc.frames.map((f, i) => (i === frameIndex ? { ...f, cells: next } : f)) };
}

export function deleteExpression(doc: Animation, exprId: string): Animation {
  const b = doc.character;
  if (!b) return doc;
  return { ...doc, character: { ...b, expressions: b.expressions.filter((e) => e.id !== exprId) } };
}

/** Genera una expresión a partir de un preajuste paramétrico (ojos, cejas y boca) y la dibuja en el fotograma. */
export function drawExpressionPreset(doc: Animation, frameIndex: number, face: FaceParams, expr: ExprParams, restOfDoc: Rest): Animation {
  const specs = faceLayers(restOfDoc, face, expr).filter((s) => s.key === "ojos" || s.key === "boca" || s.key === "cejas");
  return applySpecs(doc, frameIndex, specs);
}

/* ───────────────────────── Poses guardadas ───────────────────────── */

export function savePoseFromFrame(doc: Animation, frameIndex: number, name: string): Animation {
  const b = doc.character;
  const sk = doc.rigs?.[0];
  if (!b || !sk) throw new Error("El personaje no tiene esqueleto");
  const key = doc.frames[frameIndex]?.poses?.[sk.id];
  if (!key) throw new Error("Este fotograma no tiene pose: usa «Guardar pose (keyframe)» primero");
  const clean = name.trim().slice(0, 60) || "Pose";
  const saved = { id: longId(), name: clean, key };
  const poses = [...b.poses.filter((p) => p.name.toLowerCase() !== clean.toLowerCase()), saved];
  if (poses.length > 60) throw new Error("Máximo 60 poses");
  return { ...doc, character: { ...b, poses } };
}

export function applySavedPose(doc: Animation, frameIndex: number, poseId: string): Animation {
  const sk = doc.rigs?.[0];
  const sp = doc.character?.poses.find((p) => p.id === poseId);
  if (!sk || !sp) throw new Error("Pose inexistente");
  return setPose(doc, frameIndex, sk.id, sp.key.bones, sp.key.ease);
}

export function deleteSavedPose(doc: Animation, poseId: string): Animation {
  const b = doc.character;
  return b ? { ...doc, character: { ...b, poses: b.poses.filter((p) => p.id !== poseId) } } : doc;
}

/* ───────────────────────── Vistas ───────────────────────── */

/** Copia el dibujo de unas capas de una vista a otra (punto de partida para dibujar la vista nueva a mano). */
export function copyViewLayers(doc: Animation, from: ViewKind, to: ViewKind, layerIds?: readonly string[]): Animation {
  const a = viewFrameIndex(doc, from), b = viewFrameIndex(doc, to);
  if (a < 0 || b < 0 || a === b) return doc;
  const ids = layerIds ?? doc.layers.map((l) => l.id);
  const cells = { ...doc.frames[b]!.cells };
  for (const id of ids) {
    const s = doc.frames[a]!.cells[id];
    if (s?.length) cells[id] = s;
  }
  return { ...doc, frames: doc.frames.map((f, i) => (i === b ? { ...f, cells } : f)) };
}

/* ───────────────────────── Insertar un personaje en un episodio ───────────────────────── */

export interface InsertOptions {
  characterId: string;
  name: string;
  view: ViewKind;
  /** Altura final del personaje en px del episodio (por defecto, 62 % del alto del lienzo). */
  heightPx?: number;
  /** Posición del centro de los pies (px del episodio). Por defecto: centro, 94 % del alto. */
  feet?: [number, number];
}

const mapPts = (pts: readonly number[], f: (x: number, y: number) => [number, number]) => {
  const out = new Array<number>(pts.length);
  for (let i = 0; i < pts.length; i += 3) { const [x, y] = f(pts[i]!, pts[i + 1]!); out[i] = Math.round(x * 10) / 10; out[i + 1] = Math.round(y * 10) / 10; out[i + 2] = pts[i + 2]!; }
  return out;
};

/**
 * Copia el personaje (capas, dibujo de la vista elegida, esqueleto con vínculos, expresiones y poses guardadas) a TODOS los
 * dibujos del episodio, reescalado y colocado. Las capas conservan `part` y `group` (el nombre del personaje).
 * Solo la vista en la que está definido el esqueleto (frontal) se inserta con rig; las demás van sin esqueleto.
 */
export function insertCharacter(ep: Animation, ch: Animation, o: InsertOptions): { doc: Animation; instanceId: string } {
  const block = ch.character;
  if (!block) throw new Error("No es un personaje");
  if ((ep.instances?.length ?? 0) >= 12) throw new Error("Máximo 12 personajes por episodio");
  const vi = viewFrameIndex(ch, o.view);
  if (vi < 0) throw new Error("La vista no existe");
  const frame = ch.frames[vi]!;
  const withRig = o.view === "front" && !!ch.rigs?.length;
  const plan = planBody(block.proportions);
  const hPx = o.heightPx ?? ep.height * 0.62;
  const k = hPx / plan.H;
  const [fx, fy] = o.feet ?? [ep.width / 2, ep.height * 0.94];
  const map = (x: number, y: number): [number, number] => [fx + (x - CHAR_W / 2) * k, fy + (y - plan.groundY) * k];
  void CHAR_H;
  const layerMap = new Map<string, string>();
  const newLayers: Layer[] = [];
  for (const l of ch.layers) {
    if (l.part === "sketch") continue;
    const id = longId();
    layerMap.set(l.id, id);
    newLayers.push({ ...l, id, group: o.name.slice(0, 60), ...(l.blur ? { blur: Math.round(l.blur * k * 10) / 10 } : {}) });
  }
  if (ep.layers.length + newLayers.length > MAX_LAYERS) throw new Error(`No caben más capas (máximo ${MAX_LAYERS}): quita capas del episodio`);
  const scaled = (strokes: readonly Stroke[]): Stroke[] => strokes.map((s) => ({ ...s, id: shortId(), size: Math.max(0.1, Math.round(s.size * k * 100) / 100), points: mapPts(s.points, map) }));
  const cellOf = new Map<string, Stroke[]>();
  for (const [lid, strokes] of Object.entries(frame.cells)) {
    const nid = layerMap.get(lid);
    if (nid && strokes.length) cellOf.set(nid, scaled(strokes));
  }
  const frames = ep.frames.map((f) => {
    const cells = { ...f.cells };
    for (const [nid, s] of cellOf) cells[nid] = s; // arrays compartidos entre dibujos: no se duplican en memoria
    return { ...f, cells };
  });
  const instId = longId();
  let rigs = ep.rigs;
  const sk = ch.rigs?.[0];
  if (withRig && sk) {
    if ((rigs?.length ?? 0) >= 8) throw new Error("Máximo 8 esqueletos por episodio");
    const boneMap = new Map(sk.bones.map((b) => [b.id, longId()]));
    const bones: Bone[] = sk.bones.map((b) => ({ ...b, id: boneMap.get(b.id)!, parent: b.parent ? boneMap.get(b.parent)! : null, x: b.parent ? b.x : Math.round(map(b.x, b.y)[0] * 10) / 10, y: b.parent ? b.y : Math.round(map(b.x, b.y)[1] * 10) / 10, ax: b.ax, ay: Math.round(b.ay * k * 10) / 10, length: Math.max(1, Math.round(b.length * k * 1000) / 1000) }));
    const bindings = sk.bindings.filter((b) => layerMap.has(b.layerId)).map((b) => ({ ...b, layerId: layerMap.get(b.layerId)!, bone: boneMap.get(b.bone)!, influences: b.influences.map((i) => boneMap.get(i)!).filter(Boolean), softness: Math.max(1, Math.round(b.softness * k * 10) / 10) }));
    const skeletonId = longId();
    rigs = [...(rigs ?? []), { id: skeletonId, name: o.name.slice(0, 60), bones, bindings }];
    // pose de reposo del personaje: cada dibujo del episodio puede tener la suya; no se crean keyframes de más
    const remapKey = (key: PoseKey): PoseKey => ({ ease: key.ease, bones: Object.fromEntries(Object.entries(key.bones).map(([bid, p]) => [boneMap.get(bid)!, { ...p, ...(p.x !== undefined ? { x: Math.round(p.x * k * 10) / 10 } : {}), ...(p.y !== undefined ? { y: Math.round(p.y * k * 10) / 10 } : {}) }])) });
    const instPoses = block.poses.map((p) => ({ ...p, id: longId(), key: remapKey(p.key) }));
    const expressions = block.expressions.map((e) => ({ id: longId(), name: e.name, cells: Object.fromEntries(Object.entries(e.cells).filter(([lid]) => layerMap.has(lid)).map(([lid, s]) => [layerMap.get(lid)!, scaled(s as Stroke[])])) }));
    const inst: Instance = { id: instId, characterId: o.characterId, name: o.name.slice(0, 80), view: o.view, scale: k, tx: fx, ty: fy, skeletonId, layerIds: newLayers.map((l) => l.id), expressions, poses: instPoses };
    return { doc: { ...ep, layers: [...ep.layers, ...newLayers], frames, ...(rigs ? { rigs } : {}), instances: [...(ep.instances ?? []), inst] }, instanceId: instId };
  }
  const expressions = block.expressions.map((e) => ({ id: longId(), name: e.name, cells: Object.fromEntries(Object.entries(e.cells).filter(([lid]) => layerMap.has(lid)).map(([lid, s]) => [layerMap.get(lid)!, scaled(s as Stroke[])])) }));
  const inst: Instance = { id: instId, characterId: o.characterId, name: o.name.slice(0, 80), view: o.view, scale: k, tx: fx, ty: fy, skeletonId: null, layerIds: newLayers.map((l) => l.id), expressions, poses: [] };
  return { doc: { ...ep, layers: [...ep.layers, ...newLayers], frames, instances: [...(ep.instances ?? []), inst] }, instanceId: instId };
}

/** Aplica una expresión guardada del personaje insertado al dibujo `frameIndex` (y opcionalmente hasta `toIndex`). */
export function applyInstanceExpression(doc: Animation, instanceId: string, exprId: string, frameIndex: number, toIndex = frameIndex): Animation {
  const inst = doc.instances?.find((i) => i.id === instanceId);
  const e = inst?.expressions.find((x) => x.id === exprId);
  if (!inst || !e) throw new Error("Expresión inexistente");
  let d = doc;
  for (let i = frameIndex; i <= Math.min(toIndex, doc.frames.length - 1); i++) d = applyCells(d, i, e.cells as Record<string, Stroke[]>);
  return d;
}

/** Aplica una pose guardada del personaje insertado como keyframe en `frameIndex`. */
export function applyInstancePose(doc: Animation, instanceId: string, poseId: string, frameIndex: number): Animation {
  const inst = doc.instances?.find((i) => i.id === instanceId);
  const p = inst?.poses.find((x) => x.id === poseId);
  if (!inst || !p || !inst.skeletonId) throw new Error("Pose inexistente");
  return setPose(doc, frameIndex, inst.skeletonId, p.key.bones, p.key.ease);
}

/** Quita un personaje insertado (capas, dibujo, esqueleto y registro). */
export function removeInstance(doc: Animation, instanceId: string): Animation {
  const inst = doc.instances?.find((i) => i.id === instanceId);
  if (!inst) return doc;
  const drop = new Set(inst.layerIds);
  if (doc.layers.filter((l) => !drop.has(l.id)).length === 0) throw new Error("Debe quedar al menos una capa");
  const frames = doc.frames.map((f) => {
    const cells = { ...f.cells };
    for (const id of drop) delete cells[id];
    if (inst.skeletonId && f.poses && inst.skeletonId in f.poses) {
      const poses = { ...f.poses };
      delete poses[inst.skeletonId];
      const { poses: _omit, ...rest } = f;
      void _omit;
      return { ...rest, cells, ...(Object.keys(poses).length ? { poses } : {}) };
    }
    return { ...f, cells };
  });
  const rigs = doc.rigs?.filter((s) => s.id !== inst.skeletonId);
  const instances = doc.instances!.filter((i) => i.id !== instanceId);
  const { rigs: _r, instances: _i, ...rest } = doc;
  void _r; void _i;
  return { ...rest, layers: doc.layers.filter((l) => !drop.has(l.id)), frames, ...(rigs?.length ? { rigs } : {}), ...(instances.length ? { instances } : {}) };
}

void keyFrames;


/* ───────────────────────── Prendas: aplicar (y quitar lo que sobra) ───────────────────────── */

import { garmentKeys, garmentLayers, type GarmentParams } from "./garments";

/** Quita capas generadas (por clave) de todos los dibujos, con sus vínculos. */
export function removeGeneratedLayers(doc: Animation, keys: readonly string[]): Animation {
  const drop = new Set(doc.layers.filter((l) => l.group && keys.includes(l.group)).map((l) => l.id));
  if (drop.size === 0) return doc;
  if (doc.layers.length - drop.size < 1) return doc;
  return {
    ...doc,
    layers: doc.layers.filter((l) => !drop.has(l.id)),
    frames: doc.frames.map((f) => {
      if (![...drop].some((id) => id in f.cells)) return f;
      const cells = { ...f.cells };
      for (const id of drop) delete cells[id];
      return { ...f, cells };
    }),
    ...(doc.rigs ? { rigs: doc.rigs.map((s) => ({ ...s, bindings: s.bindings.filter((b) => !drop.has(b.layerId)) })) } : {}),
  };
}

/**
 * Pone (o vuelve a poner) una prenda en la vista frontal: regenera sus capas a partir de los parámetros y quita las que ya
 * no hacen falta (p. ej. las mangas al pasar a «sin mangas»). Guarda los parámetros en el personaje para poder re-editarla.
 */
export function applyGarment(doc: Animation, frameIndex: number, g: GarmentParams, rest: Rest): Animation {
  const specs = garmentLayers(rest, g);
  const keep = new Set(specs.map((s) => s.key));
  let d = removeGeneratedLayers(doc, garmentKeys(g).filter((k) => !keep.has(k)));
  d = applySpecs(d, frameIndex, specs);
  const b = d.character;
  if (!b) return d;
  const slot = garmentKeys(g)[0]!;
  const rec = { id: b.garments.find((x) => x.type === slot)?.id ?? longId(), type: slot, name: g.type, params: g as unknown as Record<string, number | string | boolean>, layerIds: d.layers.filter((l) => l.group && garmentKeys(g).includes(l.group)).map((l) => l.id) };
  const garments = [...b.garments.filter((x) => x.type !== slot), rec];
  return { ...d, character: { ...b, garments } };
}

/** Quita una prenda (por su ranura: «pantalon», «chaqueta», «camiseta», «calzado»). */
export function removeGarment(doc: Animation, slot: string): Animation {
  const keys = slot === "calzado" ? ["calzado", "calzado-sombra"] : [slot, `${slot}-sombra`, `${slot}-det`, `${slot}-mangas`, `${slot}-mangas-sombra`, `${slot}-mangas-det`];
  const d = removeGeneratedLayers(doc, keys);
  const b = d.character;
  return b ? { ...d, character: { ...b, garments: b.garments.filter((x) => x.type !== slot) } } : d;
}
