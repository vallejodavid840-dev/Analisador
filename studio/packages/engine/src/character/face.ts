import type { Stroke } from "@gas/core";
import { BONE } from "./plan";
import type { LayerSpec, Rest } from "./spec";
import { add, ellipse, fill, line, lerp, mirror, mix, norm, outlineOf, shade, spline, tint, type P } from "./vec";

/* ───────────────────────── Parámetros ───────────────────────── */

export const EYE_STYLES = ["afilado", "normal", "caido", "intenso", "entrecerrado"] as const;
export const BROW_STYLES = ["recta", "arqueada", "gruesa", "fina", "cortada"] as const;
export const NOSE_STYLES = ["minima", "recta", "marcada"] as const;
export const JAW_STYLES = ["afilada", "cuadrada", "marcada", "suave"] as const;
export type EyeStyle = (typeof EYE_STYLES)[number];
export type BrowStyle = (typeof BROW_STYLES)[number];
export type NoseStyle = (typeof NOSE_STYLES)[number];
export type JawStyle = (typeof JAW_STYLES)[number];

export interface FaceParams {
  skin: string;
  eyeStyle: EyeStyle;
  iris: string;
  eyeSize: number;
  browStyle: BrowStyle;
  browColor: string;
  noseStyle: NoseStyle;
  jaw: JawStyle;
  ears: number;
  lineColor: string;
}
export const DEFAULT_FACE: FaceParams = { skin: "#f1c9a8", eyeStyle: "normal", iris: "#3f6fae", eyeSize: 1, browStyle: "recta", browColor: "#2c2118", noseStyle: "recta", jaw: "afilada", ears: 1, lineColor: "#2a1c20" };

export interface MouthExpr { open: number; curve: number; smirk: number; width: number; teeth: boolean }
export interface ExprParams {
  eyeOpen: number;
  eyeTilt: number;
  browRaise: number;
  browTilt: number;
  /** Hacia dónde mira: x,y entre −1 y 1. */
  gaze: [number, number];
  pupil: number;
  mouth: MouthExpr;
  /** Efectos opcionales: sudor, vena de enfado, rubor, lágrima. */
  fx: string[];
}

export const EXPRESSIONS: Record<string, { name: string; p: ExprParams }> = {
  neutral: { name: "Neutral", p: { eyeOpen: 1, eyeTilt: 0, browRaise: 0, browTilt: 0, gaze: [0, 0], pupil: 1, mouth: { open: 0, curve: 0, smirk: 0, width: 1, teeth: false }, fx: [] } },
  serio: { name: "Serio", p: { eyeOpen: 0.85, eyeTilt: 2, browRaise: -0.2, browTilt: 4, gaze: [0, 0], pupil: 0.95, mouth: { open: 0, curve: -0.1, smirk: 0, width: 0.9, teeth: false }, fx: [] } },
  enojado: { name: "Enojado", p: { eyeOpen: 0.78, eyeTilt: 7, browRaise: -0.45, browTilt: 18, gaze: [0, 0.1], pupil: 0.8, mouth: { open: 0.35, curve: -0.55, smirk: 0, width: 1.05, teeth: true }, fx: ["vena"] } },
  sonrisaLeve: { name: "Sonrisa leve", p: { eyeOpen: 0.9, eyeTilt: -2, browRaise: 0.1, browTilt: -3, gaze: [0, 0], pupil: 1, mouth: { open: 0, curve: 0.5, smirk: 0, width: 1, teeth: false }, fx: [] } },
  sonrisaArrogante: { name: "Sonrisa arrogante", p: { eyeOpen: 0.7, eyeTilt: 4, browRaise: 0.15, browTilt: 8, gaze: [0.15, 0.05], pupil: 0.9, mouth: { open: 0, curve: 0.45, smirk: 1, width: 1.05, teeth: false }, fx: [] } },
  tristeza: { name: "Tristeza", p: { eyeOpen: 0.75, eyeTilt: -7, browRaise: 0.15, browTilt: -14, gaze: [0, 0.35], pupil: 1.1, mouth: { open: 0, curve: -0.6, smirk: 0, width: 0.8, teeth: false }, fx: ["lagrima"] } },
  sorpresa: { name: "Sorpresa", p: { eyeOpen: 1.35, eyeTilt: 0, browRaise: 0.9, browTilt: -2, gaze: [0, 0], pupil: 0.55, mouth: { open: 0.75, curve: 0, smirk: 0, width: 0.6, teeth: false }, fx: ["sudor"] } },
  desafiante: { name: "Mirada desafiante", p: { eyeOpen: 0.72, eyeTilt: 6, browRaise: -0.3, browTilt: 10, gaze: [0, 0.2], pupil: 0.7, mouth: { open: 0, curve: 0.15, smirk: 0.6, width: 0.95, teeth: false }, fx: [] } },
  dolor: { name: "Dolor", p: { eyeOpen: 0.35, eyeTilt: -9, browRaise: 0.25, browTilt: -16, gaze: [0, 0], pupil: 1, mouth: { open: 0.5, curve: -0.7, smirk: 0, width: 0.9, teeth: true }, fx: ["sudor"] } },
};

