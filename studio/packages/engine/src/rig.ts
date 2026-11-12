import type { Animation, Binding, Bone, BonePose, Ease, Frame, Matrix, PoseKey, Skeleton, Stroke } from "@gas/core";

/* ───────────────────────── Geometría de huesos ───────────────────────── */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
export const toRad = (d: number) => d * RAD;
export const toDeg = (r: number) => r * DEG;

export type Vec = [number, number];

/** Estado geométrico de un hueso en el lienzo: cabeza, ángulo absoluto (rad) y cola. */
export interface BoneState {
  head: Vec;
  angle: number;
  length: number;
  tail: Vec;
}
export type SkeletonState = ReadonlyMap<string, BoneState>;

/** Pose RESUELTA (interpolada y con los límites aplicados): giro en grados y, en raíces, desplazamiento. */
export interface ResolvedBone {
  r: number;
  x: number;
  y: number;
}
export type ResolvedPose = ReadonlyMap<string, ResolvedBone>;

const dir = (a: number): Vec => [Math.cos(a), Math.sin(a)];

function stateOf(bone: Bone, parent: BoneState | undefined, extraRotDeg: number, dx: number, dy: number): BoneState {
  let head: Vec;
  let angle: number;
  if (!parent) {
    head = [bone.x + dx, bone.y + dy];
    angle = toRad(bone.angle + extraRotDeg);
  } else {
    const d = dir(parent.angle);
    const n: Vec = [-d[1], d[0]]; // normal del padre
    const along = bone.ax * parent.length;
    head = [parent.head[0] + d[0] * along + n[0] * bone.ay, parent.head[1] + d[1] * along + n[1] * bone.ay];
    angle = parent.angle + toRad(bone.angle + extraRotDeg);
  }
  const t = dir(angle);
  return { head, angle, length: bone.length, tail: [head[0] + t[0] * bone.length, head[1] + t[1] * bone.length] };
}

const restCache = new WeakMap<readonly Bone[], SkeletonState>();

/** Geometría de REPOSO (la del dibujo). Se cachea por identidad del array de huesos. */
export function restStates(sk: Pick<Skeleton, "bones">): SkeletonState {
  const hit = restCache.get(sk.bones);
  if (hit) return hit;
  const m = new Map<string, BoneState>();
  for (const b of sk.bones) m.set(b.id, stateOf(b, b.parent ? m.get(b.parent) : undefined, 0, 0, 0));
  restCache.set(sk.bones, m);
  return m;
}

/** Geometría con una pose aplicada. La rotación y la traslación se heredan por la jerarquía. */
export function poseStates(sk: Pick<Skeleton, "bones">, pose: ResolvedPose): SkeletonState {
  const m = new Map<string, BoneState>();
  for (const b of sk.bones) {
    const p = pose.get(b.id);
    m.set(b.id, stateOf(b, b.parent ? m.get(b.parent) : undefined, p?.r ?? 0, b.parent ? 0 : (p?.x ?? 0), b.parent ? 0 : (p?.y ?? 0)));
  }
  return m;
}

/** Matriz que lleva un punto del reposo a la pose a través del hueso: gira Δ alrededor de su cabeza y la traslada. */
export function boneMatrix(rest: BoneState, posed: BoneState): Matrix {
  const d = posed.angle - rest.angle;
  const c = Math.cos(d);
  const s = Math.sin(d);
  return { a: c, b: s, c: -s, d: c, e: posed.head[0] - (c * rest.head[0] - s * rest.head[1]), f: posed.head[1] - (s * rest.head[0] + c * rest.head[1]) };
}

export function skinMatrices(sk: Pick<Skeleton, "bones">, posed: SkeletonState): Map<string, Matrix> {
  const rest = restStates(sk);
  const out = new Map<string, Matrix>();
  for (const b of sk.bones) out.set(b.id, boneMatrix(rest.get(b.id)!, posed.get(b.id)!));
  return out;
}

const isIdentity = (m: Matrix) => Math.abs(m.a - 1) + Math.abs(m.b) + Math.abs(m.c) + Math.abs(m.d - 1) + Math.abs(m.e) + Math.abs(m.f) < 1e-9;

/* ───────────────────────── Jerarquía ───────────────────────── */

export const boneById = (sk: Pick<Skeleton, "bones">, id: string): Bone | undefined => sk.bones.find((b) => b.id === id);
export const childrenOf = (sk: Pick<Skeleton, "bones">, id: string): Bone[] => sk.bones.filter((b) => b.parent === id);

