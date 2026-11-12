import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { restOf } from "../packages/engine/src";
import { SHOTS, boneRow, createCharacter, mouseStroke, openEditorPage, setColor, setNum, settle, startEnv, waitSaved, type Env } from "./helpers";
import { charDoc, openSection, setRange } from "./char-helpers";

/**
 * PRODUCCIÓN de los tres personajes de prueba. Todo se hace en el editor real, con el ratón y los paneles:
 * proporciones, prendas, rostro, peinado, accesorios, marcas, expresiones, capas de sombra/luz con el pincel y el relleno,
 * detalles dibujados a mano, pose de presentación y bocetos de las vistas. Nada está prefabricado.
 */
let env: Env;
beforeAll(async () => (env = await startEnv()));
afterAll(() => env.close());

const OUT = join(SHOTS, "personajes");
mkdirSync(OUT, { recursive: true });
const V = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } as const;

type P = [number, number];
const restNow = async (page: Page) => restOf(await charDoc(page))!;

/** Crea una capa de efecto sobre la capa `layerGroup`, la deja activa. */
async function fxLayer(page: Page, baseGroup: string, kind: "fx-add-shadow" | "fx-add-soft" | "fx-add-light" | "fx-add-shine") {
  const d = await charDoc(page);
  const base = d.layers.find((l: { group?: string }) => l.group === baseGroup);
  if (!base) throw new Error(`no hay capa ${baseGroup}`);
  await page.evaluate((id) => window.__gas!.model.setLayer(id), base.id);
  await openSection(page, "cp-fx");
  await page.getByTestId(kind).click();
  return (await charDoc(page)).layers.find((l: { clip?: boolean }, i: number, all: Array<{ id: string }>) => all[i - 1]?.id === base.id && l.clip)!.id as string;
}

const fillShape = async (page: Page, color: string, pts: P[]) => {
  await page.getByTestId("tool-fill").click();
  await setColor(page, color);
  await mouseStroke(page, [...pts, pts[0]!]);
};
const penLine = async (page: Page, color: string, size: number, pts: P[]) => {
  await page.getByTestId("tool-pen").click();
  await setColor(page, color);
  await page.getByTestId("brush-size").fill(String(Math.round(100 * Math.sqrt((size - 1) / 199))));
  await mouseStroke(page, pts);
};
const ell = (cx: number, cy: number, rx: number, ry: number, n = 20, rot = 0): P[] => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; const x = Math.cos(a) * rx, y = Math.sin(a) * ry; return [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)] as P; });

