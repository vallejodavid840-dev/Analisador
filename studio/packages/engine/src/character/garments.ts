import type { Stroke } from "@gas/core";
import { handShapes } from "./body";
import { headFrame } from "./face";
import { BONE } from "./plan";
import type { LayerSpec, Rest } from "./spec";
import { ALL_BONES } from "./spec";
import { add, ellipse, fill, lerp, line, mix, outlineOf, rng, shade, spline, tubePoly, type P } from "./vec";

export const GARMENT_TYPES = ["pantalon", "camiseta", "chaqueta", "sudadera", "bomber", "uniforme", "camisa", "chaleco", "abrigo", "zapatillas", "botas"] as const;
export type GarmentType = (typeof GARMENT_TYPES)[number];
export const TEXTURES = ["liso", "denim", "tela", "cuadros", "rayas", "puntos"] as const;
export const COLLARS = ["ninguno", "alto", "solapa", "capucha", "redondo", "camisa"] as const;
export const PRINTS = ["ninguno", "franjas", "emblema", "rombos"] as const;

export interface GarmentParams {
  type: GarmentType;
  color: string;
  /** Color secundario: ribetes, suela, botones… */
  color2: string;
  /** 0,6 ceñido … 1 normal … 3,4 extremadamente ancho. */
  width: number;
  /** Largo. Para pantalones: 1 = hasta el tobillo, >1 se arruga sobre el calzado. Para tops: 1 = cadera, 2 = rodillas. */
  length: number;
  /** Largo de manga: 0 sin mangas … 0,45 corta … 1 completa … 1,25 cubre las manos. */
  sleeve: number;
  /** Anchura de manga (1 = ajustada al brazo). */
  sleeveWidth: number;
  collar: (typeof COLLARS)[number];
  /** Camisa/chaqueta abierta, 0–1. */
  open: number;
  /** Pantalón caído (cintura baja), 0–1. */
  sag: number;
  /** Pliegues, 0–1. */
  folds: number;
  pockets: number;
  buttons: number;
  zipper: boolean;
  seams: boolean;
  belt: boolean;
  texture: (typeof TEXTURES)[number];
  print: (typeof PRINTS)[number];
  seed: number;
}

export const DEFAULT_GARMENT: Record<GarmentType, GarmentParams> = {
  pantalon: { type: "pantalon", color: "#2f3f63", color2: "#e8e4dc", width: 1.8, length: 1.08, sleeve: 0, sleeveWidth: 1, collar: "ninguno", open: 0, sag: 0.4, folds: 0.6, pockets: 1, buttons: 0, zipper: false, seams: true, belt: true, texture: "denim", print: "ninguno", seed: 3 },
  camiseta: { type: "camiseta", color: "#ece8e1", color2: "#2a2a33", width: 1.35, length: 1.15, sleeve: 0.42, sleeveWidth: 1.5, collar: "redondo", open: 0, sag: 0, folds: 0.5, pockets: 0, buttons: 0, zipper: false, seams: true, belt: false, texture: "liso", print: "ninguno", seed: 5 },
  chaqueta: { type: "chaqueta", color: "#8a1f2c", color2: "#e8e4dc", width: 1.5, length: 1.65, sleeve: 1.1, sleeveWidth: 1.55, collar: "solapa", open: 0.45, sag: 0, folds: 0.7, pockets: 2, buttons: 0, zipper: false, seams: true, belt: false, texture: "tela", print: "franjas", seed: 11 },
  sudadera: { type: "sudadera", color: "#3a3d46", color2: "#d9d5cc", width: 1.5, length: 1.2, sleeve: 1.05, sleeveWidth: 1.45, collar: "capucha", open: 0, sag: 0, folds: 0.6, pockets: 1, buttons: 0, zipper: false, seams: true, belt: false, texture: "liso", print: "ninguno", seed: 9 },
  bomber: { type: "bomber", color: "#2c4a3e", color2: "#d9843b", width: 1.45, length: 0.95, sleeve: 1.05, sleeveWidth: 1.4, collar: "redondo", open: 0.15, sag: 0, folds: 0.5, pockets: 2, buttons: 0, zipper: true, seams: true, belt: false, texture: "liso", print: "ninguno", seed: 13 },
  uniforme: { type: "uniforme", color: "#17171f", color2: "#d9b04c", width: 1.25, length: 1.45, sleeve: 1.08, sleeveWidth: 1.3, collar: "alto", open: 0.3, sag: 0, folds: 0.35, pockets: 2, buttons: 5, zipper: false, seams: true, belt: false, texture: "liso", print: "ninguno", seed: 17 },
  camisa: { type: "camisa", color: "#d9d2c3", color2: "#6b6358", width: 1.3, length: 1.25, sleeve: 1.05, sleeveWidth: 1.35, collar: "camisa", open: 0.55, sag: 0, folds: 0.6, pockets: 1, buttons: 6, zipper: false, seams: true, belt: false, texture: "tela", print: "ninguno", seed: 19 },
  chaleco: { type: "chaleco", color: "#3b3030", color2: "#b9a27a", width: 1.2, length: 1.1, sleeve: 0, sleeveWidth: 1, collar: "solapa", open: 0.5, sag: 0, folds: 0.3, pockets: 2, buttons: 4, zipper: false, seams: true, belt: false, texture: "tela", print: "ninguno", seed: 23 },
  abrigo: { type: "abrigo", color: "#3d3a3f", color2: "#a89c8a", width: 1.45, length: 1.95, sleeve: 1.12, sleeveWidth: 1.5, collar: "solapa", open: 0.35, sag: 0, folds: 0.8, pockets: 2, buttons: 4, zipper: false, seams: true, belt: true, texture: "tela", print: "ninguno", seed: 29 },
  zapatillas: { type: "zapatillas", color: "#e9e6e0", color2: "#c93a3a", width: 1.1, length: 1, sleeve: 0, sleeveWidth: 1, collar: "ninguno", open: 0, sag: 0, folds: 0, pockets: 0, buttons: 0, zipper: false, seams: true, belt: false, texture: "liso", print: "ninguno", seed: 31 },
  botas: { type: "botas", color: "#34261d", color2: "#9c7b52", width: 1.15, length: 1.4, sleeve: 0, sleeveWidth: 1, collar: "ninguno", open: 0, sag: 0, folds: 0.3, pockets: 0, buttons: 0, zipper: false, seams: true, belt: false, texture: "liso", print: "ninguno", seed: 37 },
};