/* ───────────────────────── Geometría de la cabeza ───────────────────────── */

export interface HeadFrame {
  h: number;
  /** Punto de la cara: t = 0 barbilla… 1 coronilla; o = desplazamiento lateral en unidades de h (+ = derecha de la pantalla). */
  at(t: number, o: number): P;
  angle: number;
}

export function headFrame(r: Rest): HeadFrame {
  const h = r.plan.head;
  const s = r.st[BONE.head]!;
  const d = r.dir(BONE.head);
  const n = r.nrm(BONE.head);
  return { h, angle: s.angle, at: (t, o) => [s.head[0] + d[0] * h * t + n[0] * h * o, s.head[1] + d[1] * h * t + n[1] * h * o] };
}

const JAW_D: Record<JawStyle, number> = { afilada: -0.03, cuadrada: 0.04, marcada: 0.055, suave: 0.0 };
const CHIN_W: Record<JawStyle, number> = { afilada: 0.055, cuadrada: 0.125, marcada: 0.11, suave: 0.085 };

/** Contorno de la cabeza (cráneo + mandíbula), como lista de (t, o) para el lado derecho de la pantalla. */
function skullProfile(jaw: JawStyle): Array<[number, number]> {
  const d = JAW_D[jaw];
  const cw = CHIN_W[jaw];
  return [[0.02, cw], [0.05, cw + 0.035 + d * 0.5], [0.1, 0.16 + d], [0.17, 0.235 + d * 0.9], [0.27, 0.305 + d * 0.4], [0.38, 0.338], [0.52, 0.355], [0.68, 0.36], [0.84, 0.335], [0.95, 0.24]];
}

export function skullPolygon(f: HeadFrame, jaw: JawStyle): P[] {
  const prof = skullProfile(jaw);
  const right = prof.map(([t, o]) => f.at(t, o));
  const left = [...prof].reverse().map(([t, o]) => f.at(t, -o));
  return spline([...right, f.at(1.0, 0.0), ...left, f.at(0.0, 0)], true, 5);
}

/* ───────────────────────── Cabeza (cráneo, orejas, sombras) ───────────────────────── */

export function headLayers(r: Rest, p: FaceParams): LayerSpec[] {
  const f = headFrame(r);
  const skin = p.skin;
  const sh = shade(skin);
  const hl = tint(skin, 0.35);
  const out = outlineOf(skin);
  const base: Stroke[] = [];
  const sha: Stroke[] = [];
  // orejas (detrás del cráneo)
  for (const s of [1, -1]) {
    const e = p.ears;
    const ear = spline([f.at(0.58, s * 0.36), f.at(0.6, s * (0.36 + 0.07 * e)), f.at(0.5, s * (0.36 + 0.095 * e)), f.at(0.4, s * (0.36 + 0.07 * e)), f.at(0.38, s * 0.36)], true, 5);
    base.push(fill(skin, ear));
    base.push(line(sh, 2.2, [f.at(0.54, s * (0.375 + 0.05 * e)), f.at(0.5, s * (0.375 + 0.065 * e)), f.at(0.44, s * (0.37 + 0.04 * e))], { taper: "both" }));
  }
  const skull = skullPolygon(f, p.jaw);
  base.push(fill(skin, skull));
  // luz en la frente/pómulo izquierdo (la luz viene de arriba-izquierda de la pantalla)
  base.push(fill(hl, spline([f.at(0.7, -0.2), f.at(0.66, -0.07), f.at(0.62, 0.0), f.at(0.64, -0.2)], true, 4), 0.55));
  // contorno de la cara: línea fina oscura de la mandíbula, afinada en los extremos
  const prof = skullProfile(p.jaw);
  const jawR = spline(prof.slice(0, 6).map(([t, o]) => f.at(t, o)), false, 5);
  const jawL = spline(prof.slice(0, 6).map(([t, o]) => f.at(t, -o)), false, 5);
  base.push(line(out, 2.6, jawR, { taper: "both" }));
  base.push(line(out, 2.6, jawL, { taper: "both" }));
  // sombra: lado derecho de la cara y bajo la barbilla/orejas
  const rightEdge = prof.slice(0, 9).map(([t, o]) => f.at(t, o));
  const inner = [...prof.slice(0, 9)].reverse().map(([t, o]) => f.at(t, o - 0.06 - (t > 0.4 ? 0.012 : 0)));
  sha.push(fill(sh, spline([...rightEdge, ...inner], true, 4)));
  return [
    { key: "cabeza", name: "Cabeza", part: "head", strokes: base, bind: { mode: "rigid", bone: BONE.head } },
    { key: "cabeza-sombra", name: "Sombra cabeza", part: "head-shade", strokes: sha, bind: { mode: "rigid", bone: BONE.head }, fx: { blend: "multiply", clip: true, opacity: 0.5 } },
  ];
}

