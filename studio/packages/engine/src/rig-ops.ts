import { MAX_BONES, MAX_SKELETONS, longId, type Animation, type Binding, type Bone, type BonePose, type Ease, type PoseKey, type Skeleton } from "@gas/core";
import { EngineError, assertEditable, frameIndexById, layerIndex } from "./ops";
import { boneById, descendants, poseToKey, resolveBones, resolvePose, restStates, toDeg, toRad, type ResolvedPose, type Vec } from "./rig";

/* Todas las operaciones son puras e inmutables, igual que las de capas y fotogramas: el historial las deshace sin más. */

export const skeletonsOf = (a: Pick<Animation, "rigs">): readonly Skeleton[] => a.rigs ?? [];

export function skeletonById(a: Pick<Animation, "rigs">, id: string): Skeleton {
  const s = skeletonsOf(a).find((x) => x.id === id);
  if (!s) throw new EngineError(`Esqueleto inexistente: ${id}`, "not-found");
  return s;
}

function patchSkeleton(a: Animation, id: string, fn: (s: Skeleton) => Skeleton): Animation {
  skeletonById(a, id);
  return { ...a, rigs: skeletonsOf(a).map((s) => (s.id === id ? fn(s) : s)) };
}

const norm180 = (d: number) => {
  let x = ((d + 180) % 360 + 360) % 360 - 180;
  if (x === -180) x = 180;
  return Math.round(x * 1000) / 1000;
};
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/* ───────────────────────── Esqueletos ───────────────────────── */

export function createSkeleton(a: Animation, name?: string, bones: Bone[] = []): { doc: Animation; skeletonId: string } {
  if (skeletonsOf(a).length >= MAX_SKELETONS) throw new EngineError(`Máximo ${MAX_SKELETONS} esqueletos`, "limit");
  const sk: Skeleton = { id: longId(), name: name?.trim() || `Esqueleto ${skeletonsOf(a).length + 1}`, bones, bindings: [] };
  return { doc: { ...a, rigs: [...skeletonsOf(a), sk] }, skeletonId: sk.id };
}

export function renameSkeleton(a: Animation, id: string, name: string): Animation {
  const n = name.trim();
  if (!n) throw new EngineError("El nombre no puede estar vacío", "invalid");
  return patchSkeleton(a, id, (s) => ({ ...s, name: n.slice(0, 60) }));
}

/** Elimina el esqueleto, sus vínculos y todos sus keyframes de pose. */
export function removeSkeleton(a: Animation, id: string): Animation {
  skeletonById(a, id);
  const rigs = skeletonsOf(a).filter((s) => s.id !== id);
  return {
    ...a,
    rigs: rigs.length ? rigs : undefined,
    frames: a.frames.map((f) => {
      if (!f.poses?.[id]) return f;
      const { [id]: _removed, ...rest } = f.poses;
      void _removed;
      const next = { ...f };
      if (Object.keys(rest).length) next.poses = rest;
      else delete next.poses;
      return next;
    }),
  };
}

/* ───────────────────────── Huesos ───────────────────────── */

/** Calcula los parámetros LOCALES de un hueso a partir de su cabeza y cola en el lienzo (en reposo). */
function localFromWorld(sk: Pick<Skeleton, "bones">, parentId: string | null, head: Vec, tail: Vec): Pick<Bone, "x" | "y" | "ax" | "ay" | "angle" | "length"> {
  const length = Math.max(1, Math.hypot(tail[0] - head[0], tail[1] - head[1]));
  const worldAngle = Math.atan2(tail[1] - head[1], tail[0] - head[0]);
  if (parentId === null) return { x: r3(head[0]), y: r3(head[1]), ax: 1, ay: 0, angle: norm180(toDeg(worldAngle)), length: r3(length) };
  const P = restStates(sk).get(parentId);
  if (!P) throw new EngineError("El hueso padre no existe", "not-found");
  const d: Vec = [Math.cos(P.angle), Math.sin(P.angle)];
  const n: Vec = [-d[1], d[0]];
  const v: Vec = [head[0] - P.head[0], head[1] - P.head[1]];
  return { x: 0, y: 0, ax: r3((v[0] * d[0] + v[1] * d[1]) / P.length), ay: r3(v[0] * n[0] + v[1] * n[1]), angle: norm180(toDeg(worldAngle - P.angle)), length: r3(length) };
}

export interface NewBone {
  name?: string;
  parent: string | null;
  head: Vec;
  tail: Vec;
  min?: number;
  max?: number;
}

