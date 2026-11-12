import { CharacterBlockSchema, DEFAULT_PROPORTIONS, longId, type Animation, type Bone, type Layer, type Proportions, type Skeleton, type ViewKind } from "@gas/core";
import { restStates } from "../rig";
import { DEFAULT_SHARPNESS, DEFAULT_SOFTNESS } from "../rig-ops";
import { CHAR_H, CHAR_W, planBody, planBones } from "./plan";
import { makeRest, type LayerSpec, type Rest } from "./spec";

/** Orden de apilado (de abajo arriba) de las capas que generan las herramientas. Las capas del usuario no se mueven. */
export const STACK = ["pelo-atras", "cuerpo", "cuerpo-sombra", "calzado", "calzado-sombra", "calzado-det", "pantalon", "pantalon-sombra", "pantalon-det", "camiseta", "camiseta-sombra", "camiseta-det", "camiseta-mangas", "camiseta-mangas-sombra", "camiseta-mangas-det", "chaqueta", "chaqueta-sombra", "chaqueta-det", "chaqueta-mangas", "chaqueta-mangas-sombra", "chaqueta-mangas-det", "cabeza", "cabeza-sombra", "ojos", "nariz", "boca", "cejas", "marcas", "pelo", "pelo-sombra"];
/** Rango de apilado de una clave de capa (las de accesorios van tras la ropa y antes del rostro). */
export function stackRank(key: string | undefined): number {
  if (!key) return -1;
  const i = STACK.indexOf(key);
  if (i >= 0) return i * 2;
  if (key.startsWith("acc-")) return STACK.indexOf("chaqueta-mangas-det") * 2 + 1;
  if (key.startsWith("accc-")) return STACK.indexOf("pelo-sombra") * 2 + 1; // accesorios de cabeza: sobre el pelo
  return -1;
}

export const VIEW_LABEL: Record<ViewKind, string> = { front: "Frontal", threeQuarter: "Tres cuartos", side: "Lateral", back: "Espalda" };
export const VIEW_ORDER: ViewKind[] = ["front", "threeQuarter", "side", "back"];

/** Documento de personaje vacío: 4 vistas independientes (4 dibujos), sin esqueleto ni capas de cuerpo. */
export function newCharacterDoc(id: string, proportions: Proportions = DEFAULT_PROPORTIONS): Animation {
  const frames = VIEW_ORDER.map(() => ({ id: longId(), hold: 1, cells: {} as Record<string, never[]> }));
  return {
    schemaVersion: 3,
    episodeId: id,
    revision: 0,
    fps: 12,
    width: CHAR_W,
    height: CHAR_H,
    layers: [{ id: longId(), name: "Boceto", visible: true, locked: false, part: "sketch" }],
    frames,
    character: CharacterBlockSchema.parse({ proportions, views: frames.map((f, i) => ({ frameId: f.id, kind: VIEW_ORDER[i]! })), expressions: [], garments: [], palettes: [] }),
  };
}

/** Índice del fotograma de una vista. */
export function viewFrameIndex(doc: Animation, kind: ViewKind): number {
  const v = doc.character?.views.find((x) => x.kind === kind);
  return v ? doc.frames.findIndex((f) => f.id === v.frameId) : -1;
}

export function characterSkeleton(doc: Animation): Skeleton | null {
  return doc.rigs?.[0] ?? null;
}

/** Cuerpo (huesos) y plan a partir de las proporciones actuales. */
export function restOf(doc: Animation): Rest | null {
  const sk = characterSkeleton(doc);
  const p = doc.character?.proportions;
  if (!sk || !p) return null;
  return makeRest(planBody(p, CHAR_W / 2, CHAR_H - 70), sk.bones, restStates(sk));
}

/** Crea (o reemplaza) el esqueleto humanoide según las proporciones. Devuelve el documento y el plan. */
export function ensureSkeleton(doc: Animation, name = "Esqueleto"): Animation {
  if (doc.rigs?.length) return doc;
  const p = doc.character?.proportions ?? DEFAULT_PROPORTIONS;
  const pl = planBody(p);
  const bones: Bone[] = planBones(pl, p);
  const sk: Skeleton = { id: longId(), name, bones, bindings: [] };
  // Cada vista (dibujo) lleva su propia pose de reposo explícita: así una pose en la vista frontal no se «filtra» a las demás.
  const frames = doc.character ? doc.frames.map((f) => ({ ...f, poses: { ...(f.poses ?? {}), [sk.id]: { bones: {}, ease: "step" as const } } })) : doc.frames;
  return { ...doc, frames, rigs: [sk] };
}

/**
 * Crea o actualiza las capas de `specs` en el fotograma `frameIndex`. Si ya existe una capa con esa clave
 * (guardada en `group` = `<clave>`), se REEMPLAZA su dibujo en vez de duplicarla: así un generador se puede volver a aplicar.
 * La capa lleva `part` y se vincula al esqueleto según `bind`.
 */
export function applySpecs(doc: Animation, frameIndex: number, specs: readonly LayerSpec[], opts: { above?: string | null } = {}): Animation {
  const d = ensureSkeleton(doc);
  const sk = d.rigs![0]!;
  const byName = new Map(sk.bones.map((b) => [b.name, b.id]));
  const layers = [...d.layers];
  const frames = d.frames.slice();
  const fr = { ...frames[frameIndex]!, cells: { ...frames[frameIndex]!.cells } };
  const bindings = [...sk.bindings];
  let insertAt = opts.above ? layers.findIndex((l) => l.id === opts.above) + 1 : layers.length;
  for (const sp of specs) {
    const found = layers.findIndex((l) => l.group === sp.key);
    let layer: Layer;
    if (found >= 0) {
      layer = { ...layers[found]!, part: sp.part, group: sp.key, ...(sp.fx ?? {}) };
      layers[found] = layer;
      insertAt = found + 1;
    } else {
      layer = { id: longId(), name: sp.name, visible: true, locked: false, part: sp.part, group: sp.key, ...(sp.fx ?? {}) };
      const rank = stackRank(sp.key);
      let at = opts.above ? insertAt : layers.length;
      if (rank >= 0 && !opts.above) {
        at = 0; // por defecto, bajo todo; sube sobre la última capa «generada» de rango menor
        for (let k = 0; k < layers.length; k++) { const rk = stackRank(layers[k]!.group); if (rk >= 0 && rk < rank) at = k + 1; }
      }
      layers.splice(at, 0, layer);
      insertAt = at + 1;
    }
    fr.cells[layer.id] = sp.strokes;
    if (sp.bind) {
      const bone = byName.get(sp.bind.bone);
      if (bone) {
        const infl = (sp.bind.influences ?? [sp.bind.bone]).map((n) => byName.get(n)).filter((x): x is string => !!x);
        const idx = bindings.findIndex((b) => b.layerId === layer.id);
        const b = { layerId: layer.id, mode: sp.bind.mode, bone, influences: sp.bind.mode === "skin" ? infl : [], softness: sp.bind.softness ?? DEFAULT_SOFTNESS, sharpness: sp.bind.sharpness ?? DEFAULT_SHARPNESS };
        if (idx >= 0) bindings[idx] = b;
        else bindings.push(b);
      }
    }
  }
  frames[frameIndex] = fr;
  return { ...d, layers, frames, rigs: [{ ...sk, bindings }, ...(d.rigs!.slice(1))] };
}