/* ───────────────────────── Utilidades ───────────────────────── */

function dashed(color: string, size: number, pts: P[], dash = 7, gap = 5): Stroke[] {
  const out: Stroke[] = [];
  let carry = 0;
  let on = true;
  let cur: P[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let d = 0;
    while (d < L) {
      const need = (on ? dash : gap) - carry;
      const step = Math.min(need, L - d);
      const p0 = lerp(a, b, d / L), p1 = lerp(a, b, (d + step) / L);
      if (on) { if (cur.length === 0) cur.push(p0); cur.push(p1); }
      d += step;
      carry += step;
      if (carry >= (on ? dash : gap) - 1e-6) {
        if (on && cur.length) { out.push(line(color, size, cur)); cur = []; }
        on = !on;
        carry = 0;
      }
    }
  }
  if (cur.length) out.push(line(color, size, cur));
  return out;
}

function bounds(polys: readonly P[][]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
}

/** Textura / estampado de tela: líneas que se recortan a la prenda (capa de detalle con recorte). */
export function textureStrokes(g: GarmentParams, b: { x0: number; y0: number; x1: number; y1: number }): Stroke[] {
  const out: Stroke[] = [];
  const rand = rng(g.seed * 131 + 7);
  const c = g.color;
  const dark = mix(c, "#000000", 0.3);
  const light = mix(c, "#ffffff", 0.3);
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  if (g.texture === "denim") {
    for (let i = 0; i < Math.min(900, (w * h) / 260); i++) { const x = b.x0 + rand() * w, y = b.y0 + rand() * h; out.push(line(rand() > 0.5 ? dark : light, 1.2, [[x, y], [x + 4, y + 7]], { opacity: 0.35 })); }
  } else if (g.texture === "tela") {
    for (let y = b.y0; y < b.y1; y += 9) out.push(line(dark, 1, [[b.x0, y], [b.x1, y]], { opacity: 0.14 }));
    for (let x = b.x0; x < b.x1; x += 9) out.push(line(light, 1, [[x, b.y0], [x, b.y1]], { opacity: 0.12 }));
  } else if (g.texture === "cuadros") {
    const s = 34;
    for (let y = b.y0 - (b.y0 % s); y < b.y1; y += s) out.push(line(g.color2, 6, [[b.x0, y], [b.x1, y]], { opacity: 0.55 }), line(dark, 1.5, [[b.x0, y + 11], [b.x1, y + 11]], { opacity: 0.5 }));
    for (let x = b.x0 - (b.x0 % s); x < b.x1; x += s) out.push(line(g.color2, 6, [[x, b.y0], [x, b.y1]], { opacity: 0.55 }), line(dark, 1.5, [[x + 11, b.y0], [x + 11, b.y1]], { opacity: 0.5 }));
  } else if (g.texture === "rayas") {
    for (let x = b.x0 - (b.x0 % 22); x < b.x1; x += 22) out.push(line(g.color2, 5, [[x, b.y0], [x, b.y1]], { opacity: 0.7 }));
  } else if (g.texture === "puntos") {
    for (let y = b.y0; y < b.y1; y += 20) for (let x = b.x0 + ((Math.round(y / 20) % 2) * 10); x < b.x1; x += 20) out.push(fill(g.color2, ellipse(x, y, 3.2, 3.2, 8), 0.75));
  }
  return out;
}

const fold = (c: string, a: P, b: P, bend: number, size = 2.2): Stroke => {
  const m = lerp(a, b, 0.5);
  const nx = -(b[1] - a[1]), ny = b[0] - a[0];
  const l = Math.hypot(nx, ny) || 1;
  return line(c, size, spline([a, [m[0] + (nx / l) * bend, m[1] + (ny / l) * bend], b], false, 5), { taper: "both" });
};

/* ───────────────────────── Pantalones ───────────────────────── */