export function addBone(a: Animation, skeletonId: string, spec: NewBone): { doc: Animation; boneId: string } {
  const sk = skeletonById(a, skeletonId);
  if (sk.bones.length >= MAX_BONES) throw new EngineError(`Máximo ${MAX_BONES} huesos por esqueleto`, "limit");
  if (spec.parent !== null && !boneById(sk, spec.parent)) throw new EngineError("El hueso padre no existe", "not-found");
  const bone: Bone = {
    id: longId(),
    name: spec.name?.trim() || `Hueso ${sk.bones.length + 1}`,
    parent: spec.parent,
    min: spec.min ?? -180,
    max: spec.max ?? 180,
    ...localFromWorld(sk, spec.parent, spec.head, spec.tail),
  };
  return { doc: patchSkeleton(a, skeletonId, (s) => ({ ...s, bones: [...s.bones, bone] })), boneId: bone.id };
}

/** Nuevo hueso hijo, continuando la dirección del padre desde su cola. */
export function addChildBone(a: Animation, skeletonId: string, parentId: string, name?: string): { doc: Animation; boneId: string } {
  const sk = skeletonById(a, skeletonId);
  const P = restStates(sk).get(parentId);
  if (!P) throw new EngineError("El hueso padre no existe", "not-found");
  const len = Math.max(10, P.length * 0.8);
  return addBone(a, skeletonId, { ...(name ? { name } : {}), parent: parentId, head: P.tail, tail: [P.tail[0] + Math.cos(P.angle) * len, P.tail[1] + Math.sin(P.angle) * len] });
}

export type BonePatch = Partial<Pick<Bone, "name" | "length" | "angle" | "ax" | "ay" | "x" | "y" | "min" | "max">>;

export function updateBone(a: Animation, skeletonId: string, boneId: string, patch: BonePatch): Animation {
  const sk = skeletonById(a, skeletonId);
  const b = boneById(sk, boneId);
  if (!b) throw new EngineError("El hueso no existe", "not-found");
  const next: Bone = { ...b, ...patch };
  if (patch.name !== undefined) {
    next.name = patch.name.trim().slice(0, 60);
    if (!next.name) throw new EngineError("El nombre no puede estar vacío", "invalid");
  }
  for (const k of ["length", "angle", "ax", "ay", "x", "y", "min", "max"] as const) if (!Number.isFinite(next[k])) throw new EngineError("Valor numérico no válido", "invalid");
  if (next.length < 1) throw new EngineError("La longitud debe ser de al menos 1 px", "invalid");
  if (next.min > next.max) throw new EngineError("El límite mínimo no puede superar al máximo", "invalid");
  return patchSkeleton(a, skeletonId, (s) => ({ ...s, bones: s.bones.map((x) => (x.id === boneId ? next : x)) }));
}

/** Mueve la articulación (cabeza) a un punto del lienzo. El hueso conserva longitud y orientación; sus hijos le siguen. */
export function moveBoneHead(a: Animation, skeletonId: string, boneId: string, head: Vec): Animation {
  const sk = skeletonById(a, skeletonId);
  const b = boneById(sk, boneId);
  if (!b) throw new EngineError("El hueso no existe", "not-found");
  const S = restStates(sk).get(boneId)!;
  const loc = localFromWorld(sk, b.parent, head, [head[0] + Math.cos(S.angle) * S.length, head[1] + Math.sin(S.angle) * S.length]);
  return updateBone(a, skeletonId, boneId, b.parent === null ? { x: loc.x, y: loc.y } : { ax: loc.ax, ay: loc.ay });
}

/** Mueve el extremo (cola): cambia longitud y orientación. */
export function setBoneTail(a: Animation, skeletonId: string, boneId: string, tail: Vec): Animation {
  const sk = skeletonById(a, skeletonId);
  const b = boneById(sk, boneId);
  if (!b) throw new EngineError("El hueso no existe", "not-found");
  const S = restStates(sk).get(boneId)!;
  const loc = localFromWorld(sk, b.parent, S.head, tail);
  return updateBone(a, skeletonId, boneId, { length: loc.length, angle: loc.angle });
}

/** Orden topológico estable (los padres antes que sus hijos). */
function topoSort(bones: readonly Bone[]): Bone[] {
  const out: Bone[] = [];
  const placed = new Set<string>();
  const pending = [...bones];
  while (pending.length) {
    const before = pending.length;
    for (let i = 0; i < pending.length; ) {
      const b = pending[i]!;
      if (b.parent === null || placed.has(b.parent)) {
        out.push(b);
        placed.add(b.id);
        pending.splice(i, 1);
      } else i++;
    }
    if (pending.length === before) throw new EngineError("Jerarquía de huesos con un ciclo", "invalid");
  }
  return out;
}

