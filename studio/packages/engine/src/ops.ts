import {
  MAX_FRAMES,
  MAX_HOLD,
  MAX_LAYERS,
  FpsSchema,
  longId,
  type Animation,
  type Frame,
  type Layer,
  type Stroke,
} from "@gas/core";

export class EngineError extends Error {
  constructor(
    message: string,
    readonly code: "not-found" | "locked" | "hidden" | "limit" | "invalid",
  ) {
    super(message);
    this.name = "EngineError";
  }
}

/* Todas las operaciones son puras: devuelven un documento nuevo y comparten (no copian) lo que no cambia.
 * Eso hace barato el historial por instantáneas y permite cachear mapas de bits por identidad de array. */

const EMPTY: readonly Stroke[] = Object.freeze([]);

export function layerIndex(a: Animation, layerId: string): number {
  const i = a.layers.findIndex((l) => l.id === layerId);
  if (i < 0) throw new EngineError(`Capa inexistente: ${layerId}`, "not-found");
  return i;
}

export function frameIndexById(a: Animation, frameId: string): number {
  const i = a.frames.findIndex((f) => f.id === frameId);
  if (i < 0) throw new EngineError(`Fotograma inexistente: ${frameId}`, "not-found");
  return i;
}

export function strokesOf(frame: Frame, layerId: string): readonly Stroke[] {
  return frame.cells[layerId] ?? EMPTY;
}

/** Una capa admite edición si existe, es visible y no está bloqueada. */
export function assertEditable(a: Animation, layerId: string): Layer {
  const layer = a.layers[layerIndex(a, layerId)]!;
  if (layer.locked) throw new EngineError(`La capa «${layer.name}» está bloqueada`, "locked");
  if (!layer.visible) throw new EngineError(`La capa «${layer.name}» está oculta`, "hidden");
  return layer;
}

/* ─────────── Capas ─────────── */

export function addLayer(a: Animation, name?: string, aboveLayerId?: string): { doc: Animation; layerId: string } {
  if (a.layers.length >= MAX_LAYERS) throw new EngineError(`Máximo ${MAX_LAYERS} capas`, "limit");
  const layer: Layer = { id: longId(), name: name?.trim() || `Capa ${a.layers.length + 1}`, visible: true, locked: false };
  const at = aboveLayerId ? layerIndex(a, aboveLayerId) + 1 : a.layers.length;
  const layers = [...a.layers.slice(0, at), layer, ...a.layers.slice(at)];
  return { doc: { ...a, layers }, layerId: layer.id };
}

export function removeLayer(a: Animation, layerId: string): Animation {
  layerIndex(a, layerId);
  if (a.layers.length === 1) throw new EngineError("Debe quedar al menos una capa", "limit");
  return {
    ...a,
    layers: a.layers.filter((l) => l.id !== layerId),
    frames: a.frames.map((f) => {
      if (!(layerId in f.cells)) return f;
      const cells = { ...f.cells };
      delete cells[layerId];
      return { ...f, cells };
    }),
  };
}

function patchLayer(a: Animation, layerId: string, patch: Partial<Layer>): Animation {
  const i = layerIndex(a, layerId);
  return { ...a, layers: a.layers.map((l, j) => (j === i ? { ...l, ...patch } : l)) };
}

export function renameLayer(a: Animation, layerId: string, name: string): Animation {
  const n = name.trim();
  if (!n) throw new EngineError("El nombre no puede estar vacío", "invalid");
  return patchLayer(a, layerId, { name: n.slice(0, 60) });
}
export const setLayerVisible = (a: Animation, id: string, visible: boolean) => patchLayer(a, id, { visible });
export const setLayerLocked = (a: Animation, id: string, locked: boolean) => patchLayer(a, id, { locked });