/** El hueso y todos sus descendientes. */
export function descendants(sk: Pick<Skeleton, "bones">, id: string): string[] {
  const out = new Set<string>([id]);
  for (const b of sk.bones) if (b.parent && out.has(b.parent)) out.add(b.id); // orden topológico: basta una pasada
  return [...out];
}

/** Cadena de ancestros, del padre directo a la raíz. */
export function ancestors(sk: Pick<Skeleton, "bones">, id: string): string[] {
  const out: string[] = [];
  let b = boneById(sk, id);
  while (b?.parent) {
    out.push(b.parent);
    b = boneById(sk, b.parent);
  }
  return out;
}

/* ───────────────────────── Poses, límites e interpolación ───────────────────────── */

export const clampRotation = (bone: Pick<Bone, "min" | "max">, r: number) => Math.min(bone.max, Math.max(bone.min, r));

const REST: ResolvedBone = { r: 0, x: 0, y: 0 };

export function restPose(sk: Pick<Skeleton, "bones">): ResolvedPose {
  return new Map(sk.bones.map((b) => [b.id, REST]));
}

export function easeValue(ease: Ease, t: number): number {
  if (ease === "step") return 0; // se mantiene la pose anterior hasta el siguiente key
  if (ease === "smooth") return t * t * (3 - 2 * t);
  return t;
}

const tickCache = new WeakMap<readonly Frame[], Float64Array>();
/** Tick de inicio de cada dibujo (suma de duraciones): el MISMO reloj que reproducción y exportación. */
export function frameStartTicks(frames: readonly Frame[]): Float64Array {
  let t = tickCache.get(frames);
  if (!t) {
    t = new Float64Array(frames.length);
    let acc = 0;
    for (let i = 0; i < frames.length; i++) {
      t[i] = acc;
      acc += frames[i]!.hold;
    }
    tickCache.set(frames, t);
  }
  return t;
}

const keyCache = new WeakMap<readonly Frame[], Map<string, number[]>>();
/** Índices de los fotogramas que tienen un keyframe de este esqueleto, ordenados. */
export function keyIndices(frames: readonly Frame[], skeletonId: string): number[] {
  let per = keyCache.get(frames);
  if (!per) keyCache.set(frames, (per = new Map()));
  let k = per.get(skeletonId);
  if (!k) {
    k = [];
    frames.forEach((f, i) => {
      if (f.poses?.[skeletonId]) k!.push(i);
    });
    per.set(skeletonId, k);
  }
  return k;
}

function keyToPose(sk: Pick<Skeleton, "bones">, key: PoseKey): Map<string, ResolvedBone> {
  const m = new Map<string, ResolvedBone>();
  for (const b of sk.bones) {
    const p: BonePose | undefined = key.bones[b.id];
    m.set(b.id, { r: p?.r ?? 0, x: p?.x ?? 0, y: p?.y ?? 0 });
  }
  return m;
}

/** Pasa a ResolvedPose un mapa de giros, aplicando los límites articulares. */
export function resolveBones(sk: Pick<Skeleton, "bones">, bones: Readonly<Record<string, BonePose>>): ResolvedPose {
  const m = new Map<string, ResolvedBone>();
  for (const b of sk.bones) {
    const p = bones[b.id];
    m.set(b.id, { r: clampRotation(b, p?.r ?? 0), x: p?.x ?? 0, y: p?.y ?? 0 });
  }
  return m;
}

/**
 * Pose de un esqueleto en un fotograma.
 *  - Sin keyframes: reposo.   - Antes del primero / después del último: se mantiene esa pose.
 *  - Entre dos keys: interpolación por TIEMPO (ticks) según la suavidad del key anterior.
 * Los límites articulares se aplican siempre al resultado.
 */
export function resolvePose(frames: readonly Frame[], sk: Skeleton, frameIndex: number): ResolvedPose {
  const keys = keyIndices(frames, sk.id);
  if (keys.length === 0) return restPose(sk);
  let prev = -1;
  let next = -1;
  for (const k of keys) {
    if (k <= frameIndex) prev = k;
    else {
      next = k;
      break;
    }
  }
  const finish = (m: Map<string, ResolvedBone>): ResolvedPose => {
    for (const b of sk.bones) {
      const p = m.get(b.id)!;
      const r = clampRotation(b, p.r);
      if (r !== p.r) m.set(b.id, { ...p, r });
    }
    return m;
  };
  if (prev < 0) return finish(keyToPose(sk, frames[next]!.poses![sk.id]!));
  const a = frames[prev]!.poses![sk.id]!;
  const pa = keyToPose(sk, a);
  if (next < 0 || prev === frameIndex) return finish(pa);
  const pb = keyToPose(sk, frames[next]!.poses![sk.id]!);
  const ticks = frameStartTicks(frames);
  const span = ticks[next]! - ticks[prev]!;
  const t = span > 0 ? (ticks[frameIndex]! - ticks[prev]!) / span : 0;
  const e = easeValue(a.ease, t);
  const out = new Map<string, ResolvedBone>();
  for (const b of sk.bones) {
    const x = pa.get(b.id)!;
    const y = pb.get(b.id)!;
    out.set(b.id, { r: x.r + (y.r - x.r) * e, x: x.x + (y.x - x.x) * e, y: x.y + (y.y - x.y) * e });
  }
  return finish(out);
}