/* ───────────────────────── Ojos ───────────────────────── */

interface EyeShape { h0: number; tilt: number; irisK: number; lash: number; white: number }
const EYE: Record<EyeStyle, EyeShape> = {
  afilado: { h0: 0.34, tilt: 9, irisK: 0.9, lash: 1.25, white: 0.12 },
  normal: { h0: 0.46, tilt: 2, irisK: 1.0, lash: 1.0, white: 0.0 },
  caido: { h0: 0.44, tilt: -7, irisK: 1.0, lash: 0.9, white: 0.0 },
  intenso: { h0: 0.4, tilt: 5, irisK: 0.72, lash: 1.4, white: 0.32 },
  entrecerrado: { h0: 0.27, tilt: 2, irisK: 1.0, lash: 1.2, white: 0.0 },
};

function drawEye(f: HeadFrame, side: 1 | -1, p: FaceParams, e: ExprParams, out: Stroke[]): void {
  const sh = EYE[p.eyeStyle];
  const w = f.h * 0.275 * p.eyeSize; // anchura del ojo: contenida, sin ojos desmesurados
  const open = Math.max(0.05, e.eyeOpen) * sh.h0;
  const tilt = ((sh.tilt + e.eyeTilt) * Math.PI) / 180;
  const centre = f.at(0.475, side * 0.2);
  // coordenadas locales del ojo (x hacia fuera de la cara, y hacia abajo); se rotan con la cabeza
  const cosH = Math.cos(f.angle + Math.PI / 2), sinH = Math.sin(f.angle + Math.PI / 2);
  const L = (x: number, y: number): P => {
    // aplicar espejo según el lado y la inclinación del ojo
    const xr = x * Math.cos(tilt) - y * Math.sin(tilt) * 1; // girar tilt (esquina exterior sube con tilt > 0)
    const yr = -x * Math.sin(tilt) * 1 + y * Math.cos(tilt);
    const X = xr * side, Y = yr;
    return [centre[0] + X * cosH - Y * sinH, centre[1] + X * sinH + Y * cosH];
  };
  const hw = w / 2;
  const up = (x: number) => -open * w * (1 - Math.pow(x / hw, 2)) * 1.15 + (x < 0 ? 0 : 0) - (x > hw * 0.3 ? 0 : 0);
  const lo = (x: number) => open * w * 0.28 * (1 - Math.pow(x / hw, 2));
  const xs = [-1, -0.8, -0.5, -0.2, 0.1, 0.4, 0.7, 0.9, 1].map((k) => k * hw);
  // párpado superior curvado hacia la esquina interior (forma almendrada)
  const upperPts = xs.map((x) => L(x, up(x) * (x < 0 ? 0.85 : 1)));
  const lowerPts = [...xs].reverse().map((x) => L(x, lo(x)));
  const white = spline([...upperPts, ...lowerPts], true, 4);
  out.push(fill(mix("#f6f1ee", p.skin, 0.1), white));
  // iris (recortado analíticamente por los párpados)
  const irisR = hw * 0.7 * sh.irisK * (0.8 + 0.2 * e.pupil);
  const gx = e.gaze[0] * hw * 0.3 * side, gy = e.gaze[1] * open * w * 0.4;
  const ix = gx - 0, iy = gy + (sh.white > 0 ? -open * w * 0.05 : 0) - sh.white * 0 ;
  const upAt = (x: number) => up(x) * (x < 0 ? 0.85 : 1);
  const clampY = (x: number, y: number) => Math.min(lo(Math.max(-hw, Math.min(hw, x))), Math.max(upAt(Math.max(-hw, Math.min(hw, x))) + 0.6, y));
  const ryI = Math.min(irisR * 1.1, open * w * 0.66);
  const irisPts: P[] = ellipse(ix, iy, irisR, ryI, 26).map(([x, y]) => [x, clampY(x, y)] as P).map(([x, y]) => L(x, y));
  out.push(fill(mix(p.iris, "#07080d", 0.35), irisPts));
  // mitad inferior más clara (degradado de dos tonos)
  const lowPts: P[] = ellipse(ix, iy + ryI * 0.35, irisR * 0.86, ryI * 0.55, 20).map(([x, y]) => [x, clampY(x, y)] as P).map(([x, y]) => L(x, y));
  out.push(fill(tint(p.iris, 0.12), lowPts));
  const pr = irisR * 0.42 * e.pupil;
  out.push(fill("#0a0a10", ellipse(ix, iy, pr, Math.min(pr * 1.25, ryI * 0.7), 16).map(([x, y]) => L(x, clampY(x, y)))));
  // brillos
  out.push(fill("#ffffff", ellipse(ix - irisR * 0.32, iy - ryI * 0.3, irisR * 0.2, ryI * 0.2, 12).map(([x, y]) => L(x, y))));
  out.push(fill("#ffffff", ellipse(ix + irisR * 0.35, iy + ryI * 0.38, irisR * 0.09, ryI * 0.09, 10).map(([x, y]) => L(x, y)), 0.85));
  // párpado superior: línea gruesa y afinada, con «pestaña» en la esquina exterior
  const lash = sh.lash;
  const lid = xs.map((x) => L(x, upAt(x) - 0.4));
  out.push(line(p.lineColor, w * 0.12 * lash, lid, { taper: "both" }));
  out.push(line(p.lineColor, w * 0.07 * lash, [L(hw * 0.78, upAt(hw * 0.78)), L(hw * 1.18, upAt(hw) - w * 0.1 * lash), L(hw * 1.38, upAt(hw) - w * 0.2 * lash)], { taper: "end" }));
  // pliegue del párpado (línea doble) y línea inferior suave
  out.push(line(mix(p.lineColor, p.skin, 0.4), w * 0.035, xs.slice(1, 8).map((x) => L(x, upAt(x) - open * w * 0.28 - w * 0.03)), { taper: "both" }));
  out.push(line(mix(p.lineColor, p.skin, 0.55), w * 0.03, xs.slice(1, 8).map((x) => L(x, lo(x) + w * 0.02)), { taper: "both" }));
  if (sh.white > 0.2) out.push(line(mix(p.lineColor, p.skin, 0.5), w * 0.03, [L(-hw * 0.4, lo(0) + w * 0.12), L(0, lo(0) + w * 0.14), L(hw * 0.4, lo(0) + w * 0.12)], { taper: "both" })); // ojeras ligeras (mirada intensa)
}

