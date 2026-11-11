import type { Animation, Binding, Bone, BonePose, Ease, Frame, Layer, PoseKey, Skeleton, Stroke } from "@gas/core";
import { longId, shortId, translation, transformStroke, scaleAbout, unionBounds, strokeBounds, type Matrix, type Rect } from "@gas/core";
import * as eng from "@gas/engine";
import type { ResolvedPose, SkeletonState } from "@gas/engine";
import { EngineError, History } from "@gas/engine";

export type Tool = "pen" | "eraser" | "select" | "hand" | "rig";

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

/** Estado de la interfaz del rig (no se guarda en el proyecto). */
export interface RigUi {
  skeletonId: string | null;
  /** edit = se edita el esqueleto de REPOSO (y el dibujo se ve sin deformar). pose = se mueven los huesos y se ve la deformación. */
  mode: "edit" | "pose";
  boneId: string | null;
  show: boolean;
  weights: boolean;
  /** En modo pose, ver y dibujar el arte sin deformar (necesario para retocar capas vinculadas). */
  restView: boolean;
  /** Edición: el siguiente arrastre sobre el lienzo dibuja un hueso nuevo. */
  create: boolean;
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
  rig: RigUi = { skeletonId: null, mode: "pose", boneId: null, show: true, weights: false, restView: false, create: false };
  /** Portapapeles de poses (copiar/pegar entre fotogramas). */
  poseClipboard: PoseKey | null = null;
  notice: (msg: string) => void = () => undefined;
  private listeners = new Set<(c: Change) => void>();
  private lastFrameIndex = 0;
  private lastLayerIndex = 0;

