import type { Stroke } from "@gas/core";
import { handShapes } from "./body";
import { headFrame } from "./face";
import { BONE } from "./plan";
import type { LayerSpec, Rest } from "./spec";
import { add, ellipse, fill, lerp, line, mix, outlineOf, shade, spline, tint, type P } from "./vec";

export const ACCESSORIES = ["cadena-cuello", "cadena-cartera", "guantes", "anillos", "pendientes", "hachimaki", "mascarilla", "muneca"] as const;
export type AccessoryKind = (typeof ACCESSORIES)[number];
export interface AccessoryParams { kind: AccessoryKind; color: string; color2: string }
export const DEFAULT_ACCESSORY: Record<AccessoryKind, AccessoryParams> = {
  "cadena-cuello": { kind: "cadena-cuello", color: "#c9ccd4", color2: "#d8b04c" },
  "cadena-cartera": { kind: "cadena-cartera", color: "#b9bcc4", color2: "#8a8d96" },
  guantes: { kind: "guantes", color: "#1b1b22", color2: "#8b8e96" },
  anillos: { kind: "anillos", color: "#d8b04c", color2: "#c9ccd4" },
  pendientes: { kind: "pendientes", color: "#d8b04c", color2: "#c9ccd4" },
  hachimaki: { kind: "hachimaki", color: "#e8e4dc", color2: "#c93a3a" },
  mascarilla: { kind: "mascarilla", color: "#e9eef2", color2: "#9fb4c6" },
  muneca: { kind: "muneca", color: "#c93a3a", color2: "#1b1b22" },
};

function chain(c: string, pts: P[], link = 7): Stroke[] {
  const out: Stroke[] = [];
  const path = spline(pts, false, 8);
  let acc = 0, k = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    acc += d;
    if (acc >= link) {
      acc = 0;
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const rx = k % 2 ? link * 0.7 : link * 0.45, ry = k % 2 ? link * 0.32 : link * 0.45;
      out.push(line(shade(c, 0.4), 2.1, ellipse(b[0], b[1], rx, ry, 10, ang), { closed: true }));
      out.push(line(tint(c, 0.4), 1, ellipse(b[0], b[1] - 0.6, rx * 0.7, ry * 0.5, 8, ang).slice(0, 5)));
      k++;
    }
  }
  return out;
}