export function eyesStrokes(r: Rest, p: FaceParams, e: ExprParams): Stroke[] {
  const f = headFrame(r);
  const out: Stroke[] = [];
  drawEye(f, 1, p, e, out);
  drawEye(f, -1, p, e, out);
  return out;
}

/* ───────────────────────── Cejas ───────────────────────── */

function ribbon(center: P[], widths: number[], color: string): Stroke {
  const up: P[] = [], dn: P[] = [];
  center.forEach((c, i) => {
    const a = center[Math.max(0, i - 1)]!, b = center[Math.min(center.length - 1, i + 1)]!;
    const d = norm([b[0] - a[0], b[1] - a[1]]);
    const n: P = [-d[1], d[0]];
    up.push([c[0] + n[0] * widths[i]! / 2, c[1] + n[1] * widths[i]! / 2]);
    dn.push([c[0] - n[0] * widths[i]! / 2, c[1] - n[1] * widths[i]! / 2]);
  });
  return fill(color, spline([...up, ...dn.reverse()], true, 3));
}

export function browsStrokes(r: Rest, p: FaceParams, e: ExprParams): Stroke[] {
  const f = headFrame(r);
  const out: Stroke[] = [];
  const thick = { recta: 0.045, arqueada: 0.04, gruesa: 0.07, fina: 0.025, cortada: 0.05 }[p.browStyle];
  for (const side of [1, -1] as const) {
    const t0 = 0.62 + e.browRaise * 0.035;
    const lenB = 0.27;
    const tilt = (e.browTilt * Math.PI) / 180; // + = extremo interior más bajo (enfado)
    const arch = { recta: 0.0, arqueada: 0.03, gruesa: 0.012, fina: 0.02, cortada: 0.008 }[p.browStyle];
    const pts: P[] = [];
    const wd: number[] = [];
    const N = 7;
    for (let i = 0; i < N; i++) {
      const k = i / (N - 1); // 0 interior → 1 exterior
      const o = 0.085 + k * lenB;
      const t = t0 - (k - 0.5) * Math.sin(tilt) * lenB * 1.0 + arch * Math.sin(Math.PI * k) - (p.browStyle === "recta" ? 0 : 0) + (k > 0.8 ? -0.012 * (k - 0.8) * 5 : 0);
      pts.push(f.at(t, side * o));
      wd.push(f.h * thick * (0.55 + 0.7 * Math.sin(Math.PI * Math.min(1, 0.25 + k * 0.85))) * (k > 0.8 ? 1 - (k - 0.8) * 2.5 : 1));
    }
    out.push(ribbon(pts, wd.map((w) => Math.max(1.2, w)), p.browColor));
    if (p.browStyle === "cortada" && side === 1) {
      // corte (tajo) en la ceja izquierda del personaje: detalle de pandillero
      const a = f.at(t0 + 0.035, side * 0.2), b = f.at(t0 - 0.03, side * 0.17);
      out.push(line(p.skin, f.h * 0.012, [a, b], { taper: "both" }));
    }
  }
  return out;
}