/** Cambia el padre sin mover el hueso en el lienzo (conserva su posición y orientación de reposo). */
export function reparentBone(a: Animation, skeletonId: string, boneId: string, newParent: string | null): Animation {
  const sk = skeletonById(a, skeletonId);
  const b = boneById(sk, boneId);
  if (!b) throw new EngineError("El hueso no existe", "not-found");
  if (b.parent === newParent) return a;
  if (newParent !== null) {
    if (!boneById(sk, newParent)) throw new EngineError("El hueso padre no existe", "not-found");
    if (descendants(sk, boneId).includes(newParent)) throw new EngineError("Un hueso no puede ser hijo de sí mismo ni de sus descendientes", "invalid");
  }
  const S = restStates(sk).get(boneId)!;
  const loc = localFromWorld(sk, newParent, S.head, S.tail);
  const moved: Bone = { ...b, parent: newParent, ...loc };
  return patchSkeleton(a, skeletonId, (s) => ({ ...s, bones: topoSort(s.bones.map((x) => (x.id === boneId ? moved : x))) }));
}

/** Elimina el hueso y sus descendientes. Limpia vínculos y keyframes que los mencionaban. */
export function removeBone(a: Animation, skeletonId: string, boneId: string): { doc: Animation; removed: string[] } {
  const sk = skeletonById(a, skeletonId);
  if (!boneById(sk, boneId)) throw new EngineError("El hueso no existe", "not-found");
  const gone = new Set(descendants(sk, boneId));
  const bones = sk.bones.filter((b) => !gone.has(b.id));
  const bindings: Binding[] = [];
  for (const bd of sk.bindings) {
    if (!gone.has(bd.bone)) {
      bindings.push({ ...bd, influences: bd.influences.filter((i) => !gone.has(i)) });
      continue;
    }
    // el hueso principal desapareció: un skin puede seguir con otro de sus influencias; un rígido pierde su vínculo
    const rest = bd.influences.filter((i) => !gone.has(i));
    if (bd.mode === "skin" && rest.length) bindings.push({ ...bd, bone: rest[0]!, influences: rest });
  }
  let doc = patchSkeleton(a, skeletonId, (s) => ({ ...s, bones, bindings }));
  doc = {
    ...doc,
    frames: doc.frames.map((f) => {
      const k = f.poses?.[skeletonId];
      if (!k || !Object.keys(k.bones).some((id) => gone.has(id))) return f;
      const kept = Object.fromEntries(Object.entries(k.bones).filter(([id]) => !gone.has(id)));
      return { ...f, poses: { ...f.poses, [skeletonId]: { ...k, bones: kept } } };
    }),
  };
  return { doc, removed: [...gone] };
}

/* ───────────────────────── Vínculos capa ↔ hueso ───────────────────────── */

export const DEFAULT_SOFTNESS = 20;
export const DEFAULT_SHARPNESS = 3;

export function bindingOfLayer(a: Pick<Animation, "rigs">, layerId: string): { skeleton: Skeleton; binding: Binding } | null {
  for (const s of skeletonsOf(a)) {
    const b = s.bindings.find((x) => x.layerId === layerId);
    if (b) return { skeleton: s, binding: b };
  }
  return null;
}

/**
 * Crea, cambia o quita (`binding = null`) el vínculo de una capa. Una capa solo puede estar vinculada a UN esqueleto:
 * si ya lo estaba en otro, se mueve. Varias capas pueden compartir hueso y cada capa puede tener el suyo.
 */
export function setBinding(a: Animation, skeletonId: string, layerId: string, binding: Omit<Binding, "layerId"> | null): Animation {
  layerIndex(a, layerId);
  const sk = skeletonById(a, skeletonId);
  if (binding) {
    if (!boneById(sk, binding.bone)) throw new EngineError("El hueso del vínculo no existe", "not-found");
    for (const i of binding.influences) if (!boneById(sk, i)) throw new EngineError("Una influencia apunta a un hueso inexistente", "not-found");
    if (binding.mode === "skin" && ![binding.bone, ...binding.influences].length) throw new EngineError("El vínculo deformable necesita al menos un hueso", "invalid");
  }
  const rigs = skeletonsOf(a).map((s) => {
    const others = s.bindings.filter((b) => b.layerId !== layerId);
    if (s.id !== skeletonId) return others.length === s.bindings.length ? s : { ...s, bindings: others };
    return { ...s, bindings: binding ? [...others, { layerId, ...binding, influences: [...new Set(binding.mode === "skin" ? [binding.bone, ...binding.influences] : [])] }] : others };
  });
  return { ...a, rigs };
}

