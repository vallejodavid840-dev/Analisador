import type { Stroke } from "@gas/core";
import { headFrame, type HeadFrame } from "./face";
import { BONE } from "./plan";
import type { LayerSpec, Rest } from "./spec";
import { fill, line, mix, outlineOf, rng, shade, spline, tint, type P } from "./vec";

export const HAIR_STYLES = ["corto-desordenado", "puntiagudo", "largo", "undercut", "flequillo-largo"] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

export interface HairParams {
  color: string;
  style: HairStyle;
  /** 0–1: cuánto crece el pelo (largo de flequillo y laterales). */
  length: number;
  /** 0–1: cuánto se riza/ desordena (variación de mechones). */
  messy: number;
  seed: number;
  /** −1 raya a la izquierda del personaje, +1 a la derecha. */
  part: number;
}
export const DEFAULT_HAIR: HairParams = { color: "#2b2430", style: "corto-desordenado", length: 0.5, messy: 0.55, seed: 7, part: 0.3 };

interface Bundle { vol: number; bangs: number; bangLen: number; spread: number; spikes: number; spikeLen: number; side: number; back: number; sweep: number; sharp: number; cover: number }
const BUNDLE: Record<HairStyle, Bundle> = {
  "corto-desordenado": { vol: 0.045, bangs: 8, bangLen: 0.16, spread: 1.0, spikes: 5, spikeLen: 0.1, side: 0.1, back: 0, sweep: 0, sharp: 0.7, cover: 0 },
  puntiagudo: { vol: 0.05, bangs: 6, bangLen: 0.19, spread: 1.35, spikes: 9, spikeLen: 0.23, side: 0.13, back: 0, sweep: 0, sharp: 1, cover: 0 },
  largo: { vol: 0.05, bangs: 8, bangLen: 0.2, spread: 0.9, spikes: 0, spikeLen: 0, side: 0.55, back: 1, sweep: 0, sharp: 0.5, cover: 0 },
  undercut: { vol: 0.035, bangs: 3, bangLen: 0.11, spread: 0.6, spikes: 5, spikeLen: 0.17, side: 0.0, back: 0, sweep: -1, sharp: 0.8, cover: 0 },
  "flequillo-largo": { vol: 0.045, bangs: 10, bangLen: 0.32, spread: 0.7, spikes: 2, spikeLen: 0.07, side: 0.22, back: 0.2, sweep: 0, sharp: 0.55, cover: 1 },
};

interface Frame2 { f: HeadFrame; down: P; side: P }

function frame2(r: Rest): Frame2 {
  const d = r.dir(BONE.head);
  return { f: headFrame(r), down: [-d[0], -d[1]], side: r.nrm(BONE.head) };
}

/** Mechón: polígono afilado desde la raíz en la dirección `v`, con curvatura `bend` (en múltiplos de su largo). */
function lock(root: P, v: P, L: number, wRoot: number, bend: number, sharp: number): { poly: P[]; centre: P[] } {
  const n = 7;
  const nrm: P = [-v[1], v[0]];
  const centre: P[] = [];
  const left: P[] = [];
  const right: P[] = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const c: P = [root[0] + v[0] * L * s + nrm[0] * bend * L * s * s, root[1] + v[1] * L * s + nrm[1] * bend * L * s * s];
    centre.push(c);
    const w = (wRoot / 2) * Math.pow(1 - s, 0.55 + sharp * 0.5) + (i === n ? 0 : 0.4);
    const a = centre[Math.max(0, i - 1)]!, b = i === n ? c : [root[0] + v[0] * L * Math.min(1, s + 0.05) + nrm[0] * bend * L * Math.min(1, s + 0.05) ** 2, root[1] + v[1] * L * Math.min(1, s + 0.05) + nrm[1] * bend * L * Math.min(1, s + 0.05) ** 2] as P;
    const tx = b[0] - a[0], ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty) || 1;
    const px = -ty / tl, py = tx / tl;
    left.push([c[0] + px * w, c[1] + py * w]);
    right.push([c[0] - px * w, c[1] - py * w]);
  }
  return { poly: [...left, ...right.reverse()], centre };
}