/** Pose resuelta → keyframe (lo que se guarda). */
export function poseToKey(pose: ResolvedPose, sk: Pick<Skeleton, "bones">, ease: Ease = "linear"): PoseKey {
  const bones: Record<string, BonePose> = {};
  for (const b of sk.bones) {
    const p = pose.get(b.id) ?? REST;
    bones[b.id] = b.parent ? { r: round(p.r) } : { r: round(p.r), x: round(p.x), y: round(p.y) };
  }
  return { bones, ease };
}
const round = (n: number) => Math.round(n * 1000) / 1000;

/* ───────────────────────── Vinculación y deformación ───────────────────────── */

/** Subdivide el trazo para que ningún tramo supere `maxSeg` px: sin puntos intermedios una línea recta no podría doblarse. */
export function densify(s: Stroke, maxSeg = 4): Stroke {
  const p = s.points;
  const n = p.length / 3;
  if (n < 2) return s;
  const out: number[] = [p[0]!, p[1]!, p[2]!];
  for (let i = 1; i < n; i++) {
    const x0 = p[(i - 1) * 3]!, y0 = p[(i - 1) * 3 + 1]!, q0 = p[(i - 1) * 3 + 2]!;
    const x1 = p[i * 3]!, y1 = p[i * 3 + 1]!, q1 = p[i * 3 + 2]!;
    const steps = Math.min(400, Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / maxSeg)));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, q0 + (q1 - q0) * t);
    }
  }
  return out.length > 300_000 ? s : { ...s, points: out };
}

function distToSegment(px: number, py: number, a: Vec, b: Vec): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

/**
 * Peso de un punto respecto a cada hueso que influye: w ∝ 1 / (distancia al hueso + suavidad)^nitidez, normalizados.
 * Los pesos suman 1, así que el punto resultante es una COMBINACIÓN CONVEXA de las posiciones que darían sus huesos:
 * nunca se sale de lo que los propios huesos producirían (sin explosiones ni extrapolación).
 */
export function pointWeights(x: number, y: number, bones: readonly BoneState[], softness: number, sharpness: number, out: Float64Array | number[] = new Array(bones.length)): Float64Array | number[] {
  let sum = 0;
  for (let i = 0; i < bones.length; i++) {
    const w = Math.pow(distToSegment(x, y, bones[i]!.head, bones[i]!.tail) + softness, -sharpness);
    out[i] = w;
    sum += w;
  }
  for (let i = 0; i < bones.length; i++) out[i] = out[i]! / sum;
  return out;
}

/** Influencias máximas por punto (estándar en skinning): acota el coste a O(puntos · 4), sin depender del nº de huesos. */
export const MAX_INFLUENCES = 4;

interface SkinData {
  bonesRef: readonly Bone[];
  ids: string[];
  strokes: Stroke[];
  /** Por trazo y punto: índices (en `ids`) y pesos de sus `k` huesos más influyentes, ya normalizados. */
  idx: Uint8Array[];
  weights: Float32Array[];
  k: number;
}
const skinCache = new WeakMap<readonly Stroke[], WeakMap<Binding, SkinData>>();

