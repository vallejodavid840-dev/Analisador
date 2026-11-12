import { longId, type Bone, type Proportions } from "@gas/core";

/** Píxeles de lienzo por cm de altura ficticia (el lienzo de personaje mide 1000×1300). */
export const PX_PER_CM = 6;
export const CHAR_W = 1000;
export const CHAR_H = 1300;

export const BONE = {
  hip: "Cadera",
  torso: "Torso",
  neck: "Cuello",
  head: "Cabeza",
  upperL: "Brazo superior izq.",
  foreL: "Brazo inferior izq.",
  handL: "Mano izq.",
  upperR: "Brazo superior der.",
  foreR: "Brazo inferior der.",
  handR: "Mano der.",
  thighL: "Pierna superior izq.",
  shinL: "Pierna inferior izq.",
  footL: "Pie izq.",
  thighR: "Pierna superior der.",
  shinR: "Pierna inferior der.",
  footR: "Pie der.",
} as const;

/**
 * Medidas del cuerpo a partir de las proporciones (todo en px del lienzo). Es PURA: la misma entrada da el mismo plan.
 * «izq.» es la izquierda del PERSONAJE visto de frente (queda a la derecha de la pantalla).
 */
export interface Plan {
  cx: number;
  groundY: number;
  H: number;
  head: number;
  headW: number;
  neck: number;
  pelvis: number;
  torso: number;
  thigh: number;
  shin: number;
  foot: number;
  upper: number;
  fore: number;
  hand: number;
  shoulderHalf: number;
  waistHalf: number;
  hipHalf: number;
  thighW: number;
  shinW: number;
  upperW: number;
  foreW: number;
  handW: number;
  footLen: number;
  /** Grosor típico de cada hueso (px), para reescalar el dibujo al cambiar la complexión. */
  widthOf: Record<string, number>;
  /** Y de la articulación de la cadera. */
  hipY: number;
}

export function planBody(p: Proportions, cx = CHAR_W / 2, groundY = CHAR_H - 70): Plan {
  const H = p.heightCm * PX_PER_CM;
  const head = H / p.heads;
  const neck = head * 0.3 * (1 - 0.3 * Math.max(0, p.posture));
  const pelvis = 0.06 * H;
  const foot = 0.045 * H;
  const V = H - foot - pelvis - neck - head;
  const wt = 0.36 * p.torso;
  const wl = 0.64 * p.legs;
  const torso = (V * wt) / (wt + wl);
  const legs = V - torso;
  const thigh = legs * 0.505;
  const shin = legs * 0.495;
  const b = p.build;
  const sh = p.shoulders;
  const shoulderHalf = head * (0.8 + 0.38 * b) * sh;
  const plan: Plan = {
    cx,
    groundY,
    H,
    head,
    headW: head * 0.76,
    neck,
    pelvis,
    torso,
    thigh,
    shin,
    foot,
    upper: 0.165 * H * p.arms,
    fore: 0.145 * H * p.arms,
    hand: 0.085 * H * p.hands,
    shoulderHalf,
    waistHalf: head * (0.5 + 0.28 * b),
    hipHalf: head * (0.58 + 0.26 * b),
    thighW: head * (0.42 + 0.2 * b),
    shinW: head * (0.27 + 0.12 * b),
    upperW: head * (0.27 + 0.14 * b),
    foreW: head * (0.22 + 0.1 * b),
    handW: head * 0.17 * Math.sqrt(p.hands),
    footLen: head * 0.95 * p.feet,
    widthOf: {},
    hipY: groundY - foot - thigh - shin,
  };
  plan.widthOf = {
    [BONE.hip]: plan.hipHalf * 2,
    [BONE.torso]: (plan.waistHalf + plan.shoulderHalf),
    [BONE.neck]: head * 0.3,
    [BONE.head]: head * 0.76,
    [BONE.upperL]: plan.upperW,
    [BONE.upperR]: plan.upperW,
    [BONE.foreL]: plan.foreW,
    [BONE.foreR]: plan.foreW,
    [BONE.handL]: plan.handW * 2,
    [BONE.handR]: plan.handW * 2,
    [BONE.thighL]: plan.thighW,
    [BONE.thighR]: plan.thighW,
    [BONE.shinL]: plan.shinW,
    [BONE.shinR]: plan.shinW,
    [BONE.footL]: plan.footLen * 0.5,
    [BONE.footR]: plan.footLen * 0.5,
  };
  return plan;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** El esqueleto humanoide de este plan (mismos nombres que la plantilla de la Fase 3, para compatibilidad). */
export function planBones(pl: Plan, p: Proportions): Bone[] {
  const bones: Bone[] = [];
  const add = (name: string, parent: string | null, b: Partial<Bone> & { length: number }): string => {
    const id = longId();
    bones.push({ id, name, parent, x: 0, y: 0, ax: 1, ay: 0, angle: 0, min: -180, max: 180, ...b, length: r3(b.length) });
    return id;
  };
  const lean = p.posture * 4;
  const cadera = add(BONE.hip, null, { x: pl.cx, y: pl.hipY, angle: -90, length: pl.pelvis, min: -60, max: 60 });
  const torso = add(BONE.torso, cadera, { angle: lean, length: pl.torso, min: -45, max: 45 });
  const cuello = add(BONE.neck, torso, { angle: -lean * 0.5, length: pl.neck, min: -40, max: 40 });
  add(BONE.head, cuello, { angle: 0, length: pl.head, min: -60, max: 60 });
  const drop = Math.max(0, p.posture) * pl.head * 0.12; // hombros caídos al encorvarse
  for (const side of ["izq.", "der."] as const) {
    const s = side === "izq." ? 1 : -1;
    const sh = add(`Brazo superior ${side}`, torso, { ax: 0.95 - drop / pl.torso, ay: s * pl.shoulderHalf, angle: 180 - s * 7, length: pl.upper });
    const el = add(`Brazo inferior ${side}`, sh, { length: pl.fore, min: s > 0 ? -10 : -150, max: s > 0 ? 150 : 10 });
    add(`Mano ${side}`, el, { length: pl.hand, min: -70, max: 70 });
    const th = add(`Pierna superior ${side}`, cadera, { ax: 0, ay: s * pl.hipHalf * 0.5, angle: 180 - s * 2, length: pl.thigh, min: -100, max: 100 });
    const kn = add(`Pierna inferior ${side}`, th, { length: pl.shin, min: s > 0 ? -150 : -10, max: s > 0 ? 10 : 150 });
    add(`Pie ${side}`, kn, { length: pl.foot, min: -45, max: 45 });
  }
  return bones;
}