export function pantsLayers(r: Rest, g: GarmentParams): LayerSpec[] {
  const pl = r.plan;
  const rand = rng(g.seed);
  const base = g.color, line_ = outlineOf(base), dk = shade(base, 0.3);
  const fills: Stroke[] = [], lines: Stroke[] = [], sha: Stroke[] = [], extra: Stroke[] = [];
  const wk = g.width;
  const hipJ = r.at(BONE.hip, 0);
  const wy = hipJ[1] - pl.pelvis * 0.55 + g.sag * pl.pelvis * 1.5;
  const waistHalf = pl.hipHalf * (1.02 + 0.12 * (wk - 1));
  const polys: P[][] = [];
  const crotchY = hipJ[1] + pl.thighW * 0.25 + g.sag * pl.thighW * 0.8;
  const sides = ["izq.", "der."] as const;
  const hemY = Math.min(pl.groundY - 4, r.at(`Pierna inferior izq.`, 1)[1] + pl.foot * (0.5 + Math.max(0, g.length - 1) * 2.4));
  // bloque de la cadera
  const pelvis = spline([[hipJ[0] - waistHalf, wy], [hipJ[0], wy - 3], [hipJ[0] + waistHalf, wy], [hipJ[0] + waistHalf * 1.05, wy + pl.pelvis * 1.1], [hipJ[0] + waistHalf * 0.8, crotchY + pl.thighW * 0.35], [hipJ[0], crotchY + pl.thighW * 0.55], [hipJ[0] - waistHalf * 0.8, crotchY + pl.thighW * 0.35], [hipJ[0] - waistHalf * 1.05, wy + pl.pelvis * 1.1]], true, 4);
  fills.push(fill(base, pelvis));
  polys.push(pelvis);
  for (const side of sides) {
    const s = side === "izq." ? 1 : -1;
    const th = `Pierna superior ${side}`, sn = `Pierna inferior ${side}`;
    const a = r.at(th, 0), k = r.at(th, 1), an = r.at(sn, 1);
    const ctr: P[] = [[a[0] + s * 4, wy + 4], r.at(th, 0.3), k, r.at(sn, 0.45), an, [an[0], hemY]];
    const hw = (v: number) => v / 2;
    const flare = (x: number) => 1 + (wk - 1) * x;
    const halfs = [hw(pl.thighW * 1.35) * flare(0.55), hw(pl.thighW * 1.3) * flare(0.65), hw(pl.thighW * 1.1) * flare(0.85), hw(pl.shinW * 1.05) * flare(1.0), hw(pl.shinW * 0.95) * flare(1.12), hw(pl.shinW * 0.95) * flare(1.18)];
    const tb = tubePoly(ctr, halfs);
    const poly = spline(tb.poly, true, 3);
    fills.push(fill(base, poly));
    polys.push(poly);
    // contorno exterior e interior (sin la parte superior, que se funde con la cadera)
    const outer = s > 0 ? tb.right : tb.left, inner = s > 0 ? tb.left : tb.right;
    lines.push(line(line_, 2.6, spline(outer.slice(1), false, 5), { taper: "start" }));
    lines.push(line(line_, 2.6, spline(inner.slice(2), false, 5), { taper: "start" }));
    lines.push(line(line_, 2.6, [outer[5]!, inner[5]!], { taper: "both" }));
    // sombra: banda del lado derecho de la pantalla + zona de entrepierna
    const shR = s > 0 ? tb.right : tb.right; // lado derecho de la pantalla = «left» o «right» según el sentido
    const edge = ctr[0]![0] < ctr[5]![0] + 1e9 ? (tb.left[0]![0] > tb.right[0]![0] ? tb.left : tb.right) : tb.right; // el de mayor x
    const inset = edge.map((p, i) => [p[0] - (edge === tb.left ? 1 : 1) * (halfs[i]! * 0.55), p[1]] as P);
    sha.push(fill(dk, spline([...edge.slice(1), ...[...inset.slice(1)].reverse()], true, 3)));
    void shR;
    // pliegues: del muslo al dobladillo, más pliegues cuanto más ancho y largo
    const nF = Math.round(2 + g.folds * 5);
    for (let i = 0; i < nF; i++) {
      const t0 = 0.12 + rand() * 0.5, o = (rand() - 0.5) * 1.5;
      const p0 = lerp(r.at(th, 0.2), k, t0), p1 = lerp(k, an, 0.3 + rand() * 0.6);
      extra.push(fold(shade(base, 0.25), add(p0, [o * halfs[1]! * 0.8, 0]), add(p1, [o * halfs[3]! * 0.7 + s * 6, 0]), (rand() - 0.5) * 18, 2.4));
    }
    // arrugas del dobladillo (se acumula la tela sobre el calzado)
    if (g.length > 1.0) for (let i = 0; i < 3 + Math.round(g.folds * 3); i++) {
      const y = hemY - 6 - i * 11 - rand() * 4;
      const half = halfs[5]! * (0.8 + rand() * 0.2);
      const cx = an[0] + (rand() - 0.5) * 6;
      extra.push(line(shade(base, 0.3), 2.6, spline([[cx - half, y + 3], [cx - half * 0.3, y - 2], [cx + half * 0.4, y + 3], [cx + half, y - 1]], false, 5), { taper: "both" }));
      sha.push(fill(dk, spline([[cx - half, y + 3], [cx, y - 1], [cx + half, y - 1], [cx + half, y + 7], [cx, y + 9], [cx - half, y + 8]], true, 3), 0.55));
    }
    // costuras laterales (punteadas) y bolsillo lateral
    if (g.seams) lines.push(...dashed(mix(base, "#ffffff", 0.35), 1.6, outer.slice(1).map((p) => [p[0] + (s > 0 ? -5 : 5), p[1]] as P), 6, 4));
    if (g.pockets > 0) {
      const w0: P = [a[0] + s * (waistHalf * 0.78), wy + 4], w1: P = [a[0] + s * (waistHalf * 0.96), wy + pl.pelvis * 1.4], w2: P = [a[0] + s * (waistHalf * 0.78), wy + pl.pelvis * 2.1];
      lines.push(line(shade(base, 0.45), 2.2, spline([w0, w1, w2], false, 5), { taper: "both" }));
    }
    if (g.pockets > 1) { // bolsillo cargo en el muslo
      const c0 = lerp(r.at(th, 0.28), k, 0.1), pw = halfs[1]! * 0.8, ph = pl.thigh * 0.28, cx = c0[0] + s * halfs[1]! * 0.05;
      const rect: P[] = [[cx - pw / 2, c0[1]], [cx + pw / 2, c0[1]], [cx + pw / 2, c0[1] + ph], [cx - pw / 2, c0[1] + ph]];
      lines.push(line(shade(base, 0.4), 2.2, rect, { closed: true }));
      lines.push(...dashed(mix(base, "#ffffff", 0.3), 1.4, [[cx - pw / 2 + 4, c0[1] + 6], [cx + pw / 2 - 4, c0[1] + 6]], 5, 3));
    }
  }
  // cinturilla, cinturón, hebilla y pasadores
  const waistBand = spline([[hipJ[0] - waistHalf, wy - 4], [hipJ[0], wy - 7], [hipJ[0] + waistHalf, wy - 4], [hipJ[0] + waistHalf, wy + pl.pelvis * 0.35], [hipJ[0], wy + pl.pelvis * 0.4], [hipJ[0] - waistHalf, wy + pl.pelvis * 0.35]], true, 4);
  fills.push(fill(g.belt ? mix(g.color2 === "#e8e4dc" ? "#2a2a2a" : g.color2, "#000000", 0.4) : shade(base, 0.15), waistBand));
  lines.push(line(line_, 2.2, [...waistBand.slice(0, 1), ...waistBand.slice(1)], { closed: true }));
  if (g.belt) {
    const bx = hipJ[0] + waistHalf * 0.1, by = wy - 2;
    fills.push(fill("#c9c3b4", [[bx - 12, by - 8], [bx + 12, by - 8], [bx + 12, by + 10], [bx - 12, by + 10]]));
    lines.push(line("#5a554a", 2, [[bx - 12, by - 8], [bx + 12, by - 8], [bx + 12, by + 10], [bx - 12, by + 10]], { closed: true }));
    lines.push(line("#5a554a", 2.4, [[bx - 4, by - 3], [bx + 6, by - 3], [bx + 6, by + 5], [bx - 4, by + 5]], { closed: true }));
    for (let i = -3; i <= 3; i++) if (i !== 0 && Math.abs(i) !== 1) lines.push(line(shade(base, 0.5), 3, [[hipJ[0] + i * waistHalf * 0.3, wy - 5], [hipJ[0] + i * waistHalf * 0.3, wy + pl.pelvis * 0.3]]));
  }
  // pliegues de la entrepierna
  for (let i = 0; i < 3; i++) extra.push(fold(shade(base, 0.25), [hipJ[0] + (i - 1) * 16, crotchY - 4], [hipJ[0] + (i - 1) * 40, crotchY + pl.thighW * 0.85], (i - 1) * 8, 2.4));
  sha.push(fill(dk, spline([[hipJ[0] - waistHalf, wy + pl.pelvis * 0.35], [hipJ[0], wy + pl.pelvis * 0.4], [hipJ[0] + waistHalf, wy + pl.pelvis * 0.35], [hipJ[0] + waistHalf, wy + pl.pelvis * 0.75], [hipJ[0], wy + pl.pelvis * 0.85], [hipJ[0] - waistHalf, wy + pl.pelvis * 0.75]], true, 4), 0.8));
  const bind = { mode: "skin" as const, bone: BONE.hip, influences: [BONE.hip, BONE.torso, "Pierna superior izq.", "Pierna inferior izq.", "Pie izq.", "Pierna superior der.", "Pierna inferior der.", "Pie der."], softness: 14, sharpness: 3.4 };
  const specs: LayerSpec[] = [
    { key: "pantalon", name: "Pantalón", part: "pants", strokes: [...fills, ...lines, ...extra], bind },
    { key: "pantalon-sombra", name: "Sombra pantalón", part: "pants-shade", strokes: sha, bind, fx: { blend: "multiply", clip: true, opacity: 0.5 } },
  ];
  const tex = g.texture !== "liso" ? textureStrokes(g, bounds(polys)) : [];
  if (tex.length) specs.push({ key: "pantalon-det", name: "Textura pantalón", part: "pants-detail", strokes: tex, bind, fx: { clip: true, opacity: 0.85 } });
  return specs;
}