export function hairLayers(r: Rest, p: HairParams): LayerSpec[] {
  const B = { ...BUNDLE[p.style] };
  B.vol *= 2.7;
  B.spikeLen *= 1.7;
  B.bangLen *= (0.55 + p.length * 0.9) * 1.45;
  B.side *= 0.5 + p.length;
  const { f, down, side } = frame2(r);
  const rand = rng(p.seed * 9973 + 17);
  const jit = (k: number) => (rand() - 0.5) * 2 * k * (0.4 + p.messy);
  const base = p.color, dark = shade(p.color, 0.3), light = tint(mix(p.color, "#8aa0d0", 0.18), 0.38), edge = outlineOf(p.color);
  const front: Stroke[] = [];
  const hi: Stroke[] = [];
  const backS: Stroke[] = [];
  const hsha: Stroke[] = [];
  const h = f.h;
  const toWorld = (down2: P, side2: P, a: number): P => [down2[0] * Math.cos(a) + side2[0] * Math.sin(a), down2[1] * Math.cos(a) + side2[1] * Math.sin(a)];

  // ── pelo de atrás (detrás de la cabeza y el cuello)
  if (B.back > 0 || B.side > 0.3) {
    const len = Math.max(B.back, B.side > 0.3 ? 0.55 : 0) * (0.5 + p.length);
    const pts: P[] = [f.at(0.85, -0.37 - B.vol), f.at(0.6, -0.4 - B.vol), f.at(0.4 - len * 0.5, -0.43 - B.vol - len * 0.06), f.at(0.2 - len * 0.9, -0.4 - len * 0.1), f.at(0.12 - len * 1.0, -0.2), f.at(0.1 - len * 1.0, 0.0), f.at(0.12 - len * 1.0, 0.2), f.at(0.2 - len * 0.9, 0.4 + len * 0.1), f.at(0.4 - len * 0.5, 0.43 + B.vol + len * 0.06), f.at(0.6, 0.4 + B.vol), f.at(0.85, 0.37 + B.vol), f.at(1.0 + B.vol, 0)];
    backS.push(fill(dark, spline(pts, true, 5)));
    for (let i = 0; i < 9; i++) { const o = -0.35 + i * 0.0875; backS.push(line(mix(dark, "#000000", 0.25), 2.2, spline([f.at(0.5, o * 0.9), f.at(0.3 - len * 0.4, o * 1.05), f.at(0.15 - len * 0.95, o * 0.95)], false, 4), { taper: "both" })); }
  }

  // ── casquete: cubre el cráneo hasta la línea del pelo
  const part = p.part * 0.08;
  const hairline: P[] = [f.at(0.62, -0.352), f.at(0.74, -0.28), f.at(0.8, -0.15), f.at(0.815 + (part > 0 ? 0.01 : 0), part), f.at(0.8, 0.15), f.at(0.74, 0.28), f.at(0.62, 0.352)];
  const outer: P[] = [f.at(0.62, 0.372 + B.vol), f.at(0.78, 0.37 + B.vol), f.at(0.93, 0.28 + B.vol), f.at(1.0 + B.vol, 0.1), f.at(1.0 + B.vol * 1.2, -0.1), f.at(0.93, -0.28 - B.vol), f.at(0.78, -0.37 - B.vol), f.at(0.62, -0.372 - B.vol)];
  front.push(fill(base, spline([...outer, ...hairline], true, 4)));
  // «anillo de luz»: banda de brillo curva sobre la coronilla (marca del acabado de anime)
  hi.push(fill(light, spline([f.at(0.9, -0.3), f.at(0.96, -0.12), f.at(0.965, 0.1), f.at(0.9, 0.28), f.at(0.9, 0.24), f.at(0.935, 0.08), f.at(0.935, -0.1), f.at(0.885, -0.25)], true, 4), 0.85));
  // sombra del lado derecho
  hsha.push(fill(dark, spline([f.at(0.93, 0.28 + B.vol), f.at(0.78, 0.37 + B.vol), f.at(0.62, 0.372 + B.vol), f.at(0.64, 0.33), f.at(0.78, 0.3), f.at(0.9, 0.2)], true, 4), 0.9));

  // ── puntas superiores (peinado alzado)
  for (let i = 0; i < B.spikes; i++) {
    const k = B.spikes === 1 ? 0 : (i / (B.spikes - 1)) * 2 - 1; // −1..1 a lo ancho de la coronilla
    const root = f.at(0.93 + 0.01 * Math.cos(k * 1.4), k * 0.27);
    const up: P = [-down[0], -down[1]];
    const ang = k * 0.9 + (B.sweep < 0 ? 0.0 : 0) + jit(0.25);
    const v = toWorld(up, side, ang);
    const L = h * (B.spikeLen * (0.7 + rand() * 0.6));
    const lk = lock(root, v, L, h * 0.17, (B.sweep < 0 ? -0.5 : 0.25 * k) + jit(0.2), B.sharp);
    front.push(fill(base, lk.poly));
    front.push(line(edge, 1.8, lk.poly.slice(0, 8), { taper: "end" }));
    hi.push(line(light, h * 0.014, lk.centre.slice(0, 5), { taper: "both" }));
  }

  // ── flequillo: mechones desde la línea del pelo hacia la cara
  const nb = B.bangs;
  for (let i = 0; i < nb; i++) {
    const k = nb === 1 ? 0 : (i / (nb - 1)) * 2 - 1;
    const rootT = 0.82 - 0.03 * k * k;
    const root = f.at(rootT, k * 0.3 + part * 0.5);
    const ang = k * 0.55 * B.spread + jit(0.22) + (B.sweep < 0 ? -0.25 : 0) + (p.style === "flequillo-largo" ? 0.35 : 0);
    const v = toWorld(down, side, -ang * 0.0 + ang);
    const L0 = h * B.bangLen * (0.75 + 0.5 * rand()) * (1 - 0.35 * Math.abs(k) * (p.style === "flequillo-largo" ? 0 : 1));
    const lk = lock(root, v, L0, h * (0.09 + 0.05 * rand()), (k > 0 ? 0.28 : -0.28) * B.spread + jit(0.25), B.sharp);
    front.push(fill(base, lk.poly));
    hsha.push(fill(dark, lk.poly.map(([x, y]) => [x + side[0] * h * 0.01, y + 5] as P), 0.55));
    front.push(line(edge, 1.7, lk.poly.slice(Math.floor(lk.poly.length / 2)), { taper: "start" }));
    if (i % 2 === 0) hi.push(line(light, h * 0.012, lk.centre.slice(0, 4), { taper: "both" }));
  }
  // cubierta de un ojo (flequillo largo): mechón extra tapando parte del ojo del lado de la raya
  if (B.cover) {
    const root = f.at(0.86, 0.06 + part * 0.5);
    const lk = lock(root, toWorld(down, side, 0.42), h * 0.48, h * 0.17, 0.2, 0.5);
    front.push(fill(base, lk.poly));
    front.push(line(edge, 1.8, lk.poly.slice(Math.floor(lk.poly.length / 2)), { taper: "start" }));
    hi.push(line(light, h * 0.014, lk.centre.slice(0, 5), { taper: "both" }));
  }

  // ── patillas / laterales
  if (B.side > 0.05) {
    for (const s of [1, -1]) {
      const rootP = f.at(0.66, s * 0.352);
      const lk = lock(rootP, toWorld(down, side, s * 0.05), h * (B.side * (p.style === "largo" ? 1.2 : 1)), h * 0.12, s * 0.1 + jit(0.1), B.sharp * 0.6);
      front.push(fill(base, lk.poly));
      front.push(line(edge, 1.7, lk.poly.slice(Math.floor(lk.poly.length / 2)), { taper: "start" }));
    }
  } else if (p.style === "undercut") {
    // laterales rapados: sombra suave y trama fina en las sienes
    for (const s of [1, -1]) for (let i = 0; i < 7; i++) hi.push(line(mix(base, "#000000", 0.1), 1.2, [f.at(0.7 - i * 0.015, s * (0.33 + i * 0.004)), f.at(0.64 - i * 0.015, s * (0.345 + i * 0.004))], { taper: "both", opacity: 0.8 }));
  }
  // contorno del casquete (tinta) arriba
  front.push(line(edge, 2.2, spline(outer.slice(1, 8), false, 5), { taper: "both" }));

  return [
    ...(backS.length ? [{ key: "pelo-atras", name: "Pelo (atrás)", part: "hair-back", strokes: backS, bind: { mode: "rigid" as const, bone: BONE.head } }] : []),
    { key: "pelo", name: "Pelo", part: "hair-front", strokes: [...front, ...hi], bind: { mode: "rigid", bone: BONE.head } },
    { key: "pelo-sombra", name: "Sombra del pelo", part: "hair-shade", strokes: [...hsha], bind: { mode: "rigid", bone: BONE.head }, fx: { blend: "multiply", clip: true, opacity: 0.45 } },
  ];
}