/* ───────────────────────── Nariz y boca ───────────────────────── */

export function noseStrokes(r: Rest, p: FaceParams): Stroke[] {
  const f = headFrame(r);
  const c = mix(p.lineColor, p.skin, 0.35);
  const s = shade(p.skin, 0.3);
  const out: Stroke[] = [];
  if (p.noseStyle === "minima") {
    out.push(line(c, f.h * 0.016, [f.at(0.35, 0.012), f.at(0.325, 0.026), f.at(0.322, 0.0)], { taper: "both" }));
  } else if (p.noseStyle === "recta") {
    out.push(line(c, f.h * 0.017, [f.at(0.43, 0.035), f.at(0.355, 0.04), f.at(0.325, 0.02)], { taper: "both" }));
    out.push(line(c, f.h * 0.015, [f.at(0.322, -0.03), f.at(0.318, 0.0), f.at(0.325, 0.03)], { taper: "both" }));
  } else {
    out.push(fill(s, spline([f.at(0.46, 0.015), f.at(0.4, 0.05), f.at(0.325, 0.065), f.at(0.31, 0.03), f.at(0.36, 0.03), f.at(0.43, 0.01)], true, 4), 0.85));
    out.push(line(c, f.h * 0.02, [f.at(0.325, -0.045), f.at(0.31, -0.01), f.at(0.31, 0.02), f.at(0.325, 0.06)], { taper: "both" }));
  }
  return out;
}