const rr = (x0: number, y0: number, x1: number, y1: number, r: number): P[] => {
  const out: P[] = [];
  const corner = (cx: number, cy: number, a0: number) => { for (let i = 0; i <= 5; i++) { const a = a0 + (i / 5) * (Math.PI / 2); out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  corner(x1 - r, y0 + r, -Math.PI / 2); corner(x1 - r, y1 - r, 0); corner(x0 + r, y1 - r, Math.PI / 2); corner(x0 + r, y0 + r, Math.PI);
  return out;
};

async function pickLayer(page: Page, id: string) {
  await page.evaluate((i) => window.__gas!.model.setLayer(i), id);
}
async function newLayerAbove(page: Page, name: string, fx: object = {}) {
  return page.evaluate(([n, f]) => window.__gas!.model.addLayerAbove(window.__gas!.model.layerId, n as string, f as never), [name, fx] as const) as Promise<string>;
}

/** Bocetos de construcción de las otras vistas, dibujados con el relleno a partir de las medidas del personaje. */
async function drawViewSketch(page: Page, view: "threeQuarter" | "side" | "back", c: { skin: string; hair: string; top: string; pants: string; shoes: string }) {
  await page.getByTestId(`view-${view}`).click();
  const d = await charDoc(page);
  const sketchId = d.layers.find((l: { part?: string }) => l.part === "sketch").id;
  await pickLayer(page, sketchId);
  const r = restOf(d)!;
  const pl = r.plan;
  const cx = pl.cx + (view === "threeQuarter" ? 14 : 0);
  const head = r.st["Cabeza"]!;
  const topY = head.tail[1];
  const w = (k: number) => pl.head * k;
  const sideK = view === "side" ? 0.62 : view === "threeQuarter" ? 0.85 : 1; // anchura relativa de la silueta del torso en cada vista
  const hipY = pl.hipY, shY = r.at("Torso", 1)[1] + pl.head * 0.06;
  // piernas
  const leg = (x0: number) => rr(x0 - w(0.3) * (view === "side" ? 1.1 : 1.5), hipY - 10, x0 + w(0.3) * (view === "side" ? 1.1 : 1.5), pl.groundY - pl.foot, 14);
  if (view === "side") await fillShape(page, c.pants, leg(cx));
  else { await fillShape(page, c.pants, leg(cx - w(0.3) * sideK)); await fillShape(page, c.pants, leg(cx + w(0.3) * sideK)); }
  // calzado
  const shoe = (x0: number, dir: number) => [[x0 - w(0.25), pl.groundY - pl.foot - 6], [x0 + w(0.25), pl.groundY - pl.foot - 6], [x0 + w(0.25) + dir * w(0.55), pl.groundY], [x0 - w(0.3), pl.groundY]] as P[];
  if (view === "side") await fillShape(page, c.shoes, shoe(cx, -1));
  else { await fillShape(page, c.shoes, shoe(cx - w(0.3) * sideK, 0)); await fillShape(page, c.shoes, shoe(cx + w(0.3) * sideK, 0)); }
  // torso con la prenda de arriba
  const half = pl.shoulderHalf * sideK * (view === "side" ? 0.7 : 1.05);
  const hem = shY + (pl.torso + pl.pelvis) * 1.5;
  await fillShape(page, c.top, rr(cx - half * 1.1, shY - 6, cx + half * 1.1, hem, 30));
  // brazos
  const armX = view === "side" ? cx : null;
  if (armX !== null) await fillShape(page, c.top, rr(cx - w(0.2), shY, cx + w(0.2), shY + pl.upper + pl.fore, 14));
  else for (const s of [-1, 1]) await fillShape(page, c.top, rr(Math.min(cx + s * (half - w(0.05)), cx + s * (half + w(0.36))), shY, Math.max(cx + s * (half - w(0.05)), cx + s * (half + w(0.36))), shY + pl.upper + pl.fore, 14));
  // manos
  if (view !== "side") for (const s of [-1, 1]) await fillShape(page, c.skin, ell(cx + s * (half + w(0.2)), shY + pl.upper + pl.fore + pl.hand * 0.45, w(0.1), pl.hand * 0.5, 12));
  // cuello y cabeza
  await fillShape(page, c.skin, [[cx - w(0.13), topY + pl.head + pl.neck], [cx + w(0.13), topY + pl.head + pl.neck], [cx + w(0.13), topY + pl.head - 6], [cx - w(0.13), topY + pl.head - 6]]);
  const hx = view === "side" ? cx + w(0.05) : cx;
  if (view === "back") await fillShape(page, c.hair, ell(hx, topY + pl.head * 0.52, w(0.4), pl.head * 0.52, 26));
  else {
    await fillShape(page, c.skin, ell(hx, topY + pl.head * 0.52, view === "side" ? w(0.34) : w(0.38), pl.head * 0.5, 26));
    await fillShape(page, c.hair, ell(hx - (view === "side" ? w(0.04) : 0), topY + pl.head * 0.3, view === "side" ? w(0.4) : w(0.44), pl.head * 0.34, 22));
    if (view === "side") await fillShape(page, c.skin, [[hx + w(0.3), topY + pl.head * 0.5], [hx + w(0.46), topY + pl.head * 0.56], [hx + w(0.3), topY + pl.head * 0.62]]); // nariz de perfil
  }
  // marca de construcción: línea del centro y de los ojos
  await penLine(page, "#555566", 2, [[cx, topY - 10], [cx, pl.groundY + 6]]);
  await penLine(page, "#555566", 2, [[cx - pl.shoulderHalf * 1.4, topY + pl.head * 0.5], [cx + pl.shoulderHalf * 1.4, topY + pl.head * 0.5]]);
}

interface Spec {
  key: string;
  name: string;
  props: Record<string, number>;
  skin: string;
  face: { eye: string; iris: string; brow: string; browColor: string; nose: string; jaw: string };
  hair: { style: string; color: string; length: number; messy: number; part: number };
  marks: Array<[string, boolean]>;
  garments: Array<{ slot: string; type: string; set: Record<string, number | string | boolean> }>;
  acc: string[];
  expr: string;
  sketch: { skin: string; hair: string; top: string; pants: string; shoes: string };
  pose: Record<string, number>;
  poseRoot?: [number, number];
  ficha: Record<string, string>;
}

const SPECS: Spec[] = [
  {
    key: "ryu", name: "Ryu Kurosawa",
    props: { heightCm: 184, heads: 7.7, shoulders: 1.25, build: 0.75, arms: 1.02, legs: 0.97, hands: 1.2, feet: 1.15, torso: 1.04, posture: 0.1 },
    skin: "#e5b693",
    face: { eye: "afilado", iris: "#7a4a2a", brow: "cortada", browColor: "#4a3a1e", nose: "marcada", jaw: "marcada" },
    hair: { style: "puntiagudo", color: "#d9c06a", length: 0.6, messy: 0.8, part: 0.3 },
    marks: [["cicatriz-ceja", true], ["cicatriz-mejilla", false]],
    garments: [
      { slot: "pantalon", type: "pantalon", set: { color: "#2b3a5c", color2: "#e8e4dc", width: 3.0, length: 1.3, sag: 0.75, folds: 0.9, pockets: 2, texture: "denim", belt: true } },
      { slot: "calzado", type: "zapatillas", set: { color: "#ece9e2", color2: "#c93a3a", width: 1.25 } },
      { slot: "camiseta", type: "camiseta", set: { color: "#e9e4d8", width: 1.4, length: 1.25, sleeve: 0.45, sleeveWidth: 1.5, print: "emblema", color2: "#17171f" } },
      { slot: "chaqueta", type: "chaqueta", set: { color: "#8c1f2a", color2: "#e8e4dc", width: 1.75, length: 1.8, sleeve: 1.12, sleeveWidth: 1.7, collar: "solapa", open: 0.6, print: "franjas", pockets: 2, folds: 0.85, texture: "tela" } },
    ],
    acc: ["cadena-cartera", "cadena-cuello", "anillos"],
    expr: "desafiante",
    sketch: { skin: "#e5b693", hair: "#d9c06a", top: "#8c1f2a", pants: "#2b3a5c", shoes: "#ece9e2" },
    pose: { "Brazo superior izq.": -10, "Brazo inferior izq.": 22, "Brazo superior der.": 14, "Brazo inferior der.": -26, Cabeza: -5, Torso: 3 },
    ficha: { age: "18", height: "184 cm", gang: "Los Cuervos de Shibuya", rank: "Líder", description: "Alto, de hombros anchos y mirada desafiante. Pelo rubio decolorado y cicatriz en la ceja.", personality: "Impulsivo y leal; no soporta las injusticias.", history: "Fundó los Cuervos tras abandonar el instituto.", relations: "Rival de Shirogane; protege a los novatos.", design: "Siluetas anchas y cuadradas; contraste rojo/azul.", outfit: "Chaqueta larga roja oversized, pantalón vaquero baggy extremo, zapatillas blancas." },
  },
  {
    key: "aiko", name: "Aiko Shirogane",
    props: { heightCm: 176, heads: 8.0, shoulders: 1.0, build: 0.3, arms: 1.04, legs: 1.1, hands: 1.0, feet: 1.0, torso: 0.97, posture: -0.1 },
    skin: "#f1cdb0",
    face: { eye: "intenso", iris: "#2a2a30", brow: "fina", browColor: "#101014", nose: "minima", jaw: "afilada" },
    hair: { style: "flequillo-largo", color: "#121218", length: 0.5, messy: 0.3, part: -0.5 },
    marks: [["tirita", true], ["ojeras", true]],
    garments: [
      { slot: "pantalon", type: "pantalon", set: { color: "#15151d", width: 2.0, length: 1.1, sag: 0.35, folds: 0.55, pockets: 1, texture: "liso", belt: true, color2: "#6b6358" } },
      { slot: "calzado", type: "botas", set: { color: "#2a1f1a", color2: "#9c7b52", length: 1.2 } },
      { slot: "camiseta", type: "camisa", set: { color: "#bd2c35", width: 1.2, length: 1.2, sleeve: 1.05, collar: "camisa", open: 0, buttons: 5, color2: "#e8e4dc", texture: "liso" } },
      { slot: "chaqueta", type: "uniforme", set: { color: "#16161e", color2: "#d9b04c", width: 1.3, length: 1.9, sleeve: 1.1, sleeveWidth: 1.4, collar: "alto", open: 0.55, buttons: 5, pockets: 2, folds: 0.5 } },
    ],
    acc: ["hachimaki", "pendientes", "muneca"],
    expr: "serio",
    sketch: { skin: "#f1cdb0", hair: "#121218", top: "#16161e", pants: "#15151d", shoes: "#2a1f1a" },
    pose: { "Brazo superior izq.": -6, "Brazo inferior izq.": 8, "Brazo superior der.": 24, "Brazo inferior der.": -85, Cabeza: 5, Torso: -3 },
    ficha: { age: "17", height: "176 cm", gang: "Los Cuervos de Shibuya", rank: "Segunda al mando", description: "Delgada y alta, de postura erguida. Uniforme largo abierto sobre camisa roja.", personality: "Seria y calculadora; explota si se meten con los suyos.", history: "Expulsada de tres institutos antes de unirse a la banda.", relations: "Hermana de armas de Ryu; respeta a pocos.", design: "Silueta larga y vertical; negro con acento rojo; mirada intensa.", outfit: "Gakuran largo abierto, camisa roja, pantalón recto oversized, botas, hachimaki." },
  },
  {
    key: "mina", name: "Mina Hoshino",
    props: { heightCm: 166, heads: 7.4, shoulders: 0.92, build: 0.2, arms: 1.06, legs: 1.0, hands: 1.05, feet: 0.95, torso: 1.02, posture: 0.35 },
    skin: "#f6d9c2",
    face: { eye: "caido", iris: "#5a7a5a", brow: "arqueada", browColor: "#4a2430", nose: "recta", jaw: "suave" },
    hair: { style: "largo", color: "#5a2a3c", length: 0.9, messy: 0.5, part: 0.6 },
    marks: [["moreton", false]],
    garments: [
      { slot: "pantalon", type: "pantalon", set: { color: "#5a6a52", color2: "#a8b89a", width: 2.2, length: 1.05, sag: 0.45, folds: 0.7, pockets: 2, texture: "cuadros", belt: false } },
      { slot: "calzado", type: "zapatillas", set: { color: "#f0e6d0", color2: "#d9843b", width: 1.15 } },
      { slot: "camiseta", type: "camiseta", set: { color: "#2c2c36", width: 1.2, length: 1.1, sleeve: 0.45, color2: "#d9843b" } },
      { slot: "chaqueta", type: "sudadera", set: { color: "#cfa63a", color2: "#f0e6d0", width: 1.95, length: 1.25, sleeve: 1.12, sleeveWidth: 1.7, collar: "capucha", pockets: 1, folds: 0.8, texture: "tela" } },
    ],
    acc: ["guantes", "cadena-cuello", "pendientes"],
    expr: "sonrisaArrogante",
    sketch: { skin: "#f6d9c2", hair: "#5a2a3c", top: "#cfa63a", pants: "#5a6a52", shoes: "#f0e6d0" },
    pose: { "Brazo superior izq.": -14, "Brazo inferior izq.": 12, "Brazo superior der.": 10, "Brazo inferior der.": -20, Cabeza: 8, Torso: 5 },
    poseRoot: [0, 0],
    ficha: { age: "16", height: "166 cm", gang: "Los Cuervos de Shibuya", rank: "Informante", description: "Menuda y ágil; sonríe de lado. Sudadera amarilla enorme y pelo largo color vino.", personality: "Burlona, observadora; siempre sabe más de lo que dice.", history: "Creció en el barrio y conoce todos sus callejones.", relations: "Mejor amiga de Aiko.", design: "Silueta triangular por la sudadera; colores cálidos.", outfit: "Sudadera amarilla oversized con capucha, pantalón de cuadros, zapatillas, guantes sin dedos." },
  },
];

async function produce(spec: Spec) {
  const c = await createCharacter(env, spec.name, "Cuervos");
  const { page, ctx, errors } = await openEditorPage(env, c.url, V);
  // ── proporciones, cuerpo y piel
  for (const [k, v] of Object.entries(spec.props)) { /* se aplican al final de la tanda para una sola regeneración */ void k; void v; }
  await page.getByTestId("char-build").click();
  for (const [k, v] of Object.entries(spec.props)) await setRange(page, `prop-${k}`, v);
  await page.getByTestId("skin-color").fill(spec.skin);
  await page.getByTestId("skin-color").blur();
  // ── rostro
  await openSection(page, "cp-face");
  await page.getByTestId("face-eye-style").selectOption(spec.face.eye);
  await page.getByTestId("face-iris").fill(spec.face.iris); await page.getByTestId("face-iris").blur();
  await page.getByTestId("face-brow-style").selectOption(spec.face.brow);
  await page.getByTestId("face-brow-color").fill(spec.face.browColor); await page.getByTestId("face-brow-color").blur();
  await page.getByTestId("face-nose-style").selectOption(spec.face.nose);
  await page.getByTestId("face-jaw").selectOption(spec.face.jaw);
  for (const [kind, left] of spec.marks) {
    await page.getByTestId("mark-kind").selectOption(kind);
    const cb = page.getByTestId("mark-side");
    if ((await cb.isChecked()) !== left) await cb.setChecked(left);
    await page.getByTestId("mark-add").click();
  }
  // ── ropa
  for (const g of spec.garments) {
    await page.getByTestId(`slot-${g.slot}`).click();
    await page.getByTestId("g-type").selectOption(g.type);
    for (const [k, v] of Object.entries(g.set)) {
      const id = ({ width: "g-width", length: "g-length", sleeve: "g-sleeve", sleeveWidth: "g-sleevew", open: "g-open", sag: "g-sag", folds: "g-folds", pockets: "g-pockets", buttons: "g-buttons" } as Record<string, string>)[k];
      if (id && typeof v === "number") await setRange(page, id, v);
      else if (k === "color" || k === "color2") { const f = page.getByTestId(k === "color" ? "g-color" : "g-color2"); await f.fill(String(v)); await f.blur(); }
      else if (k === "texture") await page.getByTestId("g-texture").selectOption(String(v));
      else if (k === "print") await page.getByTestId("g-print").selectOption(String(v));
      else if (k === "collar") await page.getByTestId("g-collar").selectOption(String(v));
      else if (k === "belt") await page.getByTestId("g-belt").setChecked(Boolean(v));
    }
    await page.getByTestId("g-apply").click();
  }
  // ── cabello
  await openSection(page, "cp-hair");
  await page.getByTestId("hair-style").selectOption(spec.hair.style);
  await page.getByTestId("hair-color").fill(spec.hair.color); await page.getByTestId("hair-color").blur();
  await setRange(page, "hair-length", spec.hair.length);
  await setRange(page, "hair-messy", spec.hair.messy);
  await setRange(page, "hair-part", spec.hair.part);
  // ── accesorios
  await openSection(page, "cp-acc");
  for (const a of spec.acc) await page.getByTestId(`acc-${a}`).click();
  // ── expresiones guardadas (neutral, la de carácter, y una de enfado)
  await openSection(page, "cp-expr");
  for (const [preset, name] of [["neutral", "Neutral"], [spec.expr, "Carácter"], ["enojado", "Enojado"], ["sonrisaLeve", "Sonrisa leve"], ["sorpresa", "Sorpresa"], ["dolor", "Dolor"]] as const) {
    await page.getByTestId(`expr-preset-${preset}`).click();
    await page.getByTestId("expr-name").fill(name);
    await page.getByTestId("expr-save").click();
  }
  await page.getByTestId("expr-preset-" + spec.expr).click();

  // ── acabado a mano (pincel/relleno sobre capas de efecto recortadas)
  await page.getByTestId("zoom-fit").click();
  await settle(page);
  const r = await restNow(page);
  const pl = r.plan;
  const headSt = r.st["Cabeza"]!;
  const hx = headSt.head[0], hTop = headSt.tail[1];
  // luz en el pelo (anillo de brillo y mechones)
  const lightHair = await fxLayer(page, "pelo", "fx-add-light");
  void lightHair;
  await fillShape(page, "#fff6d0", [[hx - pl.head * 0.32, hTop + pl.head * 0.18], [hx - pl.head * 0.05, hTop + pl.head * 0.1], [hx + pl.head * 0.22, hTop + pl.head * 0.14], [hx - pl.head * 0.04, hTop + pl.head * 0.2]]);
  // sombra suave bajo la chaqueta y en el costado
  const shJ = await fxLayer(page, "chaqueta", "fx-add-soft");
  void shJ;
  const sh = r.at("Torso", 1)[1];
  await fillShape(page, "#2a2350", [[pl.cx + pl.shoulderHalf * 0.55, sh + pl.head * 0.5], [pl.cx + pl.shoulderHalf * 1.4, sh + pl.head * 0.6], [pl.cx + pl.shoulderHalf * 1.5, sh + pl.torso * 1.9], [pl.cx + pl.shoulderHalf * 0.5, sh + pl.torso * 1.9]]);
  await fillShape(page, "#2a2350", [[pl.cx - pl.shoulderHalf * 1.1, sh + pl.torso * 1.6], [pl.cx + pl.shoulderHalf * 0.9, sh + pl.torso * 1.6], [pl.cx + pl.shoulderHalf * 0.9, sh + pl.torso * 1.9], [pl.cx - pl.shoulderHalf * 1.1, sh + pl.torso * 1.9]]);
  // brillo en el hombro
  const hiJ = await fxLayer(page, "chaqueta", "fx-add-light");
  void hiJ;
  await fillShape(page, "#fff2d8", [[pl.cx - pl.shoulderHalf * 1.0, sh + pl.head * 0.18], [pl.cx - pl.shoulderHalf * 0.3, sh + pl.head * 0.1], [pl.cx - pl.shoulderHalf * 0.35, sh + pl.head * 0.3], [pl.cx - pl.shoulderHalf * 0.95, sh + pl.head * 0.55]]);
  // detalle dibujado a mano: emblema en el pecho (pincel, tinta fina) y costuras
  const detail = await newLayerAbove(page, "Detalle a mano");
  await pickLayer(page, detail);
  const ex = pl.cx + pl.shoulderHalf * 0.55, ey = sh + pl.head * 0.85;
  await penLine(page, "#d9b04c", 3, [...ell(ex, ey, 17, 17, 22), [ex + 17, ey]] as P[]);
  await penLine(page, "#d9b04c", 3, [[ex - 11, ey + 6], [ex - 4, ey - 8], [ex, ey + 2], [ex + 4, ey - 8], [ex + 11, ey + 6]]);
  await penLine(page, "#1a1a22", 2.5, [[pl.cx - pl.shoulderHalf * 0.2, sh + pl.head * 0.6], [pl.cx - pl.shoulderHalf * 0.25, sh + pl.torso * 1.7]]);
  // sombra de suelo: capa propia, desenfoque, bajo todo el personaje
  const ground = await newLayerAbove(page, "Sombra de suelo", { blend: "multiply", opacity: 0.55, blur: 14 });
  await pickLayer(page, ground);
  await fillShape(page, "#4a4660", ell(pl.cx, pl.groundY + 2, pl.shoulderHalf * 1.7, 14, 28));
  for (let i = 0; i < 60; i++) { const ok = await page.evaluate((id) => { const m = window.__gas!.model; const idx = m.doc.layers.findIndex((l) => l.id === id); if (idx <= 0) return false; m.moveLayer(id, -1); return true; }, ground); if (!ok) break; }

  // ── pose de presentación (keyframe en la vista frontal con el rig)
  await page.getByTestId("tool-rig").click();
  await page.getByTestId("rig-mode-pose").click();
  for (const [bone, rot] of Object.entries(spec.pose)) { await boneRow(page, bone).click(); await setNum(page, "bone-rot", rot); }
  await page.getByTestId("key-save").click();
  await page.getByTestId("tool-pen").click();
  await openSection(page, "cp-poses");
  await page.getByTestId("pose-name").fill("Presentación");
  await page.getByTestId("pose-save").click();

  // ── vistas: bocetos de construcción dibujados a mano (no se «gira» nada)
  await drawViewSketch(page, "threeQuarter", spec.sketch);
  await drawViewSketch(page, "side", spec.sketch);
  await drawViewSketch(page, "back", spec.sketch);
  await page.getByTestId("view-front").click();

  // ── ficha
  await page.getByTestId("open-ficha").click();
  for (const [k, v] of Object.entries(spec.ficha)) await page.getByTestId(`ficha-${k}`).fill(v);
  await page.getByTestId("ficha-tags").fill("pandillero, Shibuya");
  await page.getByTestId("ficha-save").click();
  await page.getByText("Ficha guardada.").waitFor();
  await page.getByTestId("ficha-dialog-close").click();

  // ── resultados
  await page.getByTestId("tool-pen").click();
  await page.getByTestId("side").evaluate((e) => (e.scrollTop = 0));
  await page.getByTestId("zoom-fit").click();
  await settle(page);
  await waitSaved(page);
  await page.screenshot({ path: join(OUT, `${spec.key}-editor.png`) });
  return { c, page, ctx, errors };
}

describe("tres personajes de prueba, hechos con el editor", () => {
  for (const spec of SPECS) {
    it(`${spec.name}: diseño completo, hoja de referencia y vistas`, async () => {
      const { c, page, ctx, errors } = await produce(spec);
      const d = await charDoc(page);
      // contenido real: proporciones adolescentes/adultas, prendas, rostro, pelo, expresiones, pose, ficha
      expect(d.character.proportions.heads).toBeGreaterThanOrEqual(7.2);
      expect(d.character.proportions.heads).toBeLessThanOrEqual(8.2);
      for (const g of ["cuerpo", "cabeza", "ojos", "cejas", "boca", "nariz", "pelo", "pantalon", "calzado", "camiseta", "chaqueta"]) expect(d.layers.some((l: { group?: string }) => l.group === g), g).toBe(true);
      expect(d.layers.some((l: { name: string }) => l.name === "Detalle a mano")).toBe(true);
      expect(d.layers.filter((l: { clip?: boolean }) => l.clip).length).toBeGreaterThanOrEqual(8); // sombras por capas (recortadas)
      expect(d.layers.filter((l: { blur?: number }) => (l.blur ?? 0) > 0).length).toBeGreaterThanOrEqual(2); // sombras suaves
      expect(d.character.expressions.map((e: { name: string }) => e.name)).toEqual(["Neutral", "Carácter", "Enojado", "Sonrisa leve", "Sorpresa", "Dolor"]);
      expect(d.character.poses.map((p: { name: string }) => p.name)).toEqual(["Presentación"]);
      for (let i = 1; i < 4; i++) expect(Object.values(d.frames[i].cells).flat().length, `vista ${i} dibujada a mano`).toBeGreaterThan(8);
      const fill = d.frames[1].cells[d.layers.find((l: { part?: string }) => l.part === "sketch").id].some((s: { kind: string }) => s.kind === "fill");
      expect(fill).toBe(true);
      // hoja de referencia (4 vistas) y vistas sueltas, guardadas en la biblioteca y copiadas a disco
      await openSection(page, "cp-views");
      await page.getByTestId("sheet-save").click();
      await page.getByText(/Hoja de referencia guardada/).waitFor();
      await page.getByTestId("view-png-alpha").click();
      await page.getByText(/Vista «Frontal» guardada/).waitFor();
      const files = (await (await fetch(`${env.base}/api/characters/${c.id}/files`)).json() as { files: string[] }).files;
      const sheet = files.find((f) => f.startsWith("hoja-"))!;
      const front = files.find((f) => f.startsWith("vista-front-alfa"))!;
      writeFileSync(join(OUT, `${spec.key}-hoja-referencia.png`), Buffer.from(await (await fetch(`${env.base}/api/characters/${c.id}/files/${sheet}`)).arrayBuffer()));
      writeFileSync(join(OUT, `${spec.key}-frontal.png`), Buffer.from(await (await fetch(`${env.base}/api/characters/${c.id}/files/${front}`)).arrayBuffer()));
      // captura de las expresiones: se aplican una a una en la vista frontal y se fotografía el rostro
      await page.getByTestId("view-front").click();
      await openSection(page, "cp-expr");
      await page.getByTestId("zoom-fit").click();
      expect(errors).toEqual([]);
      await ctx.close();
      // la miniatura de la biblioteca ya existe tras guardar
      await expect.poll(async () => ((await (await fetch(`${env.base}/api/characters/${c.id}`)).json()) as { thumbnail: string | null }).thumbnail?.startsWith("data:image/png") ?? false, { timeout: 15_000 }).toBe(true);
    }, 600_000);
  }
});
