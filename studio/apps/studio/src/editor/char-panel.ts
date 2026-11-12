import { longId, type Animation, type Proportions } from "@gas/core";
import {
  ACCESSORIES, BROW_STYLES, COLLARS, DEFAULT_ACCESSORY, DEFAULT_GARMENT, EXPRESSIONS, EYE_STYLES, HAIR_STYLES, JAW_STYLES, MARKS, NOSE_STYLES, PRINTS, TEXTURES, VIEW_LABEL, VIEW_ORDER,
  accessoriesOf, addAccessory, addMark, applyExpression, applyFace, applyGarment, applyHair, applyProportions, applySavedPose, buildBase, clearMarks, copyViewLayers, deleteExpression,
  deleteSavedPose, drawExpressionPreset, ensureSkeleton, lookOf, proportionsOf, removeAccessory, removeGarment, restOf, saveExpression, savePoseFromFrame, viewFrameIndex,
  type AccessoryKind, type GarmentParams, type GarmentType, type HairParams, type MarkKind,
} from "@gas/engine";
import { characterApi } from "../api";
import { h } from "../dom";
import type { EditorModel } from "./model";
import { btn, checkField, colorField, hint, rangeField, row, section, selectField, sub, type Field } from "./char-ui";
import { sheetPng, viewPng } from "./char-sheet";

export const SKIN_TONES = ["#fbe0cc", "#f3cfb2", "#e8b997", "#d49b76", "#b97a56", "#8d5a3c", "#5f3b28"];
export const HAIR_COLORS = ["#0f0f13", "#2b2430", "#4a2f22", "#7a4a2a", "#b58a4a", "#d9c06a", "#c9c9d2", "#b83a4a", "#3a5fa8", "#5a8f5a"];
export const CLOTH_COLORS = ["#17171f", "#2d3a55", "#8a1f2c", "#e6e1d6", "#2c4a3e", "#c9a23a", "#5a6a52", "#d9843b", "#6b3f8a", "#3a3d46"];
const EYE_LABEL: Record<string, string> = { afilado: "Afilado (mirada dura)", normal: "Normal", caido: "Caído", intenso: "Intenso", entrecerrado: "Entrecerrado" };
const BROW_LABEL: Record<string, string> = { recta: "Recta", arqueada: "Arqueada", gruesa: "Gruesa", fina: "Fina", cortada: "Con corte" };
const NOSE_LABEL: Record<string, string> = { minima: "Mínima", recta: "Recta", marcada: "Marcada" };
const JAW_LABEL: Record<string, string> = { afilada: "Afilada", cuadrada: "Cuadrada", marcada: "Marcada", suave: "Suave" };
const HAIR_LABEL: Record<string, string> = { "corto-desordenado": "Corto desordenado", puntiagudo: "Puntiagudo", largo: "Largo", undercut: "Rapado lateral (undercut)", "flequillo-largo": "Flequillo largo" };
const MARK_LABEL: Record<string, string> = { "cicatriz-ceja": "Cicatriz en la ceja", "cicatriz-mejilla": "Cicatriz en la mejilla", tirita: "Tirita en la nariz", moreton: "Moratón", arañazo: "Arañazos", ojeras: "Ojeras" };
const ACC_LABEL: Record<AccessoryKind, string> = { "cadena-cuello": "Cadena de cuello", "cadena-cartera": "Cadena de cartera", guantes: "Guantes sin dedos", anillos: "Anillos", pendientes: "Pendientes", hachimaki: "Hachimaki (cinta)", mascarilla: "Mascarilla", muneca: "Muñequeras" };
const COLLAR_LABEL: Record<string, string> = { ninguno: "Sin cuello", alto: "Cuello alto (uniforme)", solapa: "Solapas", capucha: "Capucha", redondo: "Cuello redondo", camisa: "Cuello de camisa" };
const TEX_LABEL: Record<string, string> = { liso: "Liso", denim: "Vaquero", tela: "Tela", cuadros: "Cuadros", rayas: "Rayas", puntos: "Puntos" };
const PRINT_LABEL: Record<string, string> = { ninguno: "Sin estampado", franjas: "Franjas laterales", emblema: "Emblema", rombos: "Rombos" };
const TYPE_LABEL: Record<GarmentType, string> = { pantalon: "Pantalón", camiseta: "Camiseta amplia", chaqueta: "Chaqueta larga", sudadera: "Sudadera con capucha", bomber: "Chaqueta bomber", uniforme: "Uniforme escolar (gakuran)", camisa: "Camisa abierta", chaleco: "Chaleco", abrigo: "Abrigo", zapatillas: "Zapatillas urbanas", botas: "Botas" };