export function mouthStrokes(r: Rest, p: FaceParams, e: ExprParams): Stroke[] {
  const f = headFrame(r);
  const m = e.mouth;
  const t0 = 0.22;
  const hw = 0.085 * m.width;
  const c = "#3a1d26";
  const out: Stroke[] = [];
  const corner = (s: number): P => f.at(t0 + m.curve * 0.03 * 1 + (m.smirk > 0 ? (s > 0 ? 0.03 : -0.012) * m.smirk : 0), s * hw + (m.smirk > 0 && s > 0 ? 0.02 * m.smirk : 0));
  const L = corner(-1), R = corner(1);
  const mid = f.at(t0 - m.curve * 0.02, 0);
  if (m.open < 0.08) {
    out.push(line(c, f.h * 0.021, spline([L, f.at(t0 - 0.006 - m.curve * 0.012, -hw * 0.5), mid, f.at(t0 - 0.006 - m.curve * 0.012, hw * 0.5), R], false, 5), { taper: "both" }));
    if (m.curve > 0.2) {
      out.push(line(c, f.h * 0.012, [add(R, [0, -f.h * 0.012]), add(R, [f.h * 0.012, -f.h * 0.03])], { taper: "both" }));
      if (m.smirk > 0.5) out.push(line(mix(c, p.skin, 0.4), f.h * 0.012, [f.at(t0 + 0.04, 0.12), f.at(t0 + 0.07, 0.115), f.at(t0 + 0.09, 0.09)], { taper: "both" }));
    }
    out.push(line(mix(c, p.skin, 0.65), f.h * 0.014, [f.at(t0 - 0.045, -0.03), f.at(t0 - 0.05, 0.0), f.at(t0 - 0.045, 0.03)], { taper: "both" })); // sombra del labio
  } else {
    const o = m.open * 0.075;
    const top = [L, f.at(t0 + 0.012 + m.curve * 0.01, -hw * 0.5), f.at(t0 + 0.016, 0), f.at(t0 + 0.012 + m.curve * 0.01, hw * 0.5), R];
    const bot = [R, f.at(t0 - o * 0.9, hw * 0.55), f.at(t0 - o * 1.1, 0), f.at(t0 - o * 0.9, -hw * 0.55), L];
    const shape = spline([...top, ...bot.slice(1, -1)], true, 4);
    out.push(fill("#2a0f18", shape));
    if (m.teeth) out.push(fill("#f4efec", spline([f.at(t0 + 0.012, -hw * 0.75), f.at(t0 + 0.017, 0), f.at(t0 + 0.012, hw * 0.75), f.at(t0 - o * 0.28, hw * 0.65), f.at(t0 - o * 0.32, 0), f.at(t0 - o * 0.28, -hw * 0.65)], true, 4)));
    out.push(fill("#c4586b", spline([f.at(t0 - o * 0.62, -hw * 0.45), f.at(t0 - o * 0.5, 0), f.at(t0 - o * 0.62, hw * 0.45), f.at(t0 - o * 1.02, 0)], true, 4), 0.95));
    out.push(line(c, f.h * 0.019, spline([...top], false, 5), { taper: "both" }));
    out.push(line(mix(c, p.skin, 0.2), f.h * 0.014, spline([...bot], false, 5), { taper: "both" }));
  }
  return out;
}

/** Efectos de expresión: sudor, vena de enfado, lágrima, rubor. */
export function fxStrokes(r: Rest, p: FaceParams, e: ExprParams): Stroke[] {
  const f = headFrame(r);
  const out: Stroke[] = [];
  if (e.fx.includes("vena")) {
    const c = f.at(0.83, 0.3);
    const u = f.h * 0.04;
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) out.push(line("#c4232d", f.h * 0.012, [add(c, [dx * u * 0.2, dy * u * 0.2]), add(c, [dx * u, dy * u * 0.45])], { taper: "end" }));
    out.push(line("#c4232d", f.h * 0.012, [add(c, [-u * 1.0, u * 0.5]), add(c, [-u * 0.2, u * 0.1])], { taper: "start" }));
  }
  if (e.fx.includes("sudor")) out.push(fill("#9fd8f0", spline([f.at(0.8, -0.38), f.at(0.76, -0.4), f.at(0.72, -0.385), f.at(0.755, -0.37)], true, 4), 0.9), line("#2f7fa6", 1.5, [f.at(0.8, -0.38), f.at(0.755, -0.4)], { taper: "both" }));
  if (e.fx.includes("lagrima")) out.push(fill("#b8e6f7", spline([f.at(0.44, -0.2), f.at(0.4, -0.215), f.at(0.36, -0.205), f.at(0.4, -0.185)], true, 4), 0.9));
  if (e.fx.includes("rubor")) {
    for (const s of [1, -1]) for (let i = 0; i < 3; i++) out.push(line("#e0667a", f.h * 0.008, [f.at(0.33 + i * 0.012, s * (0.26 + i * 0.03)), f.at(0.31 + i * 0.012, s * (0.22 + i * 0.03))], { taper: "both", opacity: 0.8 }));
  }
  return out;
}