/* ───────────────────────── Calzado ───────────────────────── */

export function shoesLayers(r: Rest, g: GarmentParams): LayerSpec[] {
  const pl = r.plan;
  const fills: Stroke[] = [], lines: Stroke[] = [], sha: Stroke[] = [];
  const boot = g.type === "botas";
  const base = g.color, sole = boot ? "#1d1714" : "#f4f1ea", acc = g.color2;
  for (const side of ["izq.", "der."] as const) {
    const s = side === "izq." ? 1 : -1;
    const sn = `Pierna inferior ${side}`;
    const an = r.at(sn, 1);
    const w = pl.footLen * 0.52 * g.width, top = an[1] - (boot ? pl.shin * 0.34 * (g.length - 0.6) : pl.foot * 0.2);
    const gy = pl.groundY;
    const cx = an[0] + s * pl.footLen * 0.1;
    const shaftTop = top, toeY = gy - 4;
    const body = spline([[cx - w * 0.42, shaftTop], [cx + w * 0.42, shaftTop], [cx + w * 0.5, an[1] + pl.foot * 0.2], [cx + w * 0.62 + s * 4, toeY - pl.foot * 0.8], [cx + w * 0.55 + s * 6, toeY], [cx - w * 0.55 + s * 6, toeY], [cx - w * 0.62 + s * 4, toeY - pl.foot * 0.8], [cx - w * 0.5, an[1] + pl.foot * 0.2]], true, 4);
    fills.push(fill(base, body));
    const soleP = spline([[cx - w * 0.66 + s * 6, toeY - pl.foot * 0.42], [cx + w * 0.66 + s * 6, toeY - pl.foot * 0.42], [cx + w * 0.7 + s * 6, toeY + 3], [cx + w * 0.52 + s * 6, toeY + 9], [cx - w * 0.52 + s * 6, toeY + 9], [cx - w * 0.7 + s * 6, toeY + 3]], true, 3);
    fills.push(fill(sole, soleP));
    lines.push(line(outlineOf(base), 2.6, spline(body.slice(0, Math.floor(body.length / 2)), false, 3), { taper: "both" }));
    lines.push(line("#8d8878", 2.2, [[cx - w * 0.66 + s * 6, toeY - pl.foot * 0.42], [cx + w * 0.66 + s * 6, toeY - pl.foot * 0.42]], { taper: "both" }));
    lines.push(line("#8d8878", 2.2, spline(soleP.slice(Math.floor(soleP.length * 0.5)), false, 3), { taper: "both" }));
    if (boot) {
      fills.push(fill(acc, spline([[cx - w * 0.5, shaftTop], [cx + w * 0.5, shaftTop], [cx + w * 0.5, shaftTop + 14], [cx - w * 0.5, shaftTop + 14]], true, 3)));
      for (let i = 0; i < 4; i++) lines.push(line(acc, 2, [[cx - w * 0.3, shaftTop + 30 + i * 18], [cx + w * 0.3, shaftTop + 36 + i * 18]], { taper: "both" }));
    } else {
      // cordones, lengüeta y franja lateral de la zapatilla
      for (let i = 0; i < 3; i++) lines.push(line(mix(base, "#000000", 0.45), 2.2, [[cx - w * 0.22, an[1] + pl.foot * (0.1 + i * 0.3)], [cx + w * 0.22, an[1] + pl.foot * (0.2 + i * 0.3)]], { taper: "both" }));
      lines.push(line(acc, w * 0.16, spline([[cx + s * w * 0.46, an[1] + pl.foot * 0.3], [cx + s * w * 0.55, toeY - pl.foot * 0.8]], false, 3), { taper: "both" }));
      fills.push(fill(mix(base, "#ffffff", 0.35), ellipse(cx, toeY - pl.foot * 0.5, w * 0.34, pl.foot * 0.3, 14)));
      lines.push(line(mix(base, "#000000", 0.35), 1.8, ellipse(cx, toeY - pl.foot * 0.5, w * 0.34, pl.foot * 0.3, 14), { closed: true }));
    }
    sha.push(fill(shade(base, 0.35), spline([[cx + w * 0.2, an[1] + pl.foot * 0.2], [cx + w * 0.5, an[1] + pl.foot * 0.2], [cx + w * 0.62 + s * 4, toeY - pl.foot * 0.8], [cx + w * 0.55 + s * 6, toeY], [cx + w * 0.2, toeY]], true, 3)));
  }
  const bind = { mode: "skin" as const, bone: "Pierna inferior izq.", influences: ["Pierna inferior izq.", "Pie izq.", "Pierna inferior der.", "Pie der."], softness: 10, sharpness: 4 };
  return [
    { key: "calzado", name: boot ? "Botas" : "Zapatillas", part: "shoes", strokes: [...fills, ...lines], bind },
    { key: "calzado-sombra", name: "Sombra calzado", part: "shoes-shade", strokes: sha, bind, fx: { blend: "multiply", clip: true, opacity: 0.45 } },
  ];
}