const SLOTS = [
  { id: "pantalon", label: "Pantalón", types: ["pantalon"] as GarmentType[] },
  { id: "calzado", label: "Calzado", types: ["zapatillas", "botas"] as GarmentType[] },
  { id: "camiseta", label: "Interior", types: ["camiseta", "camisa"] as GarmentType[] },
  { id: "chaqueta", label: "Exterior", types: ["chaqueta", "sudadera", "bomber", "uniforme", "chaleco", "abrigo"] as GarmentType[] },
] as const;
type SlotId = (typeof SLOTS)[number]["id"];

const PROP_PRESETS: Array<[string, string, Partial<Proportions>]> = [
  ["adolescente", "Adolescente", { heightCm: 168, heads: 7.4, shoulders: 0.95, build: 0.25, arms: 1, legs: 1.04, hands: 1, feet: 1, torso: 1, posture: 0 }],
  ["adulto", "Adulto", { heightCm: 180, heads: 7.8, shoulders: 1.1, build: 0.5, arms: 1, legs: 1, hands: 1.05, feet: 1.05, torso: 1, posture: 0 }],
  ["corpulento", "Corpulento", { heightCm: 186, heads: 7.2, shoulders: 1.3, build: 0.95, arms: 1.02, legs: 0.95, hands: 1.2, feet: 1.15, torso: 1.08, posture: 0.15 }],
  ["agil", "Ágil", { heightCm: 176, heads: 8, shoulders: 0.9, build: 0.1, arms: 1.05, legs: 1.12, hands: 1, feet: 1, torso: 0.96, posture: -0.1 }],
];

/**
 * Panel «Personaje»: proporciones, cuerpo, rostro, cabello, ropa, accesorios, expresiones, poses, vistas y acabado.
 * Cada acción es UNA entrada de historial (deshacer/rehacer) y actúa sobre la vista frontal, que es donde se define
 * el esqueleto; el resto de vistas se dibujan y mantienen aparte.
 */
export class CharPanel {
  readonly el: HTMLElement;
  private fields: Field[] = [];
  private g: Partial<Record<SlotId, GarmentParams>> = {};
  private slot: SlotId = "pantalon";
  private acc = { color: "" , color2: "" };
  private exprName = h("input", { type: "text", maxlength: 60, placeholder: "Nombre de la expresión", "data-testid": "expr-name", "aria-label": "Nombre de la expresión" });
  private poseName = h("input", { type: "text", maxlength: 60, placeholder: "Nombre de la pose", "data-testid": "pose-name", "aria-label": "Nombre de la pose" });
  private markSide: 1 | -1 = 1;
  private markKind: MarkKind = "cicatriz-ceja";
  private readonly lists = { expr: h("ul", { class: "cp-list", "data-testid": "expr-list" }), pose: h("ul", { class: "cp-list", "data-testid": "pose-list" }), refs: h("ul", { class: "cp-list", "data-testid": "ref-list" }) };
  private readonly baseMsg = h("p", { class: "hint", "data-testid": "char-base-hint" });
  private readonly garmentBox = h("div", { class: "cp-garment", "data-testid": "garment-form" });
  private readonly accBox = h("div", { class: "chips" });
  private listSig = "";
  private copyFrom: (typeof VIEW_ORDER)[number] = "front";
  private readonly refImages = new Map<string, HTMLImageElement>();
  onRefs: (items: Array<{ id: string; view: string; img: HTMLImageElement; x: number; y: number; scale: number; opacity: number }>) => void = () => undefined;

