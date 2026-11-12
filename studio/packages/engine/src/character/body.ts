import type { Stroke } from "@gas/core";
import { BONE } from "./plan";
import type { LayerSpec, Rest } from "./spec";
import { ALL_BONES } from "./spec";
import { add, ellipse, fill, line, mul, norm, outlineOf, shade, tint, mix, spline, type P } from "./vec";

/** Cápsula afilada de a→b con anchos wa/wb (diámetros): se rellena como un polígono suave. */
export function capsule(a: P, b: P, wa: number, wb: number, n = 7): P[] {
  const d = norm([b[0] - a[0], b[1] - a[1]]);
  const nn: P = [-d[1], d[0]];
  const ang = Math.atan2(d[1], d[0]);
  const out: P[] = [];
  for (let i = 0; i <= n; i++) { // tapa en b
    const t = -Math.PI / 2 + (i / n) * Math.PI;
    const r = wb / 2;
    out.push([b[0] + Math.cos(ang + t) * r, b[1] + Math.sin(ang + t) * r]);
  }
  for (let i = 0; i <= n; i++) { // tapa en a
    const t = Math.PI / 2 + (i / n) * Math.PI;
    const r = wa / 2;
    out.push([a[0] + Math.cos(ang + t) * r, a[1] + Math.sin(ang + t) * r]);
  }
  void nn;
  return out;
}

export interface BodyOpts {
  skin: string;
}

/** Mano relajada: palma, cuatro dedos y pulgar. Devuelve los polígonos y las líneas de separación. */
export function handShapes(r: Rest, bone: string, side: 1 | -1, color: string, scale = 1): { fills: P[][]; lines: P[][] } {
  const s = r.st[bone]!;
  const d = r.dir(bone);
  const n = r.nrm(bone);
  const L = s.length * scale;
  const w = (r.plan.handW) * scale; // semianchura
  const th = side > 0 ? 1 : -1; // hacia el lado del pulgar (el interior, hacia el cuerpo)
  const P_ = (u: number, v: number): P => [s.head[0] + d[0] * u * L + n[0] * v * w * th, s.head[1] + d[1] * u * L + n[1] * v * w * th];
  const fills: P[][] = [];
  const lines: P[][] = [];
  // palma
  fills.push(spline([P_(-0.02, -0.7), P_(0.1, -0.95), P_(0.38, -1.05), P_(0.55, -0.85), P_(0.55, 0.9), P_(0.4, 1.1), P_(0.15, 1.0), P_(-0.02, 0.6)], true, 5));
  const lens = [0.44, 0.52, 0.55, 0.5]; // meñique → índice
  for (let i = 0; i < 4; i++) {
    const v = -0.72 + i * 0.5;
    const a = P_(0.5, v), b = P_(0.5 + lens[i]! * 0.98, v + (i - 1.5) * 0.05);
    fills.push(capsule(a, b, w * 0.5, w * 0.44, 5));
    if (i > 0) lines.push([P_(0.55, v - 0.25), P_(0.5 + lens[i]! * 0.6, v - 0.26)]);
  }
  // pulgar
  fills.push(capsule(P_(0.2, 0.85), P_(0.58, 1.55), w * 0.55, w * 0.46, 5));
  lines.push([P_(0.33, 0.95), P_(0.5, 0.78)]);
  void color;
  return { fills, lines };
}

