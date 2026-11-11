import type { Animation, Frame, Layer, Stroke } from "@gas/core";
import { longId, shortId, translation, transformStroke, scaleAbout, unionBounds, strokeBounds, type Matrix, type Rect } from "@gas/core";
import * as eng from "@gas/engine";
import { EngineError, History } from "@gas/engine";

export type Tool = "pen" | "eraser" | "select" | "hand";

export interface BrushSettings {
  size: number;
  opacity: number;
  /** Sensibilidad a la presión 0–1 */
  sens: number;
}

export interface Prefs {
  tool: Tool;
  color: string;
  recent: string[];
  pen: BrushSettings;
  eraser: BrushSettings;
  onion: { enabled: boolean; before: number; after: number };
  touchDraws: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  tool: "pen",
  color: "#111111",
  recent: [],
  pen: { size: 6, opacity: 1, sens: 0.7 },
  eraser: { size: 24, opacity: 1, sens: 0 },
  onion: { enabled: true, before: 1, after: 0 },
  touchDraws: true,
};

const PREFS_KEY = "gas.prefs.v1";

export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Partial<Prefs> | null;
    if (!raw || typeof raw !== "object") return structuredClone(DEFAULT_PREFS);
    return {
      ...structuredClone(DEFAULT_PREFS),
      ...raw,
      pen: { ...DEFAULT_PREFS.pen, ...raw.pen },
      eraser: { ...DEFAULT_PREFS.eraser, ...raw.eraser },
      onion: { ...DEFAULT_PREFS.onion, ...raw.onion },
    };
  } catch {
    return structuredClone(DEFAULT_PREFS);
  }
}

function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* almacenamiento no disponible: se sigue sin recordar preferencias */
  }
}

export interface Change {
  /** El documento cambió (trazos, capas, fotogramas…). */
  doc?: boolean;
  /** Cambió la UI: fotograma/capa activos, selección, herramienta, reproducción… */
  ui?: boolean;
}

/**
 * Estado del editor: documento (con historial), fotograma y capa activos, selección y preferencias.
 * Toda modificación del documento pasa por aquí. Los errores de reglas (capa bloqueada, límites…)
 * se convierten en avisos para el usuario, nunca en un fallo silencioso.
 */
export class EditorModel {
  readonly history: History<Animation>;
  frameId: string;
  layerId: string;
  selection = new Set<string>();
  playing = false;
  loop = true;
  prefs: Prefs;
  notice: (msg: string) => void = () => undefined;
  private listeners = new Set<(c: Change) => void>();
  private lastFrameIndex = 0;
  private lastLayerIndex = 0;

  constructor(doc: Animation, prefs: Prefs) {
    this.history = new History(doc, 500);
    this.prefs = prefs;
    this.frameId = doc.frames[0]!.id;
    this.layerId = doc.layers[doc.layers.length - 1]!.id; // la capa superior
  }

  /* ───── lectura ───── */
  get doc(): Animation {
    return this.history.present;
  }
  get frameIndex(): number {
    const i = this.doc.frames.findIndex((f) => f.id === this.frameId);
    return i < 0 ? 0 : i;
  }
  get frame(): Frame {
    return this.doc.frames[this.frameIndex]!;
  }
  get layer(): Layer {
    return this.doc.layers.find((l) => l.id === this.layerId) ?? this.doc.layers[this.doc.layers.length - 1]!;
  }
  get brush(): BrushSettings {
    return this.prefs.tool === "eraser" ? this.prefs.eraser : this.prefs.pen;
  }
  currentStrokes(): readonly Stroke[] {
    return eng.strokesOf(this.frame, this.layerId);
  }
  selectedStrokes(): Stroke[] {
    return this.currentStrokes().filter((s) => this.selection.has(s.id));
  }
  selectionBounds(): Rect | null {
    return unionBounds(this.selectedStrokes().map(strokeBounds));
  }