function skinData(strokes: readonly Stroke[], binding: Binding, sk: Pick<Skeleton, "bones">): SkinData | null {
  let per = skinCache.get(strokes);
  if (!per) skinCache.set(strokes, (per = new WeakMap()));
  const hit = per.get(binding);
  if (hit && hit.bonesRef === sk.bones) return hit;
  const rest = restStates(sk);
  const ids = [...new Set([binding.bone, ...binding.influences])].filter((id) => rest.has(id));
  if (ids.length === 0) return null;
  const states = ids.map((id) => rest.get(id)!);
  const n = ids.length;
  const K = Math.min(MAX_INFLUENCES, n);
  // Con zona de mezcla de `softness` px, muestrear cada ~softness/2.5 basta para captar la curva de la articulación.
  const seg = Math.min(12, Math.max(3, binding.softness / 2.5));
  const dens: Stroke[] = [];
  const idxs: Uint8Array[] = [];
  const weights: Float32Array[] = [];
  const raw = new Float64Array(n);
  const topI = new Int32Array(K);
  const topW = new Float64Array(K);
  for (const s of strokes) {
    const d = densify(s, seg);
    const m = d.points.length / 3;
    const ix = new Uint8Array(m * K);
    const w = new Float32Array(m * K);
    for (let i = 0; i < m; i++) {
      pointWeights(d.points[i * 3]!, d.points[i * 3 + 1]!, states, binding.softness, binding.sharpness, raw);
      // los K mayores (inserción en una lista pequeña)
      let used = 0;
      for (let j = 0; j < n; j++) {
        const v = raw[j]!;
        if (used < K) {
          let p = used++;
          while (p > 0 && topW[p - 1]! < v) { topW[p] = topW[p - 1]!; topI[p] = topI[p - 1]!; p--; }
          topW[p] = v; topI[p] = j;
        } else if (v > topW[K - 1]!) {
          let p = K - 1;
          while (p > 0 && topW[p - 1]! < v) { topW[p] = topW[p - 1]!; topI[p] = topI[p - 1]!; p--; }
          topW[p] = v; topI[p] = j;
        }
      }
      let sum = 0;
      for (let j = 0; j < K; j++) sum += topW[j]!;
      for (let j = 0; j < K; j++) { ix[i * K + j] = topI[j]!; w[i * K + j] = topW[j]! / sum; }
    }
    dens.push(d);
    idxs.push(ix);
    weights.push(w);
  }
  const data: SkinData = { bonesRef: sk.bones, ids, strokes: dens, idx: idxs, weights, k: K };
  per.set(binding, data);
  return data;
}

/** Pesos y trazos subdivididos de un vínculo deformable (para visualizar las influencias). */
export function skinPreview(strokes: readonly Stroke[], binding: Binding, sk: Pick<Skeleton, "bones">): { ids: string[]; strokes: Stroke[]; idx: Uint8Array[]; weights: Float32Array[]; k: number } | null {
  const d = binding.mode === "skin" ? skinData(strokes, binding, sk) : null;
  return d ? { ids: d.ids, strokes: d.strokes, idx: d.idx, weights: d.weights, k: d.k } : null;
}

function mapPoints(s: Stroke, f: (x: number, y: number, i: number) => Vec): Stroke {
  const p = s.points;
  const out = new Array<number>(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const [x, y] = f(p[i]!, p[i + 1]!, i / 3);
    out[i] = x;
    out[i + 1] = y;
    out[i + 2] = p[i + 2]!;
  }
  return { ...s, points: out };
}

/**
 * Aplica un vínculo a los trazos de una capa.
 *  - rigid: todos los puntos siguen la matriz de UN hueso (giro alrededor de su articulación).
 *  - skin: cada punto se mueve con la media ponderada de las matrices de varios huesos (skinning lineal sobre los
 *    puntos de control de los trazos). NO es una malla de triángulos: se deforma el propio trazo vectorial.
 * Si la pose no mueve nada devuelve EL MISMO array (conserva las cachés de mapas de bits).
 */
export function deformStrokes(strokes: readonly Stroke[], binding: Binding, sk: Skeleton, mats: ReadonlyMap<string, Matrix>): readonly Stroke[] {
  if (strokes.length === 0) return strokes;
  if (binding.mode === "rigid") {
    const m = mats.get(binding.bone);
    if (!m || isIdentity(m)) return strokes;
    return strokes.map((s) => mapPoints(s, (x, y) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]));
  }
  const data = skinData(strokes, binding, sk);
  if (!data) return strokes;
  const ms = data.ids.map((id) => mats.get(id)!);
  if (ms.every(isIdentity)) return strokes;
  const K = data.k;
  return data.strokes.map((s, si) => {
    const ix = data.idx[si]!;
    const w = data.weights[si]!;
    const p = s.points;
    const out = new Array<number>(p.length);
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i]!;
      const y = p[i + 1]!;
      const base = (i / 3) * K;
      let X = 0;
      let Y = 0;
      for (let j = 0; j < K; j++) {
        const m = ms[ix[base + j]!]!;
        const wj = w[base + j]!;
        X += wj * (m.a * x + m.c * y + m.e);
        Y += wj * (m.b * x + m.d * y + m.f);
      }
      out[i] = X;
      out[i + 1] = Y;
      out[i + 2] = p[i + 2]!;
    }
    return { ...s, points: out };
  });
}

/* ───────────────────────── Fotograma con pose aplicada ───────────────────────── */