/* ───────────────────────── Poses y keyframes ───────────────────────── */

export function poseAtFrame(a: Animation, frameIndex: number, skeletonId: string): ResolvedPose {
  return resolvePose(a.frames, skeletonById(a, skeletonId), frameIndex);
}

export function hasKey(a: Animation, frameIndex: number, skeletonId: string): boolean {
  return !!a.frames[frameIndex]?.poses?.[skeletonId];
}

function withKey(a: Animation, frameIndex: number, skeletonId: string, key: PoseKey | null): Animation {
  const f = a.frames[frameIndex];
  if (!f) throw new EngineError("Fotograma inexistente", "not-found");
  let poses: Record<string, PoseKey> | undefined;
  if (key) poses = { ...f.poses, [skeletonId]: key };
  else if (f.poses?.[skeletonId]) {
    const { [skeletonId]: _gone, ...rest } = f.poses;
    void _gone;
    poses = Object.keys(rest).length ? rest : undefined;
  } else return a;
  const nf = { ...f };
  if (poses) nf.poses = poses;
  else delete nf.poses;
  return { ...a, frames: a.frames.map((x, i) => (i === frameIndex ? nf : x)) };
}

/** Guarda el keyframe completo de un fotograma (con límites aplicados). `bones` null = elimina el keyframe. */
export function setPose(a: Animation, frameIndex: number, skeletonId: string, bones: Readonly<Record<string, BonePose>> | null, ease?: Ease): Animation {
  if (bones === null) return withKey(a, frameIndex, skeletonId, null);
  const sk = skeletonById(a, skeletonId);
  const prev = a.frames[frameIndex]?.poses?.[skeletonId];
  return withKey(a, frameIndex, skeletonId, poseToKey(resolveBones(sk, bones), sk, ease ?? prev?.ease ?? "linear"));
}

/** Edita un hueso en un fotograma: parte de la pose que ya se ve ahí (guardada o interpolada) y crea el keyframe si no existía. */
export function setBonePose(a: Animation, frameIndex: number, skeletonId: string, boneId: string, value: BonePose): Animation {
  const sk = skeletonById(a, skeletonId);
  if (!boneById(sk, boneId)) throw new EngineError("El hueso no existe", "not-found");
  const cur = resolvePose(a.frames, sk, frameIndex);
  const bones: Record<string, BonePose> = {};
  for (const b of sk.bones) {
    const p = cur.get(b.id)!;
    bones[b.id] = b.parent ? { r: p.r } : { r: p.r, x: p.x, y: p.y };
  }
  bones[boneId] = { ...bones[boneId], ...value };
  return setPose(a, frameIndex, skeletonId, bones);
}

export function resetPose(a: Animation, frameIndex: number, skeletonId: string): Animation {
  const sk = skeletonById(a, skeletonId);
  return setPose(a, frameIndex, skeletonId, Object.fromEntries(sk.bones.map((b) => [b.id, b.parent ? { r: 0 } : { r: 0, x: 0, y: 0 }])));
}

export function setKeyEase(a: Animation, frameIndex: number, skeletonId: string, ease: Ease): Animation {
  const k = a.frames[frameIndex]?.poses?.[skeletonId];
  if (!k) throw new EngineError("Este fotograma no tiene keyframe", "not-found");
  return withKey(a, frameIndex, skeletonId, { ...k, ease });
}

/** Copia la pose (la que se ve en `from`) como keyframe de `to`. */
export function copyPose(a: Animation, fromIndex: number, toIndex: number, skeletonId: string): Animation {
  const sk = skeletonById(a, skeletonId);
  const pose = resolvePose(a.frames, sk, fromIndex);
  const ease = a.frames[toIndex]?.poses?.[skeletonId]?.ease ?? a.frames[fromIndex]?.poses?.[skeletonId]?.ease ?? "linear";
  return withKey(a, toIndex, skeletonId, poseToKey(pose, sk, ease));
}

/** Pega una pose guardada (portapapeles) como keyframe. Los huesos que ya no existen se ignoran. */
export function pastePose(a: Animation, toIndex: number, skeletonId: string, key: PoseKey): Animation {
  skeletonById(a, skeletonId); // valida que el esqueleto existe
  return setPose(a, toIndex, skeletonId, key.bones, key.ease);
}

/** Todos los keyframes del esqueleto: [índice de fotograma]. */
export function keyFrames(a: Animation, skeletonId: string): number[] {
  const out: number[] = [];
  a.frames.forEach((f, i) => {
    if (f.poses?.[skeletonId]) out.push(i);
  });
  return out;
}