  /* ───── suscripción ───── */
  subscribe(fn: (c: Change) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(c: Change): void {
    for (const l of [...this.listeners]) l(c);
  }

  /** Ejecuta una acción de edición; si las reglas del motor la rechazan, avisa al usuario. */
  guard<T>(fn: () => T): T | undefined {
    try {
      return fn();
    } catch (e) {
      if (e instanceof EngineError) {
        this.notice(e.message);
        return undefined;
      }
      throw e;
    }
  }

  /** Mantiene fotograma/capa activos válidos tras un cambio (p. ej. un deshacer que elimina el fotograma actual). */
  private sanitize(): void {
    const d = this.doc;
    let fi = d.frames.findIndex((f) => f.id === this.frameId);
    if (fi < 0) {
      fi = Math.min(this.lastFrameIndex, d.frames.length - 1);
      this.frameId = d.frames[fi]!.id;
    }
    this.lastFrameIndex = fi;
    let li = d.layers.findIndex((l) => l.id === this.layerId);
    if (li < 0) {
      li = Math.min(this.lastLayerIndex, d.layers.length - 1);
      this.layerId = d.layers[li]!.id;
    }
    this.lastLayerIndex = li;
  }

  private commit(next: Animation, focus: { frameId?: string; layerId?: string } = {}, keepSelection = false): void {
    this.history.commit(next);
    if (focus.frameId) this.frameId = focus.frameId;
    if (focus.layerId) this.layerId = focus.layerId;
    if (!keepSelection) this.selection.clear();
    this.sanitize();
    this.emit({ doc: true, ui: true });
  }

  /* ───── historial ───── */
  /**
   * Tras deshacer/rehacer, lleva la vista al fotograma que cambió (p. ej. el que reaparece al deshacer
   * «eliminar»), salvo que el fotograma actual ya sea uno de los afectados.
   */
  private focusChanged(prev: Animation, next: Animation): void {
    const before = new Map(prev.frames.map((f) => [f.id, f]));
    const added = next.frames.find((f) => !before.has(f.id));
    if (added) {
      this.frameId = added.id;
      return;
    }
    const changed = next.frames.filter((f) => before.get(f.id) !== f);
    if (changed.length > 0 && !changed.some((f) => f.id === this.frameId)) this.frameId = changed[0]!.id;
  }

  private stepHistory(fn: () => boolean): void {
    if (this.playing) return;
    const prev = this.doc;
    if (!fn()) return;
    this.focusChanged(prev, this.doc);
    this.selection.clear();
    this.sanitize();
    this.emit({ doc: true, ui: true });
  }
  undo(): void {
    this.stepHistory(() => this.history.undo());
  }
  redo(): void {
    this.stepHistory(() => this.history.redo());
  }
  /** Sustituye el documento completo (recuperación de borrador) sin registrar historial. */
  replaceDoc(doc: Animation): void {
    this.history.silentReplace(doc);
    this.history.version++;
    this.selection.clear();
    this.sanitize();
    this.emit({ doc: true, ui: true });
  }

  /* ───── navegación ───── */
  setFrameIndex(i: number): void {
    const f = this.doc.frames[Math.min(Math.max(i, 0), this.doc.frames.length - 1)]!;
    if (f.id === this.frameId) return;
    this.frameId = f.id;
    this.lastFrameIndex = this.frameIndex;
    this.selection.clear();
    this.emit({ ui: true });
  }
  setLayer(id: string): void {
    if (id === this.layerId || !this.doc.layers.some((l) => l.id === id)) return;
    this.layerId = id;
    this.lastLayerIndex = this.doc.layers.findIndex((l) => l.id === id);
    this.selection.clear();
    this.emit({ ui: true });
  }
  setTool(t: Tool): void {
    if (this.prefs.tool === t) return;
    this.prefs.tool = t;
    if (t !== "select") this.selection.clear();
    savePrefs(this.prefs);
    this.emit({ ui: true });
  }
  updatePrefs(fn: (p: Prefs) => void): void {
    fn(this.prefs);
    savePrefs(this.prefs);
    this.emit({ ui: true });
  }
  rememberColor(hex: string): void {
    const c = hex.toLowerCase();
    this.prefs.recent = [c, ...this.prefs.recent.filter((x) => x !== c)].slice(0, 10);
    savePrefs(this.prefs);
  }

  /* ───── fotogramas ───── */
  addFrame(): void {
    this.guard(() => {
      const r = eng.addFrame(this.doc, this.frameIndex);
      this.commit(r.doc, { frameId: r.frameId });
    });
  }
  duplicateFrame(): void {
    this.guard(() => {
      const r = eng.duplicateFrame(this.doc, this.frameIndex);
      this.commit(r.doc, { frameId: r.frameId });
    });
  }
  deleteFrame(): void {
    this.guard(() => {
      const i = this.frameIndex;
      const next = eng.deleteFrame(this.doc, i);
      this.lastFrameIndex = Math.min(i, next.frames.length - 1);
      this.commit(next, { frameId: next.frames[this.lastFrameIndex]!.id });
    });
  }
  setHold(hold: number): void {
    this.guard(() => this.commit(eng.setHold(this.doc, this.frameId, hold), {}, true));
  }
  setFps(fps: number): void {
    this.guard(() => this.commit(eng.setFps(this.doc, fps), {}, true));
  }

  /* ───── capas ───── */
  addLayer(): void {
    this.guard(() => {
      const r = eng.addLayer(this.doc, undefined, this.layerId);
      this.commit(r.doc, { layerId: r.layerId });
    });
  }
  removeLayer(id: string): void {
    this.guard(() => this.commit(eng.removeLayer(this.doc, id)));
  }
  renameLayer(id: string, name: string): void {
    this.guard(() => this.commit(eng.renameLayer(this.doc, id, name), {}, true));
  }
  toggleVisible(id: string): void {
    const l = this.doc.layers.find((x) => x.id === id);
    if (l) this.guard(() => this.commit(eng.setLayerVisible(this.doc, id, !l.visible), {}, true));
  }
  toggleLocked(id: string): void {
    const l = this.doc.layers.find((x) => x.id === id);
    if (l) this.guard(() => this.commit(eng.setLayerLocked(this.doc, id, !l.locked), {}, true));
  }
  moveLayer(id: string, delta: 1 | -1): void {
    this.guard(() => this.commit(eng.moveLayer(this.doc, id, delta), {}, true));
  }

  /* ───── trazos ───── */
  /** ¿Se puede dibujar ahora? Si no, avisa (capa oculta o bloqueada). */
  canDraw(): boolean {
    return this.guard(() => (eng.assertEditable(this.doc, this.layerId), true)) === true;
  }
  commitStroke(stroke: Stroke): void {
    this.guard(() => this.commit(eng.addStroke(this.doc, this.frameId, this.layerId, stroke), {}, true));
  }

  /* ───── selección ───── */
  setSelection(ids: Iterable<string>): void {
    this.selection = new Set(ids);
    this.emit({ ui: true });
  }
  selectAll(): void {
    this.setSelection(this.currentStrokes().filter((s) => s.kind === "pen").map((s) => s.id));
  }
  deleteSelection(): void {
    if (this.selection.size === 0) return;
    this.guard(() => {
      this.commit(eng.removeStrokes(this.doc, this.frameId, this.layerId, this.selection));
    });
  }
  duplicateSelection(offset = 24): void {
    const sel = this.selectedStrokes();
    if (sel.length === 0) return;
    this.guard(() => {
      let d = this.doc;
      const ids: string[] = [];
      for (const s of sel) {
        const copy = { ...transformStroke(s, translation(offset, offset)), id: shortId() };
        ids.push(copy.id);
        d = eng.addStroke(d, this.frameId, this.layerId, copy);
      }
      this.commit(d);
      this.selection = new Set(ids);
      this.emit({ ui: true });
    });
  }
  flipSelection(): void {
    const b = this.selectionBounds();
    if (!b) return;
    this.applyMatrixToSelection(scaleAbout(-1, 1, b.x + b.w / 2, b.y + b.h / 2));
  }
  private applyMatrixToSelection(m: Matrix): void {
    const sel = this.selectedStrokes();
    this.guard(() => {
      const map = new Map(sel.map((s) => [s.id, transformStroke(s, m)]));
      const keep = new Set(this.selection);
      this.commit(eng.replaceStrokes(this.doc, this.frameId, this.layerId, map), {}, true);
      this.selection = keep;
      this.emit({ ui: true });
    });
  }

  /** Arrastre continuo: previsualiza sin llenar el historial; `endTransform` deja UNA sola entrada. */
  beginTransform(): void {
    if (!this.history.inTransient) this.history.beginTransient();
  }
  previewTransform(base: readonly Stroke[], m: Matrix): void {
    if (!this.history.inTransient) return;
    const map = new Map(base.map((s) => [s.id, transformStroke(s, m)]));
    this.guard(() => {
      this.history.setTransient(eng.replaceStrokes(this.doc, this.frameId, this.layerId, map));
      this.emit({ doc: true });
    });
  }
  endTransform(): void {
    if (!this.history.inTransient) return;
    this.history.commitTransient();
    this.emit({ doc: true, ui: true });
  }
  cancelTransform(): void {
    if (!this.history.inTransient) return;
    this.history.cancelTransient();
    this.emit({ doc: true, ui: true });
  }
}

export { longId };