  constructor(
    private readonly m: EditorModel,
    private readonly host: { characterId: string; characterName: string; openFicha: () => void },
  ) {
    const doc = () => this.m.doc;
    const props = (): Proportions => proportionsOf(doc());
    const setProp = (k: keyof Proportions) => (v: number) => this.run((d) => applyProportions(d, { ...proportionsOf(d), [k]: v }), "Proporciones aplicadas al esqueleto y a todo el dibujo vinculado.");
    const add = <T extends Field>(f: T): HTMLElement => (this.fields.push(f), f.el);

    // ── Vistas
    const viewBtns = VIEW_ORDER.map((k) => h("button", { type: "button", class: "chip", "aria-pressed": "false", "data-testid": `view-${k}`, onclick: () => this.gotoView(k) }, VIEW_LABEL[k]));
    const copySel = h("select", { "data-testid": "view-copy-from", "aria-label": "Copiar capas desde la vista" }, ...VIEW_ORDER.map((k) => h("option", { value: k }, VIEW_LABEL[k])));
    copySel.addEventListener("change", () => (this.copyFrom = copySel.value as typeof this.copyFrom));
    const refFile = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true, "data-testid": "ref-file" });
    refFile.addEventListener("change", () => { const f = refFile.files?.[0]; if (f) void this.addReference(f); refFile.value = ""; });
    const secViews = section("Vistas y referencias", "cp-views", false,
      hint("Cada vista es un dibujo independiente: no se gira una imagen. Dibuja o copia como punto de partida y corrige a mano."),
      h("label", { class: "field" }, h("span", {}, "Copiar capas desde"), copySel),
      row(btn("Copiar a la vista actual", "view-copy", () => this.copyToCurrentView())),
      sub("Imágenes de referencia (de esta vista)"),
      row(btn("Añadir referencia…", "ref-add", () => refFile.click()), refFile), this.lists.refs,
      sub("Hoja de referencia"),
      row(btn("Guardar hoja (PNG)", "sheet-save", () => void this.saveSheet(), "primary"), btn("Vista actual (PNG)", "view-png", () => void this.saveView(false)), btn("Vista actual transparente", "view-png-alpha", () => void this.saveView(true))));

    // ── Proporciones
    const R = (k: keyof Proportions, label: string, min: number, max: number, step: number, digits?: number) => add(rangeField(label, `prop-${k}`, { min, max, step, ...(digits !== undefined ? { digits } : {}) }, () => props()[k], setProp(k)));
    const secProps = section("Proporciones", "cp-props", true,
      hint("Cambian el esqueleto Y reescalan todo el dibujo vinculado (cuerpo, ropa, rostro, pelo)."),
      h("div", { class: "row" }, ...PROP_PRESETS.map(([id, label, p]) => btn(label, `prop-preset-${id}`, () => this.run((d) => applyProportions(d, { ...proportionsOf(d), ...p }), `Proporciones: ${label.toLowerCase()}.`)))),
      R("heightCm", "Altura (cm)", 140, 210, 1), R("heads", "Tamaño de cabeza (cabezas de alto)", 6.4, 8.8, 0.1, 1), R("shoulders", "Anchura de hombros", 0.7, 1.6, 0.05), R("build", "Complexión (0 delgado – 1 fornido)", 0, 1, 0.05),
      R("arms", "Longitud de brazos", 0.8, 1.25, 0.01), R("legs", "Longitud de piernas", 0.8, 1.25, 0.01), R("torso", "Proporción del torso", 0.85, 1.2, 0.01),
      R("hands", "Tamaño de manos", 0.7, 1.4, 0.05), R("feet", "Tamaño de pies", 0.7, 1.4, 0.05), R("posture", "Postura (−1 recta · 1 encorvada)", -1, 1, 0.1, 1));

    // ── Cuerpo y piel
    const secBody = section("Cuerpo y piel", "cp-body", true,
      this.baseMsg,
      row(btn("Crear cuerpo base y esqueleto", "char-build", () => this.run((d) => buildBase(ensureSkeleton(d)), "Cuerpo base y esqueleto humanoide creados. Dibuja encima o añade ropa."), "primary")),
      add(colorField("Color de piel", "skin-color", SKIN_TONES, () => lookOf(doc()).face.skin, (v) => this.face({ skin: v }))));

    // ── Rostro
    const FS = (k: "eyeStyle" | "browStyle" | "noseStyle" | "jaw", label: string, opts: readonly string[], names: Record<string, string>, testid: string) =>
      add(selectField(label, testid, opts.map((o) => [o, names[o]!] as [string, string]), () => lookOf(doc()).face[k] as string, (v) => this.face({ [k]: v })));
    const secFace = section("Rostro", "cp-face", false,
      hint("Regenera ojos, cejas, nariz y mandíbula. Lo dibujado a mano en esas capas se sustituye (se puede deshacer)."),
      FS("eyeStyle", "Forma de los ojos", EYE_STYLES, EYE_LABEL, "face-eye-style"),
      add(rangeField("Tamaño de ojos", "face-eye-size", { min: 0.8, max: 1.3, step: 0.05 }, () => lookOf(doc()).face.eyeSize, (v) => this.face({ eyeSize: v }))),
      add(colorField("Color de ojos", "face-iris", ["#3f6fae", "#7a4a2a", "#2a2a30", "#5a7a5a", "#8a3a46", "#c9a23a"], () => lookOf(doc()).face.iris, (v) => this.face({ iris: v }))),
      FS("browStyle", "Cejas", BROW_STYLES, BROW_LABEL, "face-brow-style"),
      add(colorField("Color de cejas", "face-brow-color", HAIR_COLORS, () => lookOf(doc()).face.browColor, (v) => this.face({ browColor: v }))),
      FS("noseStyle", "Nariz", NOSE_STYLES, NOSE_LABEL, "face-nose-style"),
      FS("jaw", "Mandíbula", JAW_STYLES, JAW_LABEL, "face-jaw"),
      add(rangeField("Tamaño de orejas", "face-ears", { min: 0.6, max: 1.5, step: 0.05 }, () => lookOf(doc()).face.ears, (v) => this.face({ ears: v }))),
      sub("Marcas faciales"),
      h("label", { class: "field" }, h("span", {}, "Marca"), (() => { const s = h("select", { "data-testid": "mark-kind", "aria-label": "Marca" }, ...MARKS.map((k) => h("option", { value: k }, MARK_LABEL[k]!))); s.addEventListener("change", () => (this.markKind = s.value as MarkKind)); return s; })()),
      checkField("En el lado izquierdo del personaje (derecha de la pantalla)", "mark-side", () => this.markSide === 1, (v) => (this.markSide = v ? 1 : -1)).el,
      row(btn("Añadir marca", "mark-add", () => this.run((d) => addMark(d, this.markKind, this.markSide), "Marca añadida a la capa «Marcas faciales».")), btn("Quitar marcas", "mark-clear", () => this.run((d) => clearMarks(d), "Marcas quitadas."))));

    // ── Cabello
    const hairSet = (p: Partial<HairParams>) => this.run((d) => applyHair(d, { ...lookOf(d).hair, ...p }));
    const secHair = section("Cabello y peinado", "cp-hair", false,
      add(selectField("Peinado", "hair-style", HAIR_STYLES.map((s) => [s, HAIR_LABEL[s]!] as [string, string]), () => lookOf(doc()).hair.style, (v) => hairSet({ style: v as HairParams["style"] }))),
      add(colorField("Color de cabello", "hair-color", HAIR_COLORS, () => lookOf(doc()).hair.color, (v) => hairSet({ color: v }))),
      add(rangeField("Largo (flequillo y laterales)", "hair-length", { min: 0, max: 1, step: 0.05 }, () => lookOf(doc()).hair.length, (v) => hairSet({ length: v }))),
      add(rangeField("Desorden", "hair-messy", { min: 0, max: 1, step: 0.05 }, () => lookOf(doc()).hair.messy, (v) => hairSet({ messy: v }))),
      add(rangeField("Raya (izquierda – derecha)", "hair-part", { min: -1, max: 1, step: 0.1, digits: 1 }, () => lookOf(doc()).hair.part, (v) => hairSet({ part: v }))),
      row(btn("Otra variación de mechones", "hair-reseed", () => hairSet({ seed: Math.floor(Math.random() * 9999) + 1 }))));

    // ── Ropa
    const slotBtns = SLOTS.map((s) => h("button", { type: "button", class: "chip", "data-testid": `slot-${s.id}`, "aria-pressed": "false", onclick: () => { this.slot = s.id; this.buildGarmentForm(); this.refresh(); } }, s.label));
    this.slotBtns = slotBtns;
    const secCloth = section("Ropa", "cp-cloth", true,
      hint("Prendas paramétricas: ancho, largo, mangas, cuellos, bolsillos, pliegues, costuras, botones, cremalleras, colores, texturas y estampados. Se pueden retocar a mano después."),
      h("div", { class: "chips", role: "group", "aria-label": "Prenda" }, ...slotBtns),
      this.garmentBox);

    // ── Accesorios
    const secAcc = section("Accesorios", "cp-acc", false, this.accBox,
      add(colorField("Color principal del próximo accesorio", "acc-color", CLOTH_COLORS, () => this.acc.color || "#c9ccd4", (v) => (this.acc.color = v))),
      add(colorField("Color secundario", "acc-color2", CLOTH_COLORS, () => this.acc.color2 || "#d8b04c", (v) => (this.acc.color2 = v))));

    // ── Expresiones
    const secExpr = section("Expresiones", "cp-expr", false,
      hint("Se dibujan en la vista que estás viendo. Edítalas con el pincel y guárdalas con nombre para reutilizarlas en la animación."),
      h("div", { class: "row" }, ...Object.entries(EXPRESSIONS).map(([k, e]) => btn(e.name, `expr-preset-${k}`, () => this.preset(k)))),
      h("label", { class: "field" }, h("span", {}, "Guardar la expresión actual"), this.exprName),
      row(btn("Guardar expresión", "expr-save", () => this.saveExpr(), "primary")), this.lists.expr);

    // ── Poses
    const secPoses = section("Poses guardadas", "cp-poses", false,
      hint("Pon una pose con «Huesos» (K), pulsa «Guardar pose (keyframe)» y guárdala aquí para reutilizarla en cualquier episodio."),
      h("label", { class: "field" }, h("span", {}, "Nombre"), this.poseName),
      row(btn("Guardar pose del fotograma", "pose-save", () => this.savePose(), "primary")), this.lists.pose);

    // ── Ficha
    const secSheet = section("Ficha del personaje", "cp-sheet", false, row(btn("Abrir ficha…", "sheet-open", () => this.host.openFicha())));

    this.viewBar = h("div", { class: "chips view-bar", role: "group", "aria-label": "Vista del personaje" }, ...viewBtns);
    this.el = h("section", { class: "panel-section rig-section char-section", "data-section": "char" }, h("h3", {}, "Personaje"), this.viewBar, secBody, secProps, secFace, secHair, secCloth, secAcc, secExpr, secPoses, secViews, secSheet);
    this.buildGarmentForm();
    this.update();
  }

  private slotBtns: HTMLButtonElement[] = [];
  private viewBar!: HTMLElement;

  /* ───── acciones ───── */
  private run(fn: (d: Animation) => Animation, msg?: string): void {
    // Las herramientas generan sobre la vista frontal (donde vive el esqueleto): se va a ella para ver el resultado.
    const i = viewFrameIndex(this.m.doc, "front");
    if (i >= 0 && this.m.frameIndex !== i && this.needsFront) this.m.setFrameIndex(i);
    if (this.m.edit(fn) && msg) this.m.notice(msg);
  }
  private needsFront = true;
  private face(p: Partial<ReturnType<typeof lookOf>["face"]>): void {
    if (!restOf(this.m.doc)) return this.m.notice("Primero crea el cuerpo base y el esqueleto.");
    this.run((d) => applyFace(d, { ...lookOf(d).face, ...p }));
  }
  private preset(key: string): void {
    if (!restOf(this.m.doc)) return this.m.notice("Primero crea el cuerpo base y el esqueleto.");
    const i = this.m.frameIndex;
    this.needsFront = false;
    this.run((d) => {
      const r = restOf(d)!;
      const base = lookOf(d);
      const out = drawExpressionPreset(d, i, base.face, EXPRESSIONS[key]!.p, r);
      return out.character ? { ...out, character: { ...out.character, look: { ...base, expr: key } as never } } : out;
    }, `Expresión «${EXPRESSIONS[key]!.name}» dibujada en esta vista.`);
    this.needsFront = true;
  }
  private saveExpr(): void {
    const name = this.exprName.value.trim() || "Expresión";
    this.needsFront = false;
    this.run((d) => saveExpression(d, this.m.frameIndex, name).doc, `Expresión «${name}» guardada.`);
    this.needsFront = true;
    this.exprName.value = "";
  }
  private savePose(): void {
    const name = this.poseName.value.trim() || "Pose";
    this.needsFront = false;
    this.run((d) => savePoseFromFrame(d, this.m.frameIndex, name), `Pose «${name}» guardada.`);
    this.needsFront = true;
    this.poseName.value = "";
  }
  gotoView(k: (typeof VIEW_ORDER)[number]): void {
    const i = viewFrameIndex(this.m.doc, k);
    if (i >= 0) this.m.setFrameIndex(i);
  }
  private copyToCurrentView(): void {
    const to = this.currentView();
    if (!to || to === this.copyFrom) return this.m.notice("Elige otra vista de origen.");
    this.needsFront = false;
    this.run((d) => copyViewLayers(d, this.copyFrom, to), `Capas copiadas desde «${VIEW_LABEL[this.copyFrom]}»: ahora corrígelas a mano.`);
    this.needsFront = true;
  }
  currentView(): (typeof VIEW_ORDER)[number] | null {
    return this.m.doc.character?.views.find((v) => v.frameId === this.m.frameId)?.kind ?? null;
  }

  /* ───── prendas ───── */
  private params(slot: SlotId): GarmentParams {
    const stored = this.m.doc.character?.garments.find((x) => x.type === slot)?.params as unknown as GarmentParams | undefined;
    const base = stored ?? this.g[slot] ?? { ...DEFAULT_GARMENT[SLOTS.find((s) => s.id === slot)!.types[0]!] };
    return this.g[slot] ?? base;
  }
  private setG(slot: SlotId, p: Partial<GarmentParams>, apply = true): void {
    const next = { ...this.params(slot), ...p } as GarmentParams;
    this.g[slot] = next;
    if (apply) {
      if (!restOf(this.m.doc)) return this.m.notice("Primero crea el cuerpo base y el esqueleto.");
      this.run((d) => applyGarment(d, Math.max(0, viewFrameIndex(d, "front")), next, restOf(d)!));
    }
  }
  private buildGarmentForm(): void {
    const slot = this.slot;
    const def = SLOTS.find((s) => s.id === slot)!;
    const G = () => this.params(slot);
    const fs: Field[] = [];
    const keep = <T extends Field>(f: T) => (fs.push(f), f.el);
    const isTop = slot === "camiseta" || slot === "chaqueta";
    const type = G().type;
    const body: Node[] = [
      keep(selectField("Tipo de prenda", "g-type", def.types.map((t) => [t, TYPE_LABEL[t]] as [string, string]), () => G().type, (v) => {
        const t = v as GarmentType;
        this.g[slot] = { ...DEFAULT_GARMENT[t], color: G().color, color2: G().color2 };
        this.buildGarmentForm();
        this.setG(slot, {});
      })),
      keep(colorField("Color", "g-color", CLOTH_COLORS, () => G().color, (v) => this.setG(slot, { color: v }))),
      keep(colorField("Color secundario (ribetes, suela, botones)", "g-color2", CLOTH_COLORS, () => G().color2, (v) => this.setG(slot, { color2: v }))),
      keep(rangeField(slot === "pantalon" ? "Anchura (0,6 ajustado – 3,4 baggy extremo)" : "Anchura de la prenda", "g-width", { min: 0.6, max: slot === "pantalon" ? 3.4 : 2.4, step: 0.05 }, () => G().width, (v) => this.setG(slot, { width: v }))),
      keep(rangeField(slot === "pantalon" ? "Largo (>1 se arruga sobre el calzado)" : slot === "calzado" ? "Altura de caña" : "Largo", "g-length", { min: slot === "pantalon" ? 0.8 : 0.6, max: slot === "pantalon" ? 1.4 : 2.3, step: 0.05 }, () => G().length, (v) => this.setG(slot, { length: v }))),
    ];
    if (isTop) {
      body.push(
        keep(rangeField("Largo de manga (0 sin mangas)", "g-sleeve", { min: 0, max: 1.25, step: 0.05 }, () => G().sleeve, (v) => this.setG(slot, { sleeve: v }))),
        keep(rangeField("Anchura de manga", "g-sleevew", { min: 1, max: 2.2, step: 0.05 }, () => G().sleeveWidth, (v) => this.setG(slot, { sleeveWidth: v }))),
        keep(selectField("Cuello", "g-collar", COLLARS.map((c) => [c, COLLAR_LABEL[c]!] as [string, string]), () => G().collar, (v) => this.setG(slot, { collar: v as GarmentParams["collar"] }))),
        keep(rangeField("Abertura delantera", "g-open", { min: 0, max: 1, step: 0.05 }, () => G().open, (v) => this.setG(slot, { open: v }))),
        keep(rangeField("Botones", "g-buttons", { min: 0, max: 8, step: 1 }, () => G().buttons, (v) => this.setG(slot, { buttons: v }))),
        keep(checkField("Cremallera", "g-zipper", () => G().zipper, (v) => this.setG(slot, { zipper: v }))),
        keep(selectField("Estampado", "g-print", PRINTS.map((c) => [c, PRINT_LABEL[c]!] as [string, string]), () => G().print, (v) => this.setG(slot, { print: v as GarmentParams["print"] }))),
      );
    }
    if (slot === "pantalon") body.push(keep(rangeField("Cintura caída", "g-sag", { min: 0, max: 1, step: 0.05 }, () => G().sag, (v) => this.setG(slot, { sag: v }))), keep(checkField("Cinturón", "g-belt", () => G().belt, (v) => this.setG(slot, { belt: v }))));
    if (slot !== "calzado") body.push(keep(rangeField("Bolsillos (0–2)", "g-pockets", { min: 0, max: 2, step: 1 }, () => G().pockets, (v) => this.setG(slot, { pockets: v }))));
    body.push(
      keep(rangeField("Pliegues", "g-folds", { min: 0, max: 1, step: 0.05 }, () => G().folds, (v) => this.setG(slot, { folds: v }))),
      keep(checkField("Costuras", "g-seams", () => G().seams, (v) => this.setG(slot, { seams: v }))),
      keep(selectField("Textura", "g-texture", TEXTURES.map((c) => [c, TEX_LABEL[c]!] as [string, string]), () => G().texture, (v) => this.setG(slot, { texture: v as GarmentParams["texture"] }))),
      row(btn("Poner / actualizar prenda", "g-apply", () => this.setG(slot, {}), "primary"), btn("Quitar prenda", "g-remove", () => { this.g[slot] = undefined as never; delete this.g[slot]; this.run((d) => removeGarment(d, slot), "Prenda quitada."); })),
    );
    void type;
    this.fields = this.fields.filter((f) => !this.garmentFields.includes(f));
    this.garmentFields = fs;
    this.fields.push(...fs);
    this.garmentBox.replaceChildren(...body);
  }
  private garmentFields: Field[] = [];

  /* ───── referencias y hoja ───── */
  private async addReference(file: File): Promise<void> {
    const view = this.currentView();
    if (!view) return this.m.notice("Ve a una de las 4 vistas del personaje para añadir su referencia.");
    const ext = file.type === "image/jpeg" ? "jpg" : file.type === "image/webp" ? "webp" : "png";
    const name = `ref-${view}-${longId().slice(0, 8)}.${ext}`;
    try {
      await characterApi.putFile(this.host.characterId, name, file);
    } catch (err) {
      return this.m.notice(`No se pudo guardar la referencia: ${(err as Error).message}`);
    }
    this.needsFront = false;
    this.run((d) => (d.character ? { ...d, character: { ...d.character, refs: [...d.character.refs, { id: longId(), view, file: name, opacity: 0.5, x: 0, y: 0, scale: 1, visible: true }] } } : d), "Referencia añadida (no se exporta).");
    this.needsFront = true;
  }
  private patchRef(id: string, p: Partial<{ opacity: number; visible: boolean; x: number; y: number; scale: number }> | null): void {
    this.needsFront = false;
    this.run((d) => (d.character ? { ...d, character: { ...d.character, refs: p ? d.character.refs.map((r) => (r.id === id ? { ...r, ...p } : r)) : d.character.refs.filter((r) => r.id !== id) } } : d));
    this.needsFront = true;
  }
  async saveSheet(): Promise<void> {
    const blob = await sheetPng(this.m.doc, this.host.characterName);
    const name = `hoja-${longId().slice(0, 8)}.png`;
    try {
      await characterApi.putFile(this.host.characterId, name, blob);
      this.m.notice(`Hoja de referencia guardada en la biblioteca (${name}).`);
    } catch (err) {
      this.m.notice(`No se pudo guardar la hoja: ${(err as Error).message}`);
    }
    const a = h("a", { href: URL.createObjectURL(blob), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  async saveView(transparent: boolean): Promise<void> {
    const view = this.currentView() ?? "front";
    const blob = await viewPng(this.m.doc, this.m.frameIndex, transparent);
    const name = `vista-${view}${transparent ? "-alfa" : ""}-${longId().slice(0, 6)}.png`;
    try {
      await characterApi.putFile(this.host.characterId, name, blob);
      this.m.notice(`Vista «${VIEW_LABEL[view]}» guardada en la biblioteca (${name}).`);
    } catch (err) {
      this.m.notice(`No se pudo guardar la vista: ${(err as Error).message}`);
    }
    const a = h("a", { href: URL.createObjectURL(blob), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* ───── lectura → UI ───── */
  update(): void {
    this.refresh();
  }
  private refresh(): void {
    const d = this.m.doc;
    const hasSk = !!d.rigs?.length;
    this.baseMsg.textContent = hasSk ? "Esqueleto humanoide creado. Las herramientas actúan sobre la vista frontal." : "Aún no hay esqueleto: crea el cuerpo base (o dibuja a mano y crea los huesos en «Huesos»).";
    for (const f of this.fields) f.refresh();
    const cur = this.currentView();
    this.viewBar.querySelectorAll("button").forEach((b, i) => { const on = VIEW_ORDER[i] === cur; b.setAttribute("aria-pressed", String(on)); b.classList.toggle("on", on); });
    this.slotBtns.forEach((b, i) => { const on = SLOTS[i]!.id === this.slot; b.setAttribute("aria-pressed", String(on)); b.classList.toggle("on", on); });
    // listas (expresiones, poses, referencias, accesorios): se reconstruyen solo si cambian
    const b = d.character;
    const view = this.currentView();
    const sig = JSON.stringify([b?.expressions.map((e) => e.id + e.name), b?.poses.map((p) => p.id + p.name), b?.refs.map((r) => [r.id, r.view, r.opacity, r.visible]), view, hasSk ? accessoriesOf(d) : []]);
    if (sig !== this.listSig) {
      this.listSig = sig;
      this.lists.expr.replaceChildren(...(b?.expressions ?? []).map((e) => h("li", {}, h("span", {}, e.name), btn("Aplicar", "expr-apply", () => { this.needsFront = false; this.run((x) => applyExpression(x, this.m.frameIndex, e.id)); this.needsFront = true; }), btn("Eliminar", "expr-del", () => this.run((x) => deleteExpression(x, e.id))))));
      this.lists.pose.replaceChildren(...(b?.poses ?? []).map((p) => h("li", {}, h("span", {}, p.name), btn("Aplicar", "pose-apply", () => { this.needsFront = false; this.run((x) => applySavedPose(x, this.m.frameIndex, p.id)); this.needsFront = true; }), btn("Eliminar", "pose-del", () => this.run((x) => deleteSavedPose(x, p.id))))));
      this.lists.refs.replaceChildren(...(b?.refs ?? []).filter((r) => r.view === view).map((r) => {
        const o = h("input", { type: "range", min: 0.05, max: 1, step: 0.05, value: r.opacity, "aria-label": "Opacidad de la referencia", "data-testid": "ref-opacity" });
        o.addEventListener("change", () => this.patchRef(r.id, { opacity: Number(o.value) }));
        const sc = h("input", { type: "range", min: 0.2, max: 3, step: 0.05, value: r.scale, "aria-label": "Tamaño de la referencia", "data-testid": "ref-scale" });
        sc.addEventListener("change", () => this.patchRef(r.id, { scale: Number(sc.value) }));
        return h("li", { class: "col" }, h("span", {}, r.file), o, sc, row(btn(r.visible ? "Ocultar" : "Mostrar", "ref-toggle", () => this.patchRef(r.id, { visible: !r.visible })), btn("Quitar", "ref-del", () => this.patchRef(r.id, null))));
      }));
      const on = hasSk ? accessoriesOf(d) : [];
      this.accBox.replaceChildren(...ACCESSORIES.map((k) => {
        const active = on.includes(k);
        return h("button", { type: "button", class: `chip${active ? " on" : ""}`, "aria-pressed": String(active), "data-testid": `acc-${k}`, onclick: () => {
          if (!restOf(this.m.doc)) return this.m.notice("Primero crea el cuerpo base y el esqueleto.");
          this.run((x) => (active ? removeAccessory(x, k) : addAccessory(x, { ...DEFAULT_ACCESSORY[k], ...(this.acc.color ? { color: this.acc.color } : {}), ...(this.acc.color2 ? { color2: this.acc.color2 } : {}) })));
        } }, ACC_LABEL[k]);
      }));
      this.pushRefs();
    }
  }
  private pushRefs(): void {
    const refs = this.m.doc.character?.refs ?? [];
    const items: Parameters<CharPanel["onRefs"]>[0] = [];
    for (const r of refs) {
      if (!r.visible) continue;
      let img = this.refImages.get(r.file);
      if (!img) {
        img = new Image();
        img.onload = () => this.pushRefs();
        img.src = characterApi.fileUrl(this.host.characterId, r.file);
        this.refImages.set(r.file, img);
      }
      if (img.complete && img.naturalWidth) items.push({ id: r.id, view: r.view, img, x: r.x, y: r.y, scale: r.scale, opacity: r.opacity });
    }
    this.onRefs(items);
  }
}