/** Cuerpo base (piel): torso, cuello, brazos, manos y piernas. Las prendas lo cubren; se ve lo que queda descubierto. */
export function bodyLayers(r: Rest, o: BodyOpts): LayerSpec[] {
  const pl = r.plan;
  const skin = o.skin;
  const sh = shade(skin);
  const fills: Stroke[] = [];
  const lines: Stroke[] = [];
  const shadows: Stroke[] = [];
  const outline = outlineOf(skin);

  // ── piernas
  for (const side of ["izq.", "der."] as const) {
    const th = `Pierna superior ${side}`, sn = `Pierna inferior ${side}`;
    const hip = r.at(th, 0), knee = r.at(th, 1), ankle = r.at(sn, 1);
    fills.push(fill(skin, capsule(add(hip, [0, -4]), knee, pl.thighW * 1.3, pl.shinW * 1.0)));
    fills.push(fill(skin, capsule(knee, ankle, pl.shinW * 0.95, pl.shinW * 0.6)));
    const nx = side === "izq." ? 1 : -1; // sombra en el lado exterior-derecho de la pantalla
    shadows.push(fill(sh, capsule(add(knee, [nx * pl.shinW * 0.25, 0]), add(ankle, [nx * pl.shinW * 0.18, 0]), pl.shinW * 0.35, pl.shinW * 0.2)));
  }
  // ── torso: cintura → pecho → hombros, con cuello
  const waist = r.at(BONE.torso, 0), chest = r.at(BONE.torso, 0.7), neckBase = r.at(BONE.torso, 1);
  const hipPt = r.at(BONE.hip, 0);
  const shW = pl.shoulderHalf, wH = pl.waistHalf, hH = pl.hipHalf;
  const torsoPoly: P[] = spline(
    [
      [hipPt[0] - hH, hipPt[1] + pl.thigh * 0.12],
      [waist[0] - wH, waist[1] + 6],
      [chest[0] - shW * 0.9, chest[1]],
      [neckBase[0] - shW * 1.02, neckBase[1] + pl.head * 0.1],
      [neckBase[0] - pl.head * 0.2, neckBase[1] - 4],
      [neckBase[0] + pl.head * 0.2, neckBase[1] - 4],
      [neckBase[0] + shW * 1.02, neckBase[1] + pl.head * 0.1],
      [chest[0] + shW * 0.9, chest[1]],
      [waist[0] + wH, waist[1] + 6],
      [hipPt[0] + hH, hipPt[1] + pl.thigh * 0.12],
    ],
    true,
    4,
  );
  fills.push(fill(skin, torsoPoly));
  // cuello
  const nb = r.at(BONE.neck, 0), nt = r.at(BONE.neck, 1);
  fills.push(fill(skin, capsule(add(nb, [0, 6]), add(nt, [0, -pl.head * 0.1]), pl.head * 0.3, pl.head * 0.28)));
  shadows.push(fill(sh, spline([[nt[0] - pl.head * 0.15, nt[1] + pl.neck * 0.05], [nt[0], nt[1] + pl.neck * 0.02 + pl.head * 0.04], [nt[0] + pl.head * 0.15, nt[1] + pl.neck * 0.05], [nt[0] + pl.head * 0.15, nt[1] + pl.neck * 0.55], [nt[0], nt[1] + pl.neck * 0.62], [nt[0] - pl.head * 0.15, nt[1] + pl.neck * 0.55]], true, 4)));

  // ── brazos y manos
  for (const side of ["izq.", "der."] as const) {
    const s: 1 | -1 = side === "izq." ? 1 : -1;
    const up = `Brazo superior ${side}`, fo = `Brazo inferior ${side}`, ha = `Mano ${side}`;
    const sho = r.at(up, 0), elb = r.at(up, 1), wr = r.at(fo, 1);
    fills.push(fill(skin, ellipse(sho[0], sho[1] + pl.upperW * 0.1, pl.upperW * 0.62, pl.upperW * 0.62, 18)));
    fills.push(fill(skin, capsule(sho, elb, pl.upperW * 1.1, pl.foreW * 1.05)));
    fills.push(fill(skin, capsule(elb, wr, pl.foreW * 1.05, pl.foreW * 0.7)));
    shadows.push(fill(sh, capsule(add(elb, [s * pl.foreW * 0.22, 0]), add(wr, [s * pl.foreW * 0.14, 0]), pl.foreW * 0.35, pl.foreW * 0.2)));
    const hs = handShapes(r, ha, s, skin, 1.18);
    for (const f of hs.fills) fills.push(fill(skin, f));
    for (const l of hs.lines) lines.push(line(outline, 2.2, l, { taper: "both" }));
  }
  return [
    { key: "cuerpo", name: "Cuerpo", part: "body", strokes: [...fills, ...lines], bind: { mode: "skin", bone: BONE.torso, influences: ALL_BONES, softness: 14, sharpness: 3.2 } },
    { key: "cuerpo-sombra", name: "Sombra cuerpo", part: "body-shade", strokes: shadows, bind: { mode: "skin", bone: BONE.torso, influences: ALL_BONES, softness: 14, sharpness: 3.2 }, fx: { blend: "multiply", clip: true, opacity: 0.55 } },
  ];
}

void ellipse; void mul; void tint; void mix;