/** Capas de rostro. El dibujo de ojos, cejas y boca es lo que cambia con cada expresión. */
export function faceLayers(r: Rest, p: FaceParams, e: ExprParams): LayerSpec[] {
  const bind = { mode: "rigid" as const, bone: BONE.head };
  return [
    { key: "ojos", name: "Ojos", part: "eyes", strokes: eyesStrokes(r, p, e), bind },
    { key: "nariz", name: "Nariz", part: "nose", strokes: noseStrokes(r, p), bind },
    { key: "boca", name: "Boca", part: "mouth", strokes: [...mouthStrokes(r, p, e), ...fxStrokes(r, p, e)], bind },
    { key: "cejas", name: "Cejas", part: "brows", strokes: browsStrokes(r, p, e), bind },
  ];
}

/** Marcas faciales (cicatrices, tiritas, moratones…). Se añaden a la capa «Marcas». */
export const MARKS = ["cicatriz-ceja", "cicatriz-mejilla", "tirita", "moreton", "arañazo", "ojeras"] as const;
export type MarkKind = (typeof MARKS)[number];
export function markStrokes(r: Rest, p: FaceParams, kind: MarkKind, side: 1 | -1 = 1): Stroke[] {
  const f = headFrame(r);
  const out: Stroke[] = [];
  const sc = mix("#8a3a46", p.skin, 0.25);
  switch (kind) {
    case "cicatriz-ceja": {
      const a = f.at(0.7, side * 0.2), b = f.at(0.54, side * 0.17);
      out.push(line(sc, f.h * 0.016, [a, lerp(a, b, 0.5), b], { taper: "both" }));
      for (let i = 1; i < 5; i++) { const c = lerp(a, b, i / 5); out.push(line(sc, f.h * 0.008, [add(c, [-f.h * 0.018, 0]), add(c, [f.h * 0.018, 0])], { taper: "both" })); }
      break;
    }
    case "cicatriz-mejilla": {
      const a = f.at(0.38, side * 0.27), b = f.at(0.22, side * 0.17);
      out.push(line(sc, f.h * 0.017, [a, lerp(a, b, 0.5), b], { taper: "both" }));
      for (let i = 1; i < 5; i++) { const c = lerp(a, b, i / 5); out.push(line(sc, f.h * 0.008, [add(c, [-f.h * 0.016, -f.h * 0.012]), add(c, [f.h * 0.016, f.h * 0.012])], { taper: "both" })); }
      break;
    }
    case "tirita": {
      const c = f.at(0.38, 0), w = f.h * 0.15, hh = f.h * 0.045;
      const strip = (ang: number) => {
        const cs = Math.cos(ang), sn = Math.sin(ang);
        const pt = (x: number, y: number): P => [c[0] + x * cs - y * sn, c[1] + x * sn + y * cs];
        out.push(fill("#e9d3b8", [pt(-w / 2, -hh / 2), pt(w / 2, -hh / 2), pt(w / 2, hh / 2), pt(-w / 2, hh / 2)]));
        out.push(line("#b79a78", 1.4, [pt(-w / 2, -hh / 2), pt(w / 2, -hh / 2), pt(w / 2, hh / 2), pt(-w / 2, hh / 2)], { closed: true }));
        for (const dx of [-0.1, 0.0, 0.1]) out.push(fill("#c9ae8a", ellipse(...pt(w * dx, 0), 1.4, 1.4, 6)));
      };
      strip(-0.3);
      break;
    }
    case "moreton":
      out.push(fill("#6b3f8a", spline([f.at(0.44, side * 0.25), f.at(0.46, side * 0.3), f.at(0.4, side * 0.33), f.at(0.36, side * 0.28)], true, 4), 0.45), fill("#3c6e78", spline([f.at(0.43, side * 0.27), f.at(0.44, side * 0.3), f.at(0.4, side * 0.31)], true, 4), 0.25));
      break;
    case "arañazo":
      for (let i = 0; i < 3; i++) out.push(line("#a84856", f.h * 0.008, [f.at(0.34 + i * 0.015, side * (0.26 - i * 0.012)), f.at(0.24 + i * 0.015, side * (0.19 - i * 0.012))], { taper: "both", opacity: 0.85 }));
      break;
    case "ojeras":
      for (const s of [1, -1]) out.push(line(mix("#5a3a5e", p.skin, 0.55), f.h * 0.02, [f.at(0.44, s * 0.15), f.at(0.43, s * 0.205), f.at(0.45, s * 0.26)], { taper: "both", opacity: 0.75 }));
      break;
  }
  return out;
}

void mirror;