/** Pose «en vivo» (aún no guardada) para previsualizar mientras se arrastra un hueso. */
export interface PoseOverride {
  skeletonId: string;
  bones: Readonly<Record<string, BonePose>>;
}

type RigDoc = Pick<Animation, "frames" | "rigs">;

const poseSig = (pose: ResolvedPose): string => {
  let s = "";
  for (const [id, p] of pose) s += `${id}:${p.r.toFixed(4)},${p.x.toFixed(2)},${p.y.toFixed(2)};`;
  return s;
};

interface Memo {
  rigs: readonly Skeleton[];
  sig: string;
  out: Frame;
  cost: number;
}
const MEMO_BUDGET = 4_000_000; // números (≈32 MB) de trazos deformados que se conservan
const memo = new Map<Frame, Memo>();
let memoCost = 0;

function remember(frame: Frame, m: Memo): void {
  const old = memo.get(frame);
  if (old) {
    memoCost -= old.cost;
    memo.delete(frame);
  }
  memo.set(frame, m);
  memoCost += m.cost;
  for (const [k, v] of memo) {
    if (memoCost <= MEMO_BUDGET || k === frame) break;
    memo.delete(k);
    memoCost -= v.cost;
  }
}

/** ¿Algún esqueleto de este documento deforma capas? */
export const hasRig = (doc: Pick<Animation, "rigs">) => (doc.rigs ?? []).some((s) => s.bindings.length > 0);

/**
 * EL punto donde se aplica el rig: devuelve el fotograma con las capas vinculadas deformadas por la pose de ese
 * instante. Lo usan el lienzo, la reproducción, las miniaturas, el papel cebolla y el exportador, así que todos
 * muestran exactamente lo mismo. Sin rig devuelve el mismo fotograma (ningún coste ni cambio de identidad).
 */
export function posedFrame(doc: RigDoc, frameIndex: number, override?: PoseOverride): Frame {
  const frame = doc.frames[frameIndex]!;
  const rigs = doc.rigs;
  if (!rigs || rigs.length === 0 || !rigs.some((s) => s.bindings.length > 0)) return frame;

  const poses = new Map<string, ResolvedPose>();
  let sig = "";
  for (const sk of rigs) {
    if (sk.bindings.length === 0) continue;
    const pose = override && override.skeletonId === sk.id ? resolveBones(sk, override.bones) : resolvePose(doc.frames, sk, frameIndex);
    poses.set(sk.id, pose);
    sig += `${sk.id}|${poseSig(pose)}#`;
  }
  const hit = memo.get(frame);
  if (hit && hit.rigs === rigs && hit.sig === sig) return hit.out;

  let cells: Record<string, readonly Stroke[]> | null = null;
  let cost = 0;
  for (const sk of rigs) {
    const pose = poses.get(sk.id);
    if (!pose) continue;
    const mats = skinMatrices(sk, poseStates(sk, pose));
    for (const b of sk.bindings) {
      const src = frame.cells[b.layerId];
      if (!src || src.length === 0) continue;
      const out = deformStrokes(src, b, sk, mats);
      if (out === src) continue;
      cells ??= { ...frame.cells };
      cells[b.layerId] = out;
      for (const s of out) cost += s.points.length;
    }
  }
  const result = cells ? ({ ...frame, cells: cells as Frame["cells"] } as Frame) : frame;
  remember(frame, { rigs, sig, out: result, cost });
  return result;
}

/** Para pruebas y diagnóstico. */
export const _rigMemoStats = () => ({ entries: memo.size, cost: memoCost });
export const _clearRigMemo = () => {
  memo.clear();
  memoCost = 0;
};

/* ───────────────────────── Selección por puntero (hit-test) ───────────────────────── */

export type BoneHit = { boneId: string; part: "head" | "tail" | "body" };

/** Hueso (y parte) más cercano a un punto, dentro de `tol` px. Las articulaciones tienen prioridad sobre el cuerpo. */
export function hitBone(sk: Pick<Skeleton, "bones">, states: SkeletonState, x: number, y: number, tol: number): BoneHit | null {
  let best: { hit: BoneHit; d: number } | null = null;
  for (const b of sk.bones) {
    const s = states.get(b.id)!;
    const cand: Array<[BoneHit["part"], number]> = [
      ["tail", Math.hypot(x - s.tail[0], y - s.tail[1])],
      ["head", Math.hypot(x - s.head[0], y - s.head[1])],
      ["body", distToSegment(x, y, s.head, s.tail) * 1.0 + tol * 0.35],
    ];
    for (const [part, d] of cand) {
      if (d <= tol && (!best || d < best.d)) best = { hit: { boneId: b.id, part }, d };
    }
  }
  return best?.hit ?? null;
}