/* ───────────────────────── Prendas de torso (camiseta, chaqueta, sudadera…) ───────────────────────── */

export function topLayers(r: Rest, g: GarmentParams): LayerSpec[] {
  const pl = r.plan;
  const rand = rng(g.seed);
  const slot = g.type === "camiseta" || g.type === "camisa" ? "camiseta" : "chaqueta";
  const base = g.color, ink = outlineOf(base), dk = shade(base, 0.3);
  const fills: Stroke[] = [], lines: Stroke[] = [], sha: Stroke[] = [], det: Stroke[] = [], extra: Stroke[] = [];
  const wk = g.width;
  const nb = r.at(BONE.torso, 1);
  const shY = nb[1] + pl.head * 0.06;
  const cx = nb[0];
  const shHalf = pl.shoulderHalf * (1 + 0.1 * (wk - 1));
  const chest = shHalf * (0.88 + 0.26 * (wk - 1) * 0.9 + 0.06);
  const hemY = shY + (pl.torso + pl.pelvis * 0.4) * g.length * (g.type === "bomber" ? 0.98 : 1);
  const hemHalf = chest * (g.type === "bomber" ? 0.98 : 1 + 0.06 * (g.length - 1) + 0.06 * (wk - 1));
  const neckHalf = pl.head * 0.18;
  const hood = g.collar === "capucha";
  // panel del torso (dos mitades si va abierta)
  const gapTop = g.open * chest * 0.22, gapBot = g.open * chest * 0.62;
  const half = (s: 1 | -1): P[] => {
    const pts: P[] = [
      [cx + s * (gapTop + neckHalf * (g.collar === "alto" ? 0.9 : 1.05)), nb[1] + pl.head * 0.02],
      [cx + s * (neckHalf + (shHalf - neckHalf) * 0.5), shY - pl.head * 0.03],
      [cx + s * shHalf * 1.02, shY + pl.head * 0.1],
      [cx + s * chest * 1.0, shY + (hemY - shY) * 0.25],
      [cx + s * hemHalf, hemY - 4],
      [cx + s * (hemHalf * 0.5), hemY + (g.type === "uniforme" ? 0 : 7)],
      [cx + s * gapBot, hemY + 2],
      [cx + s * gapTop * 0.9, shY + (hemY - shY) * 0.5],
    ];
    return spline(pts, true, 4);
  };
  const L = half(-1), R = half(1);
  // camisa/camiseta cerradas: un solo panel
  const single = g.open < 0.05;
  if (single) {
    const whole = spline([
      [cx - neckHalf * 1.05, nb[1] + pl.head * 0.02], [cx - (neckHalf + (shHalf - neckHalf) * 0.5), shY - pl.head * 0.03], [cx - shHalf * 1.02, shY + pl.head * 0.1], [cx - chest, shY + (hemY - shY) * 0.25], [cx - hemHalf, hemY - 4], [cx, hemY + 8], [cx + hemHalf, hemY - 4], [cx + chest, shY + (hemY - shY) * 0.25], [cx + shHalf * 1.02, shY + pl.head * 0.1], [cx + (neckHalf + (shHalf - neckHalf) * 0.5), shY - pl.head * 0.03], [cx + neckHalf * 1.05, nb[1] + pl.head * 0.02],
    ], true, 4);
    fills.push(fill(base, whole));
    lines.push(line(ink, 2.8, spline(whole.slice(Math.floor(whole.length * 0.2), Math.floor(whole.length * 0.75)), false, 3), { taper: "both" }));
  } else {
    // interior (camiseta que se ve por la abertura): se dibuja aparte en la capa «camiseta»
    fills.push(fill(base, L), fill(base, R));
    lines.push(line(ink, 2.8, spline(L, true, 3).slice(0, Math.floor(L.length * 0.9)), { taper: "both" }), line(ink, 2.8, spline(R, true, 3).slice(0, Math.floor(R.length * 0.9)), { taper: "both" }));
  }
  const allPolys: P[][] = [L, R];
  if (single) allPolys.length = 0;
  // sombras: costado derecho, bajo la axila y bajo el cuello
  sha.push(fill(dk, spline([[cx + chest, shY + (hemY - shY) * 0.2], [cx + hemHalf + 2, hemY], [cx + hemHalf - chest * 0.3, hemY], [cx + chest * 0.7, shY + (hemY - shY) * 0.3]], true, 4)));
  sha.push(fill(dk, spline([[cx - neckHalf * 1.1, nb[1] + pl.head * 0.04], [cx + neckHalf * 1.1, nb[1] + pl.head * 0.04], [cx + neckHalf * 1.2, nb[1] + pl.head * 0.12], [cx, nb[1] + pl.head * 0.15], [cx - neckHalf * 1.2, nb[1] + pl.head * 0.12]], true, 4), 0.6));
  // pliegues grandes (tela suelta)
  const nF = Math.round(2 + g.folds * 6);
  for (let i = 0; i < nF; i++) {
    const side = rand() > 0.5 ? 1 : -1;
    const y0 = shY + (hemY - shY) * (0.3 + rand() * 0.4);
    const x0 = cx + side * chest * (0.3 + rand() * 0.55);
    extra.push(fold(dk, [x0, y0], [x0 + side * chest * (0.1 + rand() * 0.2), y0 + (hemY - y0) * (0.4 + rand() * 0.5)], (rand() - 0.5) * 22, 2.6));
  }
  // dobladillo (bomber: puño elástico)
  if (g.type === "bomber") {
    const band = spline([[cx - hemHalf, hemY - 26], [cx, hemY - 22], [cx + hemHalf, hemY - 26], [cx + hemHalf, hemY], [cx, hemY + 4], [cx - hemHalf, hemY]], true, 3);
    fills.push(fill(g.color2, band));
    for (let i = -10; i <= 10; i++) lines.push(line(shade(g.color2, 0.3), 1.4, [[cx + (i * hemHalf) / 10, hemY - 22], [cx + (i * hemHalf) / 10, hemY + 1]], { opacity: 0.7 }));
  }
  // cuello
  const chestY = shY + pl.head * 0.12;
  if (g.collar === "alto") {
    for (const s of [-1, 1]) fills.push(fill(base, spline([[cx + s * neckHalf * 0.2, nb[1] - pl.head * 0.05], [cx + s * neckHalf * 1.35, nb[1] - pl.head * 0.12], [cx + s * neckHalf * 1.5, nb[1] + pl.head * 0.12], [cx + s * neckHalf * 0.2, nb[1] + pl.head * 0.18]], true, 3)));
    for (const s of [-1, 1]) lines.push(line(ink, 2.4, [[cx + s * neckHalf * 1.35, nb[1] - pl.head * 0.12], [cx + s * neckHalf * 1.5, nb[1] + pl.head * 0.12]], { taper: "both" }));
    fills.push(fill(g.color2, ellipse(cx + neckHalf * 1.1, nb[1] + pl.head * 0.04, 4.5, 4.5, 10)), fill(g.color2, ellipse(cx - neckHalf * 1.1, nb[1] + pl.head * 0.04, 4.5, 4.5, 10)));
  } else if (g.collar === "solapa" || g.collar === "camisa") {
    const w = g.collar === "solapa" ? 1.0 : 0.75;
    for (const s of [-1, 1]) {
      const lap = spline([[cx + s * neckHalf * 0.9, nb[1] + pl.head * 0.0], [cx + s * (neckHalf + chest * 0.32 * w), nb[1] + pl.head * 0.1], [cx + s * (gapTop + chest * 0.44 * w), chestY + pl.head * 0.42], [cx + s * (gapTop + chest * 0.16), chestY + pl.head * (g.collar === "solapa" ? 0.85 : 0.6)], [cx + s * (gapTop + chest * 0.03), chestY + pl.head * 0.25]], true, 2);
      fills.push(fill(mix(base, "#ffffff", 0.08), lap));
      lines.push(line(ink, 2.4, spline(lap.slice(0, 7), false, 3), { taper: "both" }));
      sha.push(fill(dk, lap.map(([x, y]) => [x + s * 3, y + 6] as P), 0.5));
    }
  } else if (g.collar === "redondo") {
    lines.push(line(g.type === "bomber" ? g.color2 : shade(base, 0.35), 8, spline([[cx - neckHalf * 1.15, nb[1] + pl.head * 0.02], [cx, nb[1] + pl.head * 0.2], [cx + neckHalf * 1.15, nb[1] + pl.head * 0.02]], false, 6), { taper: "both" }));
  } else if (hood) {
    const hd = spline([[cx - shHalf * 0.95, shY + pl.head * 0.05], [cx - shHalf * 0.85, nb[1] - pl.head * 0.1], [cx - neckHalf * 1.8, nb[1] - pl.head * 0.34], [cx, nb[1] - pl.head * 0.42], [cx + neckHalf * 1.8, nb[1] - pl.head * 0.34], [cx + shHalf * 0.85, nb[1] - pl.head * 0.1], [cx + shHalf * 0.95, shY + pl.head * 0.05], [cx + neckHalf * 1.3, nb[1] + pl.head * 0.18], [cx, nb[1] + pl.head * 0.32], [cx - neckHalf * 1.3, nb[1] + pl.head * 0.18]], true, 4);
    extra.push(fill(shade(base, 0.15), hd));
    extra.push(line(ink, 2.6, spline(hd.slice(0, 14), false, 3), { taper: "both" }));
    extra.push(fill(shade(base, 0.5), spline([[cx - neckHalf * 1.2, nb[1] + pl.head * 0.0], [cx, nb[1] + pl.head * 0.28], [cx + neckHalf * 1.2, nb[1] + pl.head * 0.0], [cx, nb[1] - pl.head * 0.15]], true, 4), 0.8));
    for (const s of [-1, 1]) { // cordones
      const a: P = [cx + s * neckHalf * 0.9, nb[1] + pl.head * 0.28];
      lines.push(line(g.color2, 3, spline([a, [a[0] + s * 4, a[1] + pl.head * 0.5], [a[0] + s * 2, a[1] + pl.head * 0.95]], false, 5), { taper: "end" }));
      fills.push(fill(g.color2, ellipse(a[0] + s * 2, a[1] + pl.head * 0.97, 3, 5, 8)));
    }
  }
  // detalles: cremallera / botones / bolsillos / franjas / estampado
  const midY0 = nb[1] + pl.head * 0.18;
  if (g.zipper) {
    det.push(line("#b9bcc4", 3.2, [[cx + gapTop * 0.9, midY0], [cx + gapBot * 0.5, hemY - 4]]));
    for (let i = 0; i < 18; i++) { const t = i / 17, x = cx + (gapTop * 0.9 * (1 - t) + gapBot * 0.5 * t), y = midY0 + (hemY - 4 - midY0) * t; det.push(line("#5c5f66", 1.2, [[x - 3.4, y], [x + 3.4, y]])); }
    det.push(fill("#d0d3da", ellipse(cx + gapTop * 0.9, midY0 + 14, 4.5, 7, 10)));
  }
  for (let i = 0; i < g.buttons; i++) {
    const t = g.buttons === 1 ? 0.3 : 0.12 + (i / (g.buttons - 1)) * 0.78;
    const y = midY0 + pl.head * 0.3 + (hemY - midY0 - pl.head * 0.5) * t;
    const x = cx + (single ? 0 : gapTop * 0.9 * (1 - t) + gapBot * 0.25 * t);
    det.push(fill(g.color2, ellipse(x, y, 5.5, 5.5, 12)), line(shade(g.color2, 0.4), 1.4, ellipse(x, y, 5.5, 5.5, 12), { closed: true }), line(shade(g.color2, 0.4), 1.2, [[x - 2, y], [x + 2, y]]));
  }
  for (let i = 0; i < g.pockets; i++) {
    const s = i === 0 ? 1 : -1;
    const py = hemY - (hemY - shY) * 0.32, px = cx + s * (chest * 0.55);
    if (g.type === "sudadera") {
      const kang = spline([[cx - chest * 0.6, py - 14], [cx + chest * 0.6, py - 14], [cx + chest * 0.7, py + 36], [cx - chest * 0.7, py + 36]], true, 3);
      if (i === 0) { det.push(fill(shade(base, 0.12), kang), line(ink, 2.4, kang, { closed: true }), line(dk, 2, [[cx - chest * 0.6, py - 14], [cx - chest * 0.5, py + 34]], { taper: "both" }), line(dk, 2, [[cx + chest * 0.6, py - 14], [cx + chest * 0.5, py + 34]], { taper: "both" })); }
    } else {
      const flap: P[] = [[px - 24, py], [px + 24, py], [px + 24, py + 16], [px - 24, py + 16]];
      det.push(fill(shade(base, 0.08), flap), line(ink, 2.2, flap, { closed: true }));
      det.push(line(dk, 2.2, [[px - 26, py + 16], [px + 26, py + 16]], { taper: "both" }));
    }
  }
  if (g.seams) {
    det.push(...dashed(mix(base, "#ffffff", 0.35), 1.5, [[cx - shHalf, shY + 6], [cx - chest, shY + (hemY - shY) * 0.25], [cx - hemHalf + 4, hemY - 6]], 6, 4));
    det.push(...dashed(mix(base, "#ffffff", 0.35), 1.5, [[cx + shHalf, shY + 6], [cx + chest, shY + (hemY - shY) * 0.25], [cx + hemHalf - 4, hemY - 6]], 6, 4));
  }
  if (g.print === "franjas") {
    for (const s of [-1, 1]) { det.push(line(g.color2, 6, [[cx + s * chest * 0.92, shY + 30], [cx + s * hemHalf * 0.96, hemY - 10]])); det.push(line(g.color2, 3, [[cx + s * chest * 0.8, shY + 34], [cx + s * hemHalf * 0.84, hemY - 12]])); }
  } else if (g.print === "emblema") {
    const ex = cx + chest * 0.4, ey = shY + (hemY - shY) * 0.3;
    det.push(fill(g.color2, ellipse(ex, ey, 20, 20, 22)), fill(base, ellipse(ex, ey, 14, 14, 22)));
    for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i / 5) * 2 * Math.PI, b = a + Math.PI / 5; det.push(fill(g.color2, [[ex + Math.cos(a) * 11, ey + Math.sin(a) * 11], [ex + Math.cos(b) * 4.5, ey + Math.sin(b) * 4.5], [ex + Math.cos(a + (2 * Math.PI) / 5) * 11, ey + Math.sin(a + (2 * Math.PI) / 5) * 11]])); }
  } else if (g.print === "rombos") {
    for (let y = shY + 50; y < hemY - 30; y += 44) for (let x = cx - chest * 0.8; x < cx + chest * 0.8; x += 44) det.push(fill(g.color2, [[x, y - 10], [x + 10, y], [x, y + 10], [x - 10, y]], 0.8));
  }
  const bindTop = { mode: "skin" as const, bone: BONE.torso, influences: [BONE.hip, BONE.torso, BONE.neck, "Brazo superior izq.", "Brazo superior der."], softness: 16, sharpness: 3 };
  const specs: LayerSpec[] = [{ key: slot, name: g.type === "camiseta" ? "Camiseta" : g.type === "camisa" ? "Camisa" : g.type === "chaleco" ? "Chaleco" : g.type === "sudadera" ? "Sudadera" : g.type === "bomber" ? "Bomber" : g.type === "uniforme" ? "Uniforme" : g.type === "abrigo" ? "Abrigo" : "Chaqueta", part: slot === "camiseta" ? "shirt" : "jacket", strokes: [...extra.filter((s) => hood && s.kind === "fill"), ...fills, ...lines, ...extra.filter((s) => !(hood && s.kind === "fill")), ...det], bind: bindTop }];
  specs.push({ key: `${slot}-sombra`, name: `Sombra ${slot === "camiseta" ? "camiseta" : "chaqueta"}`, part: "jacket-shade", strokes: sha, bind: bindTop, fx: { blend: "multiply", clip: true, opacity: 0.5 } });
  const tex = g.texture !== "liso" ? textureStrokes(g, bounds([[[cx - hemHalf, shY], [cx + hemHalf, hemY]]])) : [];
  if (tex.length) specs.push({ key: `${slot}-det`, name: "Textura prenda", part: "jacket-detail", strokes: tex, bind: bindTop, fx: { clip: true, opacity: 0.85 } });
  void allPolys; void headFrame; void handShapes; void ALL_BONES;
  return specs;
}