/** `delta` = +1 sube la capa (más arriba en la pila), −1 la baja. Devuelve el mismo doc si ya está en el borde. */
export function moveLayer(a: Animation, layerId: string, delta: 1 | -1): Animation {
  const i = layerIndex(a, layerId);
  const j = i + delta;
  if (j < 0 || j >= a.layers.length) return a;
  const layers = [...a.layers];
  [layers[i], layers[j]] = [layers[j]!, layers[i]!];
  return { ...a, layers };
}

/* ─────────── Fotogramas ─────────── */

export function addFrame(a: Animation, afterIndex: number): { doc: Animation; frameId: string } {
  if (a.frames.length >= MAX_FRAMES) throw new EngineError(`Máximo ${MAX_FRAMES} fotogramas`, "limit");
  const at = Math.min(Math.max(afterIndex + 1, 0), a.frames.length);
  const frame: Frame = { id: longId(), hold: 1, cells: {} };
  return { doc: { ...a, frames: [...a.frames.slice(0, at), frame, ...a.frames.slice(at)] }, frameId: frame.id };
}

/** Copia el fotograma justo después. Los trazos se comparten (inmutables), no se duplican en memoria. */
export function duplicateFrame(a: Animation, index: number): { doc: Animation; frameId: string } {
  if (a.frames.length >= MAX_FRAMES) throw new EngineError(`Máximo ${MAX_FRAMES} fotogramas`, "limit");
  const src = a.frames[index];
  if (!src) throw new EngineError("Fotograma inexistente", "not-found");
  const copy: Frame = { id: longId(), hold: src.hold, cells: { ...src.cells } };
  return { doc: { ...a, frames: [...a.frames.slice(0, index + 1), copy, ...a.frames.slice(index + 1)] }, frameId: copy.id };
}

export function deleteFrame(a: Animation, index: number): Animation {
  if (!a.frames[index]) throw new EngineError("Fotograma inexistente", "not-found");
  if (a.frames.length === 1) throw new EngineError("Debe quedar al menos un fotograma", "limit");
  return { ...a, frames: a.frames.filter((_, i) => i !== index) };
}

export function setHold(a: Animation, frameId: string, hold: number): Animation {
  if (!Number.isInteger(hold) || hold < 1 || hold > MAX_HOLD) throw new EngineError(`La duración debe ser un entero entre 1 y ${MAX_HOLD}`, "invalid");
  const i = frameIndexById(a, frameId);
  return { ...a, frames: a.frames.map((f, j) => (j === i ? { ...f, hold } : f)) };
}

export function setFps(a: Animation, fps: number): Animation {
  const r = FpsSchema.safeParse(fps);
  if (!r.success) throw new EngineError("FPS no válido", "invalid");
  return { ...a, fps: r.data };
}

/* ─────────── Trazos ─────────── */

function patchCell(a: Animation, frameId: string, layerId: string, fn: (s: readonly Stroke[]) => Stroke[]): Animation {
  const fi = frameIndexById(a, frameId);
  const frame = a.frames[fi]!;
  const next = fn(strokesOf(frame, layerId));
  const cells = { ...frame.cells };
  if (next.length === 0) delete cells[layerId];
  else cells[layerId] = next;
  return { ...a, frames: a.frames.map((f, j) => (j === fi ? { ...f, cells } : f)) };
}

export function addStroke(a: Animation, frameId: string, layerId: string, stroke: Stroke): Animation {
  assertEditable(a, layerId);
  return patchCell(a, frameId, layerId, (s) => [...s, stroke]);
}

export function removeStrokes(a: Animation, frameId: string, layerId: string, ids: ReadonlySet<string>): Animation {
  assertEditable(a, layerId);
  return patchCell(a, frameId, layerId, (s) => s.filter((x) => !ids.has(x.id)));
}

/** Sustituye trazos (por id) conservando su posición en el orden de dibujo. */
export function replaceStrokes(a: Animation, frameId: string, layerId: string, replacements: ReadonlyMap<string, Stroke>): Animation {
  assertEditable(a, layerId);
  return patchCell(a, frameId, layerId, (s) => s.map((x) => replacements.get(x.id) ?? x));
}
