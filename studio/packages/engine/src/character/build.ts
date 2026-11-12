import { DEFAULT_PROPORTIONS, type Animation, type Proportions, type Stroke } from "@gas/core";
import { accessoryLayers, ACCESSORIES, type AccessoryKind, type AccessoryParams } from "./accessories";
import { applySpecs, ensureSkeleton, restOf, viewFrameIndex } from "./assemble";
import { bodyLayers } from "./body";
import { DEFAULT_FACE, EXPRESSIONS, faceLayers, headLayers, markStrokes, type ExprParams, type FaceParams, type MarkKind } from "./face";
import { DEFAULT_HAIR, hairLayers, type HairParams } from "./hair";
import type { LayerSpec, Rest } from "./spec";

/** Parámetros con los que se generó el personaje (se guardan en el documento para poder volver a editarlos). */
export interface Look {
  face: FaceParams;
  hair: HairParams;
  /** Preajuste de expresión usado para ojos/cejas/boca al regenerar el rostro. */
  expr: string;
}
export const DEFAULT_LOOK: Look = { face: DEFAULT_FACE, hair: DEFAULT_HAIR, expr: "neutral" };

export function lookOf(doc: Animation): Look {
  const l = (doc.character?.look ?? {}) as Partial<Look>;
  return { face: { ...DEFAULT_FACE, ...(l.face ?? {}) }, hair: { ...DEFAULT_HAIR, ...(l.hair ?? {}) }, expr: l.expr && EXPRESSIONS[l.expr] ? l.expr : "neutral" };
}
const withLook = (doc: Animation, look: Look): Animation => (doc.character ? { ...doc, character: { ...doc.character, look: look as unknown as Record<string, unknown> } } : doc);

const front = (doc: Animation) => Math.max(0, viewFrameIndex(doc, "front"));
const restOrThrow = (doc: Animation): Rest => {
  const r = restOf(doc);
  if (!r) throw new Error("El personaje aún no tiene esqueleto: crea primero el cuerpo base");
  return r;
};

/** Cuerpo base (piel) + esqueleto humanoide + cabeza. Si ya existe, solo regenera el dibujo de piel. */
export function buildBase(doc: Animation, look: Look = lookOf(doc)): Animation {
  let d = ensureSkeleton(doc);
  const r = restOrThrow(d);
  const fi = front(d);
  d = applySpecs(d, fi, bodyLayers(r, { skin: look.face.skin }));
  d = applySpecs(d, fi, headLayers(r, look.face));
  return withLook(d, look);
}

/** Regenera cabeza, ojos, nariz, cejas y boca (rostro) con los parámetros indicados. Las marcas y los vínculos se conservan. */
export function applyFace(doc: Animation, face: FaceParams, exprKey = lookOf(doc).expr): Animation {
  const look = { ...lookOf(doc), face, expr: exprKey };
  let d = ensureSkeleton(doc);
  const r = restOrThrow(d);
  const fi = front(d);
  const expr: ExprParams = EXPRESSIONS[exprKey]?.p ?? EXPRESSIONS.neutral!.p;
  d = applySpecs(d, fi, bodyLayers(r, { skin: face.skin }));
  d = applySpecs(d, fi, headLayers(r, face));
  d = applySpecs(d, fi, faceLayers(r, face, expr));
  return withLook(d, look);
}

export function applyHair(doc: Animation, hair: HairParams): Animation {
  const d = ensureSkeleton(doc);
  const r = restOrThrow(d);
  return withLook(applySpecs(d, front(d), hairLayers(r, hair)), { ...lookOf(doc), hair });
}

/** Marcas faciales: se AÑADEN a la capa «Marcas» (se pueden mover/borrar como cualquier trazo). */
export function addMark(doc: Animation, kind: MarkKind, side: 1 | -1 = 1): Animation {
  const d = ensureSkeleton(doc);
  const r = restOrThrow(d);
  const fi = front(d);
  const marks = d.layers.find((l) => l.group === "marcas");
  const extra: Stroke[] = markStrokes(r, lookOf(d).face, kind, side);
  const prev = marks ? (d.frames[fi]!.cells[marks.id] ?? []) : [];
  return applySpecs(d, fi, [{ key: "marcas", name: "Marcas faciales", part: "marks", strokes: [...prev, ...extra], bind: { mode: "rigid", bone: "Cabeza" } } satisfies LayerSpec]);
}
export function clearMarks(doc: Animation): Animation {
  const marks = doc.layers.find((l) => l.group === "marcas");
  if (!marks) return doc;
  const fi = front(doc);
  const cells = { ...doc.frames[fi]!.cells };
  delete cells[marks.id];
  return { ...doc, frames: doc.frames.map((f, i) => (i === fi ? { ...f, cells } : f)) };
}

export function addAccessory(doc: Animation, a: AccessoryParams): Animation {
  const d = ensureSkeleton(doc);
  const r = restOrThrow(d);
  return applySpecs(d, front(d), accessoryLayers(r, a));
}
export function removeAccessory(doc: Animation, kind: AccessoryKind): Animation {
  const key = ACC_KEY[kind];
  const l = doc.layers.find((x) => x.group === key);
  if (!l) return doc;
  return {
    ...doc,
    layers: doc.layers.filter((x) => x.id !== l.id),
    frames: doc.frames.map((f) => {
      if (!(l.id in f.cells)) return f;
      const cells = { ...f.cells };
      delete cells[l.id];
      return { ...f, cells };
    }),
    ...(doc.rigs ? { rigs: doc.rigs.map((s) => ({ ...s, bindings: s.bindings.filter((b) => b.layerId !== l.id) })) } : {}),
  };
}
const ACC_KEY: Record<AccessoryKind, string> = { "cadena-cuello": "acc-cadena-cuello", "cadena-cartera": "acc-cadena-cartera", guantes: "acc-guantes", anillos: "acc-anillos", pendientes: "accc-pendientes", hachimaki: "accc-hachimaki", mascarilla: "accc-mascarilla", muneca: "acc-muneca" };
export const accessoriesOf = (doc: Animation): AccessoryKind[] => ACCESSORIES.filter((k) => doc.layers.some((l) => l.group === ACC_KEY[k]));

export const proportionsOf = (doc: Animation): Proportions => doc.character?.proportions ?? DEFAULT_PROPORTIONS;