  constructor(doc: Animation, prefs: Prefs) {
    this.history = new History(doc, 500);
    this.prefs = prefs;
    this.frameId = doc.frames[0]!.id;
    this.layerId = doc.layers[doc.layers.length - 1]!.id; // la capa superior
    this.rig.skeletonId = doc.rigs?.[0]?.id ?? null;
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
  /* ───── rig: lectura ───── */
  get skeleton(): Skeleton | null {
    return this.doc.rigs?.find((r) => r.id === this.rig.skeletonId) ?? null;
  }
  get bone(): Bone | null {
    return this.skeleton?.bones.find((b) => b.id === this.rig.boneId) ?? null;
  }
  /** ¿Se ve el arte sin deformar? (editando el esqueleto, o con «ver sin deformar»). */
  get showRest(): boolean {
    return this.rig.mode === "edit" || this.rig.restView;
  }
  /** El fotograma tal como se DIBUJA: con el rig aplicado, salvo en vista de reposo. Misma función que usa la exportación. */
  renderedFrame(index: number = this.frameIndex): Frame {
    const d = this.doc;
    return !this.showRest && eng.hasRig(d) ? eng.posedFrame(d, index) : d.frames[index]!;
  }
  /** Geometría de los huesos del esqueleto activo en el fotograma actual: de reposo (editar) o con la pose (pose). */
  rigStates(): { sk: Skeleton; states: SkeletonState; pose: ResolvedPose } | null {
    const sk = this.skeleton;
    if (!sk) return null;
    const pose = eng.resolvePose(this.doc.frames, sk, this.frameIndex);
    return { sk, pose, states: this.rig.mode === "edit" ? eng.restStates(sk) : eng.poseStates(sk, pose) };
  }
  /** ¿La capa activa está vinculada a un esqueleto? */
  get layerBinding() {
    return eng.bindingOfLayer(this.doc, this.layerId);
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
    // La interfaz del rig no puede apuntar a algo que ya no existe (p. ej. tras deshacer).
    const rigs = d.rigs ?? [];
    if (!rigs.some((r) => r.id === this.rig.skeletonId)) {
      this.rig.skeletonId = rigs[0]?.id ?? null;
      this.rig.boneId = null;
    } else if (this.rig.boneId && !this.skeleton!.bones.some((b) => b.id === this.rig.boneId)) this.rig.boneId = null;
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
    if (this.guard(() => (eng.assertEditable(this.doc, this.layerId), true)) !== true) return false;
    // Las capas vinculadas se dibujan SIN deformar: lo dibujado en una pose caería en el sitio equivocado del reposo.
    if (this.layerBinding && !this.showRest) {
      this.notice("Esta capa está vinculada a un esqueleto. Para dibujarla activa «Ver sin deformar» (o el modo Editar esqueleto).");
      return false;
    }
    return true;
  }
  commitStroke(stroke: Stroke): void {
    this.guard(() => this.commit(eng.addStroke(this.doc, this.frameId, this.layerId, stroke), {}, true));
  }

  /* ───── rig: acciones ───── */
  private rigBase: Animation | null = null;

  /** Vista previa continua (arrastre, deslizador): se ve al instante y al terminar queda UNA sola entrada de historial. */
  rigLive(fn: (base: Animation) => Animation): void {
    if (!this.history.inTransient) {
      this.history.beginTransient();
      this.rigBase = this.doc;
    }
    this.guard(() => this.history.setTransient(fn(this.rigBase!)));
    this.emit({ doc: true });
  }
  rigEnd(): void {
    if (!this.history.inTransient || this.rigBase === null) return;
    this.rigBase = null;
    this.history.commitTransient();
    this.sanitize();
    this.emit({ doc: true, ui: true });
  }
  rigCancel(): void {
    if (!this.history.inTransient || this.rigBase === null) return;
    this.rigBase = null;
    this.history.cancelTransient();
    this.emit({ doc: true, ui: true });
  }
  private rigDo(fn: (d: Animation) => Animation): void {
    this.guard(() => this.commit(fn(this.doc), {}, true));
  }

  setRigMode(mode: RigUi["mode"]): void {
    this.rig.mode = mode;
    this.rig.create = false;
    this.emit({ ui: true });
  }
  toggleRig(key: "show" | "weights" | "restView"): void {
    this.rig[key] = !this.rig[key];
    this.emit({ ui: true });
  }
  setCreate(on: boolean): void {
    this.rig.create = on;
    if (on) this.rig.mode = "edit";
    this.emit({ ui: true });
  }
  selectSkeleton(id: string): void {
    this.rig.skeletonId = id;
    this.rig.boneId = null;
    this.emit({ ui: true });
  }
  selectBone(id: string | null): void {
    this.rig.boneId = id;
    this.emit({ ui: true });
  }

  createSkeleton(): void {
    this.guard(() => {
      const r = eng.createSkeleton(this.doc);
      this.commit(r.doc, {}, true);
      this.rig.skeletonId = r.skeletonId;
      this.rig.boneId = null;
      this.rig.mode = "edit";
      this.rig.create = true; // el primer arrastre dibuja el primer hueso
      this.emit({ ui: true });
    });
  }
  createHumanoid(): void {
    this.guard(() => {
      const d = this.doc;
      const r = eng.createHumanoid(d, d.width / 2, d.height * 0.93, d.height * 0.78);
      this.commit(r.doc, {}, true);
      this.rig.skeletonId = r.skeletonId;
      this.rig.boneId = null;
      this.rig.mode = "edit";
      this.rig.create = false;
      this.emit({ ui: true });
    });
  }
  renameSkeleton(name: string): void {
    if (this.skeleton) this.rigDo((d) => eng.renameSkeleton(d, this.skeleton!.id, name));
  }
  removeSkeleton(): void {
    if (!this.skeleton) return;
    this.rigDo((d) => eng.removeSkeleton(d, this.skeleton!.id));
    this.sanitize();
    this.emit({ ui: true });
  }

  /** Añade un hueso (cabeza y cola en el lienzo, en reposo) y lo selecciona. */
  addBone(spec: eng.NewBone): string | null {
    const sk = this.skeleton;
    if (!sk) return null;
    return (
      this.guard(() => {
        const r = eng.addBone(this.doc, sk.id, spec);
        this.commit(r.doc, {}, true);
        this.rig.boneId = r.boneId;
        this.emit({ ui: true });
        return r.boneId;
      }) ?? null
    );
  }
  addChildBone(): void {
    const sk = this.skeleton;
    const b = this.bone;
    if (!sk) return;
    if (!b) {
      this.notice("Selecciona primero el hueso padre (o pulsa «Dibujar hueso» y arrastra en el lienzo).");
      return;
    }
    this.guard(() => {
      const r = eng.addChildBone(this.doc, sk.id, b.id);
      this.commit(r.doc, {}, true);
      this.rig.boneId = r.boneId;
      this.rig.mode = "edit";
      this.emit({ ui: true });
    });
  }
  removeSelectedBone(): void {
    const sk = this.skeleton;
    const b = this.bone;
    if (!sk || !b) return;
    this.guard(() => {
      const r = eng.removeBone(this.doc, sk.id, b.id);
      this.commit(r.doc, {}, true);
      this.rig.boneId = null;
      this.emit({ ui: true });
      if (r.removed.length > 1) this.notice(`Se eliminaron ${r.removed.length} huesos (el hueso y sus descendientes).`);
    });
  }
  updateBone(patch: eng.BonePatch): void {
    const sk = this.skeleton;
    const b = this.bone;
    if (sk && b) this.rigDo((d) => eng.updateBone(d, sk.id, b.id, patch));
  }
  reparentBone(parent: string | null): void {
    const sk = this.skeleton;
    const b = this.bone;
    if (sk && b) this.rigDo((d) => eng.reparentBone(d, sk.id, b.id, parent));
  }
  setBinding(layerId: string, binding: Omit<Binding, "layerId"> | null): void {
    const sk = this.skeleton;
    if (sk) this.rigDo((d) => eng.setBinding(d, sk.id, layerId, binding));
  }

  /** Giro/desplazamiento de un hueso en el fotograma actual (crea el keyframe si no existía). Continuo: usar con rigEnd. */
  poseBoneLive(boneId: string, value: BonePose): void {
    const sk = this.skeleton;
    if (!sk) return;
    const i = this.frameIndex;
    this.rigLive((b) => eng.setBonePose(b, i, sk.id, boneId, value));
  }
  moveBoneHeadLive(boneId: string, head: [number, number]): void {
    const sk = this.skeleton;
    if (sk) this.rigLive((b) => eng.moveBoneHead(b, sk.id, boneId, head));
  }
  setBoneTailLive(boneId: string, tail: [number, number]): void {
    const sk = this.skeleton;
    if (sk) this.rigLive((b) => eng.setBoneTail(b, sk.id, boneId, tail));
  }

  get hasKeyHere(): boolean {
    return !!this.skeleton && eng.hasKey(this.doc, this.frameIndex, this.skeleton.id);
  }
  get keyFrameList(): number[] {
    return this.skeleton ? eng.keyFrames(this.doc, this.skeleton.id) : [];
  }
  /** Convierte la pose que se ve ahora (quizá interpolada) en un keyframe de este fotograma. */
  saveKey(): void {
    const sk = this.skeleton;
    if (!sk) return;
    const i = this.frameIndex;
    this.rigDo((d) => eng.copyPose(d, i, i, sk.id));
  }
  deleteKey(): void {
    const sk = this.skeleton;
    if (!sk) return;
    if (!this.hasKeyHere) return this.notice("Este fotograma no tiene keyframe.");
    const i = this.frameIndex;
    this.rigDo((d) => eng.setPose(d, i, sk.id, null));
  }
  /** Copia la pose de este fotograma al siguiente como keyframe. */
  duplicateKeyToNext(): void {
    const sk = this.skeleton;
    if (!sk) return;
    const i = this.frameIndex;
    if (i + 1 >= this.doc.frames.length) return this.notice("No hay un fotograma siguiente: crea uno con «Nuevo».");
    this.guard(() => {
      this.commit(eng.copyPose(this.doc, i, i + 1, sk.id), {}, true);
      this.setFrameIndex(i + 1);
    });
  }
  copyPoseToClipboard(): void {
    const sk = this.skeleton;
    if (!sk) return;
    const pose = eng.resolvePose(this.doc.frames, sk, this.frameIndex);
    this.poseClipboard = eng.poseToKey(pose, sk, this.doc.frames[this.frameIndex]?.poses?.[sk.id]?.ease ?? "linear");
    this.notice("Pose copiada.");
    this.emit({ ui: true });
  }
  pastePoseFromClipboard(): void {
    const sk = this.skeleton;
    if (!sk) return;
    const clip = this.poseClipboard;
    if (!clip) return this.notice("No hay ninguna pose copiada.");
    const i = this.frameIndex;
    this.rigDo((d) => eng.pastePose(d, i, sk.id, clip));
  }
  resetPose(): void {
    const sk = this.skeleton;
    if (!sk) return;
    const i = this.frameIndex;
    this.rigDo((d) => eng.resetPose(d, i, sk.id));
  }
  setKeyEase(ease: Ease): void {
    const sk = this.skeleton;
    if (!sk) return;
    const i = this.frameIndex;
    this.rigDo((d) => eng.setKeyEase(d, i, sk.id, ease));
  }
  gotoKey(dir: -1 | 1): void {
    const keys = this.keyFrameList;
    const i = this.frameIndex;
    const t = dir < 0 ? [...keys].reverse().find((k) => k < i) : keys.find((k) => k > i);
    if (t === undefined) return this.notice(dir < 0 ? "No hay un keyframe anterior." : "No hay un keyframe siguiente.");
    this.setFrameIndex(t);
  }

  /** Separa las partes de un personaje: mueve la selección a otra capa. */
  moveSelectionToLayer(target: string): void {
    if (this.selection.size === 0) return;
    const ids = new Set(this.selection);
    this.guard(() => {
      this.commit(eng.moveStrokes(this.doc, this.frameId, this.layerId, target, ids), {}, true);
      this.selection.clear();
      this.layerId = target;
      this.emit({ ui: true });
    });
  }
  /** Copia el dibujo de las capas vinculadas del fotograma actual a TODOS los fotogramas. */
  syncRigLayers(): void {
    const sk = this.skeleton;
    if (!sk) return;
    const ids = sk.bindings.map((b) => b.layerId);
    if (ids.length === 0) return this.notice("Aún no hay capas vinculadas a este esqueleto.");
    this.rigDo((d) => eng.syncLayers(d, this.frameId, ids));
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