/* ───────────────────────── Dibujo ↔ capas (apoyo al rig) ───────────────────────── */

/** Mueve trazos de una capa a otra del mismo fotograma (para separar las partes de un personaje en capas). */
export function moveStrokes(a: Animation, frameId: string, fromLayer: string, toLayer: string, ids: ReadonlySet<string>): Animation {
  if (fromLayer === toLayer) return a;
  assertEditable(a, fromLayer);
  assertEditable(a, toLayer);
  const fi = frameIndexById(a, frameId);
  const frame = a.frames[fi]!;
  const src = frame.cells[fromLayer] ?? [];
  const moving = src.filter((s) => ids.has(s.id));
  if (moving.length === 0) return a;
  const keep = src.filter((s) => !ids.has(s.id));
  const cells = { ...frame.cells, [toLayer]: [...(frame.cells[toLayer] ?? []), ...moving] };
  if (keep.length) cells[fromLayer] = keep;
  else delete cells[fromLayer];
  return { ...a, frames: a.frames.map((f, i) => (i === fi ? { ...f, cells } : f)) };
}

/** Copia el dibujo de unas capas de un fotograma a TODOS los demás (propaga la corrección de una parte del personaje). */
export function syncLayers(a: Animation, fromFrameId: string, layerIds: readonly string[]): Animation {
  const src = a.frames[frameIndexById(a, fromFrameId)]!;
  for (const l of layerIds) layerIndex(a, l);
  return {
    ...a,
    frames: a.frames.map((f) => {
      if (f.id === fromFrameId) return f;
      const cells = { ...f.cells };
      for (const l of layerIds) {
        const s = src.cells[l];
        if (s && s.length) cells[l] = s;
        else delete cells[l];
      }
      return { ...f, cells };
    }),
  };
}

/* ───────────────────────── Plantilla humanoide (opcional) ───────────────────────── */

/**
 * Esqueleto humanoide de ejemplo, escalado a `height` px y con los pies en (cx, groundY).
 * Es solo un PUNTO DE PARTIDA: todos los huesos se pueden mover, renombrar, reorganizar, añadir o quitar.
 * «Izquierdo/derecho» son los del PERSONAJE visto de frente (el izquierdo queda a la derecha de la pantalla).
 */
export function humanoidBones(cx: number, groundY: number, height: number): Bone[] {
  const H = height;
  const hipY = groundY - 0.5 * H;
  const bones: Bone[] = [];
  const add = (name: string, parent: string | null, p: Partial<Bone> & { length: number }): string => {
    const id = longId();
    bones.push({ id, name, parent, x: 0, y: 0, ax: 1, ay: 0, angle: 0, min: -180, max: 180, ...p, length: r3(p.length) });
    return id;
  };
  const cadera = add("Cadera", null, { x: cx, y: hipY, angle: -90, length: 0.07 * H, min: -60, max: 60 });
  const torso = add("Torso", cadera, { length: 0.28 * H, min: -45, max: 45 });
  const cuello = add("Cuello", torso, { length: 0.05 * H, min: -40, max: 40 });
  add("Cabeza", cuello, { length: 0.14 * H, min: -60, max: 60 });
  for (const side of ["izq.", "der."] as const) {
    const s = side === "izq." ? 1 : -1; // izq. = derecha de la pantalla
    const sh = add(`Brazo superior ${side}`, torso, { ax: 0.93, ay: s * 0.1 * H, angle: 180 - s * 10, length: 0.17 * H });
    const el = add(`Brazo inferior ${side}`, sh, { length: 0.15 * H, min: s > 0 ? -10 : -150, max: s > 0 ? 150 : 10 });
    add(`Mano ${side}`, el, { length: 0.07 * H, min: -70, max: 70 });
    const th = add(`Pierna superior ${side}`, cadera, { ax: 0, ay: s * 0.045 * H, angle: 180 - s * 3, length: 0.23 * H, min: -100, max: 100 });
    const kn = add(`Pierna inferior ${side}`, th, { length: 0.22 * H, min: s > 0 ? -150 : -10, max: s > 0 ? 10 : 150 });
    add(`Pie ${side}`, kn, { length: 0.05 * H, min: -45, max: 45 });
  }
  return bones;
}

export function createHumanoid(a: Animation, cx: number, groundY: number, height: number, name = "Humanoide"): { doc: Animation; skeletonId: string } {
  return createSkeleton(a, name, humanoidBones(cx, groundY, height));
}

export { toRad as _toRad };