/* ───────────────────────── Mangas ───────────────────────── */

export function sleeveLayers(r: Rest, g: GarmentParams): LayerSpec[] {
  if (g.sleeve <= 0.02) return [];
  const pl = r.plan;
  const rand = rng(g.seed + 3);
  const base = g.color, ink = outlineOf(base), dk = shade(base, 0.3);
  const fills: Stroke[] = [], lines: Stroke[] = [], sha: Stroke[] = [];
  const wk = g.sleeveWidth;
  const slot = g.type === "camiseta" || g.type === "camisa" ? "camiseta" : "chaqueta";
  void slot;
  for (const side of ["izq.", "der."] as const) {
    const s = side === "izq." ? 1 : -1;
    const up = `Brazo superior ${side}`, fo = `Brazo inferior ${side}`;
    const total = pl.upper + pl.fore + pl.hand * 0.3;
    const reach = total * Math.min(1.25, g.sleeve) * 0.93;
    const pathPt = (d: number): P => (d <= pl.upper ? r.at(up, d / pl.upper) : r.at(fo, Math.min(1.5, (d - pl.upper) / pl.fore)));
    const ds = [0, 0.18, 0.36, 0.5, 0.64, 0.82, 1].map((k) => k * reach);
    const ctr = ds.map(pathPt);
    const halfAt = (d: number) => {
      const t = d / (pl.upper + pl.fore);
      const arm = t < 0.5 ? pl.upperW * (1.1 - 0.15 * t * 2) : pl.foreW * (1.0 - 0.3 * (t - 0.5) * 2);
      return arm * 0.5 * (1 + 0.5 * (wk - 1)) * 1.05;
    };
    const halfs = ds.map(halfAt);
    const tb = tubePoly(ctr, halfs);
    const poly = spline(tb.poly, true, 3);
    // hombro redondeado
    fills.push(fill(base, ellipse(ctr[0]![0], ctr[0]![1] + halfs[0]! * 0.15, halfs[0]! * 0.95, halfs[0]! * 0.95, 18)));
    fills.push(fill(base, poly));
    const outer = s > 0 ? tb.right : tb.left, inner = s > 0 ? tb.left : tb.right;
    lines.push(line(ink, 2.6, spline(outer.slice(1), false, 4), { taper: "both" }), line(ink, 2.6, spline(inner.slice(1), false, 4), { taper: "both" }));
    // puño
    const end = ctr[ctr.length - 1]!;
    if (g.type === "bomber" || g.type === "uniforme" || g.type === "chaqueta" || g.type === "abrigo" || g.type === "sudadera") {
      const cuffH = g.type === "uniforme" ? 0 : 16;
      if (cuffH) {
        const dirE: P = [end[0] - ctr[ctr.length - 2]![0], end[1] - ctr[ctr.length - 2]![1]];
        const dl = Math.hypot(...dirE) || 1;
        const e2: P = [end[0] - (dirE[0] / dl) * cuffH, end[1] - (dirE[1] / dl) * cuffH];
        const c2 = tubePoly([e2, end], [halfs[6]! * 0.92, halfs[6]! * 0.88]);
        fills.push(fill(g.type === "bomber" ? g.color2 : shade(base, 0.2), c2.poly));
        for (let i = 1; i < 6; i++) { const a = lerp(c2.left[0]!, c2.right[0]!, i / 6), b = lerp(c2.left[1]!, c2.right[1]!, i / 6); lines.push(line(shade(g.color2, 0.3), 1.3, [a, b], { opacity: 0.7 })); }
        lines.push(line(ink, 2.2, [c2.left[0]!, c2.right[0]!], { taper: "both" }), line(ink, 2.2, [c2.left[1]!, c2.right[1]!], { taper: "both" }));
      } else lines.push(line(g.color2, 3, [tb.left[6]!, tb.right[6]!], { taper: "both" }));
    }
    // sombra y pliegues
    const edge = tb.left[0]![0] > tb.right[0]![0] ? tb.left : tb.right;
    sha.push(fill(dk, spline([...edge, ...[...edge].reverse().map((p, i) => [p[0] - halfs[edge.length - 1 - i]! * 0.6, p[1]] as P)], true, 3)));
    const nF = 2 + Math.round(g.folds * 4);
    for (let i = 0; i < nF; i++) {
      const k = 0.35 + rand() * 0.6;
      const c = ctr[Math.min(6, Math.floor(k * 6.99))]!, hw = halfs[Math.min(6, Math.floor(k * 6.99))]!;
      lines.push(line(dk, 2.2, spline([[c[0] - hw * 0.9, c[1] + (rand() - 0.5) * 8], [c[0], c[1] + 6 + rand() * 6], [c[0] + hw * 0.9, c[1] + (rand() - 0.5) * 8]], false, 4), { taper: "both" }));
    }
    if (g.print === "franjas") lines.push(line(g.color2, 5, ctr.map((p, i) => [p[0] + s * -1 * (halfs[i]! * (s > 0 ? -0.0 : 0.0)) + (s > 0 ? halfs[i]! * 0.55 : -halfs[i]! * 0.55), p[1]] as P).slice(0, 6)));
  }
  const bind = { mode: "skin" as const, bone: "Brazo superior izq.", influences: ["Torso", "Brazo superior izq.", "Brazo inferior izq.", "Mano izq.", "Brazo superior der.", "Brazo inferior der.", "Mano der."], softness: 12, sharpness: 3.5 };
  const tex = g.texture !== "liso" ? textureStrokes(g, bounds([[[r.at("Brazo superior izq.", 0)[0] - 200, r.at("Brazo superior izq.", 0)[1]], [r.at("Brazo superior der.", 0)[0] + 200, r.at("Brazo inferior izq.", 1)[1] + 200]]])) : [];
  const out: LayerSpec[] = [
    { key: `${slot}-mangas`, name: slot === "camiseta" ? "Mangas camiseta" : "Mangas", part: "sleeves", strokes: [...fills, ...lines], bind },
    { key: `${slot}-mangas-sombra`, name: "Sombra mangas", part: "sleeves-shade", strokes: sha, bind, fx: { blend: "multiply", clip: true, opacity: 0.5 } },
  ];
  if (tex.length) out.push({ key: `${slot}-mangas-det`, name: "Textura mangas", part: "sleeves-detail", strokes: tex, bind, fx: { clip: true, opacity: 0.85 } });
  return out;
}

/** Genera las capas de una prenda según su tipo. */
export function garmentLayers(r: Rest, g: GarmentParams): LayerSpec[] {
  switch (g.type) {
    case "pantalon": return pantsLayers(r, g);
    case "zapatillas":
    case "botas": return shoesLayers(r, g);
    default: return [...topLayers(r, g), ...sleeveLayers(r, g)];
  }
}

/** ¿En qué «ranura» de capas (y por tanto qué capas) escribe esta prenda? Sirve para sustituirla al regenerar. */
export function garmentKeys(g: GarmentParams): string[] {
  switch (g.type) {
    case "pantalon": return ["pantalon", "pantalon-sombra", "pantalon-det"];
    case "zapatillas":
    case "botas": return ["calzado", "calzado-sombra"];
    case "camiseta":
    case "camisa": return ["camiseta", "camiseta-sombra", "camiseta-det", "camiseta-mangas", "camiseta-mangas-sombra", "camiseta-mangas-det"];
    default: return ["chaqueta", "chaqueta-sombra", "chaqueta-det", "chaqueta-mangas", "chaqueta-mangas-sombra", "chaqueta-mangas-det"];
  }
}
