import type { Layer, Stroke } from "@gas/core";
import type { BoneState, SkeletonState } from "../rig";
import type { Bone } from "@gas/core";
import { BONE, type Plan } from "./plan";
import type { P } from "./vec";

/** Una capa que un generador quiere crear: dibujo + a qué hueso(s) se vincula. Se crea con `assemble`. */
export interface LayerSpec {
  /** Clave estable (para volver a generar y reemplazar el contenido). */
  key: string;
  name: string;
  part: string;
  strokes: Stroke[];
  bind: { mode: "rigid" | "skin"; bone: string; influences?: string[]; softness?: number; sharpness?: number } | null;
  fx?: Pick<Layer, "opacity" | "blend" | "clip" | "blur">;
}

/** Huesos por NOMBRE (los del humanoide) → geometría de reposo. */
export interface Rest {
  plan: Plan;
  st: Record<string, BoneState>;
  /** Punto en el hueso: t = 0 cabeza … 1 cola, y desplazamiento perpendicular. */
  at(bone: string, t: number, off?: number): P;
  /** Dirección y normal (a la izquierda de la pantalla cuando el hueso apunta hacia abajo). */
  dir(bone: string): P;
  nrm(bone: string): P;
}

export function makeRest(plan: Plan, bones: readonly Bone[], states: SkeletonState): Rest {
  const st: Record<string, BoneState> = {};
  for (const b of bones) st[b.name] = states.get(b.id)!;
  const dir = (n: string): P => [Math.cos(st[n]!.angle), Math.sin(st[n]!.angle)];
  const nrm = (n: string): P => { const d = dir(n); return [-d[1], d[0]]; };
  return {
    plan,
    st,
    dir,
    nrm,
    at(n, t, off = 0) {
      const s = st[n]!;
      const d = dir(n);
      const nn = nrm(n);
      return [s.head[0] + d[0] * s.length * t + nn[0] * off, s.head[1] + d[1] * s.length * t + nn[1] * off];
    },
  };
}

export const ALL_BONES: string[] = Object.values(BONE);