export function accessoryLayers(r: Rest, a: AccessoryParams): LayerSpec[] {
  const pl = r.plan;
  const f = headFrame(r);
  const rigid = { mode: "rigid" as const, bone: BONE.head };
  const torsoBind = { mode: "skin" as const, bone: BONE.torso, influences: [BONE.hip, BONE.torso, BONE.neck, "Brazo superior izq.", "Brazo superior der."], softness: 16, sharpness: 3 };
  const nb = r.at(BONE.torso, 1);
  switch (a.kind) {
    case "cadena-cuello": {
      const x = pl.head * 0.2;
      const strokes = chain(a.color, [[nb[0] - x * 1.1, nb[1] + pl.head * 0.1], [nb[0] - x * 0.7, nb[1] + pl.head * 0.52], [nb[0], nb[1] + pl.head * 0.78], [nb[0] + x * 0.7, nb[1] + pl.head * 0.52], [nb[0] + x * 1.1, nb[1] + pl.head * 0.1]], 8);
      strokes.push(fill(a.color2, [[nb[0], nb[1] + pl.head * 0.78], [nb[0] + 9, nb[1] + pl.head * 0.95], [nb[0], nb[1] + pl.head * 1.16], [nb[0] - 9, nb[1] + pl.head * 0.95]]), line(shade(a.color2, 0.4), 2, [[nb[0], nb[1] + pl.head * 0.78], [nb[0] + 9, nb[1] + pl.head * 0.95], [nb[0], nb[1] + pl.head * 1.16], [nb[0] - 9, nb[1] + pl.head * 0.95]], { closed: true }));
      return [{ key: "acc-cadena-cuello", name: "Cadena (cuello)", part: "accessory", strokes, bind: torsoBind }];
    }
    case "cadena-cartera": {
      const hip = r.at(BONE.hip, 0);
      const w = pl.hipHalf;
      const strokes = chain(a.color, [[hip[0] + w * 0.92, hip[1] - pl.pelvis * 0.1], [hip[0] + w * 1.12, hip[1] + pl.thigh * 0.28], [hip[0] + w * 0.95, hip[1] + pl.thigh * 0.5], [hip[0] + w * 0.7, hip[1] + pl.thigh * 0.52]], 9);
      strokes.push(fill(a.color2, ellipse(hip[0] + w * 0.65, hip[1] + pl.thigh * 0.52, 10, 8, 12)), line(shade(a.color2, 0.4), 2, ellipse(hip[0] + w * 0.65, hip[1] + pl.thigh * 0.52, 10, 8, 12), { closed: true }));
      return [{ key: "acc-cadena-cartera", name: "Cadena (cartera)", part: "accessory", strokes, bind: { mode: "skin", bone: BONE.hip, influences: [BONE.hip, "Pierna superior izq.", "Pierna superior der."], softness: 14, sharpness: 3.4 } }];
    }
    case "guantes": {
      const fills: Stroke[] = [], lines: Stroke[] = [];
      for (const side of ["izq.", "der."] as const) {
        const s: 1 | -1 = side === "izq." ? 1 : -1;
        const hs = handShapes(r, `Mano ${side}`, s, a.color, 1.2);
        fills.push(fill(a.color, hs.fills[0]!));
        for (let i = 1; i < hs.fills.length; i++) { const poly = hs.fills[i]!; const half = Math.floor(poly.length / 2); void half; fills.push(fill(a.color, poly.map((p, k) => (k < poly.length * 0.5 ? lerp(p, hs.fills[0]![0]!, 0) : p)))); }
        const wr = r.at(`Brazo inferior ${side}`, 1);
        lines.push(line(a.color2, 6, [add(wr, [-pl.foreW * 0.5, -2]), add(wr, [pl.foreW * 0.5, -2])]), line(outlineOf(a.color), 2.4, hs.fills[0]!, { closed: true }));
        for (const l of hs.lines) lines.push(line(shade(a.color, 0.4), 1.6, l, { taper: "both" }));
      }
      return [{ key: "acc-guantes", name: "Guantes", part: "accessory", strokes: [...fills, ...lines], bind: { mode: "skin", bone: "Mano izq.", influences: ["Brazo inferior izq.", "Mano izq.", "Brazo inferior der.", "Mano der."], softness: 8, sharpness: 4 } }];
    }
    case "anillos": {
      const out: Stroke[] = [];
      for (const side of ["izq.", "der."] as const) {
        const s: 1 | -1 = side === "izq." ? 1 : -1;
        const bone = `Mano ${side}`;
        const n = r.nrm(bone), d = r.dir(bone), hd = r.st[bone]!.head, L = r.st[bone]!.length, w = pl.handW * 1.18;
        const th = s > 0 ? 1 : -1;
        for (const [fi, u] of [[3, 0.72], [1, 0.7]] as const) {
          const v = (-0.72 + fi * 0.5) * w * th;
          const c: P = [hd[0] + d[0] * u * L * 1.18 + n[0] * v, hd[1] + d[1] * u * L * 1.18 + n[1] * v];
          out.push(line(a.color, 3.2, ellipse(c[0], c[1], pl.handW * 0.34, pl.handW * 0.16, 12, Math.atan2(n[1], n[0])), { closed: true }), line(a.color2, 1.2, [add(c, [-2, -1]), add(c, [2, -1])]));
        }
      }
      return [{ key: "acc-anillos", name: "Anillos", part: "accessory", strokes: out, bind: { mode: "skin", bone: "Mano izq.", influences: ["Brazo inferior izq.", "Mano izq.", "Brazo inferior der.", "Mano der."], softness: 8, sharpness: 4 } }];
    }
    case "pendientes": {
      const out: Stroke[] = [];
      for (const s of [1, -1]) {
        const c = f.at(0.4, s * (0.372 + 0.02));
        out.push(fill(a.color, ellipse(c[0], c[1], 5, 5, 10)), line(shade(a.color, 0.4), 1.6, ellipse(c[0], c[1], 5, 5, 10), { closed: true }), fill(a.color2, ellipse(c[0], c[1] + 12, 3.5, 5, 10)));
      }
      return [{ key: "accc-pendientes", name: "Pendientes", part: "accessory", strokes: out, bind: rigid }];
    }
    case "hachimaki": {
      const band = spline([f.at(0.75, -0.37), f.at(0.78, -0.2), f.at(0.8, 0), f.at(0.78, 0.2), f.at(0.75, 0.37), f.at(0.7, 0.37), f.at(0.72, 0.2), f.at(0.74, 0), f.at(0.72, -0.2), f.at(0.7, -0.37)], true, 4);
      const knot = f.at(0.72, 0.4);
      const out: Stroke[] = [fill(a.color, band), line(outlineOf(a.color), 2.2, band.slice(0, Math.floor(band.length / 2)), { taper: "both" }), fill(a.color2, spline([f.at(0.755, -0.34), f.at(0.78, -0.2), f.at(0.8, 0), f.at(0.775, -0.0), f.at(0.755, -0.2)], true, 3), 0.9)];
      for (const [dx, dy, sg] of [[0.1, 0.25, 1], [0.18, 0.1, -1]] as const) out.push(fill(a.color, spline([knot, f.at(0.72 - dy, 0.4 + dx * sg * 0.2), f.at(0.5 - dy * 0.6, 0.42 + dx * sg), f.at(0.6 - dy * 0.5, 0.38 + dx * sg * 0.5)], true, 3)), line(outlineOf(a.color), 1.8, [knot, f.at(0.5 - dy * 0.6, 0.42 + dx * sg)], { taper: "end" }));
      return [{ key: "accc-hachimaki", name: "Hachimaki", part: "accessory", strokes: out, bind: rigid }];
    }
    case "mascarilla": {
      const m = spline([f.at(0.42, -0.26), f.at(0.4, 0.0), f.at(0.42, 0.26), f.at(0.3, 0.3), f.at(0.14, 0.2), f.at(0.08, 0.0), f.at(0.14, -0.2), f.at(0.3, -0.3)], true, 4);
      const out: Stroke[] = [fill(a.color, m), line(mix(a.color, "#555a66", 0.5), 2.2, m, { closed: true })];
      for (let i = 1; i <= 3; i++) out.push(line(a.color2, 1.6, spline([f.at(0.4 - i * 0.075, -0.25), f.at(0.38 - i * 0.075, 0.0), f.at(0.4 - i * 0.075, 0.25)], false, 4), { taper: "both" }));
      for (const s of [1, -1]) out.push(line(mix(a.color, "#555a66", 0.4), 1.8, [f.at(0.38, s * 0.26), f.at(0.45, s * 0.36), f.at(0.4, s * 0.38)], { taper: "both" }));
      return [{ key: "accc-mascarilla", name: "Mascarilla", part: "accessory", strokes: out, bind: rigid }];
    }
    case "muneca": {
      const out: Stroke[] = [];
      for (const side of ["izq.", "der."] as const) {
        const fo = `Brazo inferior ${side}`;
        const wr = r.at(fo, 0.88), hw = pl.foreW * 0.52;
        out.push(fill(a.color, [[wr[0] - hw, wr[1] - 7], [wr[0] + hw, wr[1] - 7], [wr[0] + hw * 0.9, wr[1] + 9], [wr[0] - hw * 0.9, wr[1] + 9]]), line(outlineOf(a.color), 2, [[wr[0] - hw, wr[1] - 7], [wr[0] + hw, wr[1] - 7], [wr[0] + hw * 0.9, wr[1] + 9], [wr[0] - hw * 0.9, wr[1] + 9]], { closed: true }), line(a.color2, 2, [[wr[0] - hw * 0.9, wr[1]], [wr[0] + hw * 0.9, wr[1]]]));
      }
      return [{ key: "acc-muneca", name: "Muñequeras", part: "accessory", strokes: out, bind: { mode: "skin", bone: "Brazo inferior izq.", influences: ["Brazo inferior izq.", "Mano izq.", "Brazo inferior der.", "Mano der."], softness: 8, sharpness: 4 } }];
    }
  }
}
