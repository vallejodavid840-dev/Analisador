import { hitStroke, rectsIntersect, rotateAbout, scaleAbout, shortId, strokeBounds, translation, type Matrix, type Rect, type Stroke } from "@gas/core";
import { anchorFor, handlesFor, type HandleId } from "./handles";
import type { EditorModel } from "./model";
import { RigPointer } from "./rig-input";
import type { Viewport } from "./viewport";

type Mode =
  | { kind: "none" }
  /** Tras un gesto de dos dedos: se ignoran los dedos restantes hasta que se levanten todos. */
  | { kind: "ignore" }
  | { kind: "draw"; id: number; draft: Stroke; before: readonly Stroke[]; lastP: number }
  | { kind: "pan"; id: number; x: number; y: number }
  | { kind: "gesture"; midX: number; midY: number; dist: number }
  | { kind: "xform"; id: number; handle: HandleId | "move"; base: Stroke[]; bounds: Rect; start: [number, number] }
  | { kind: "rig"; id: number }
  | { kind: "marquee"; id: number; start: [number, number]; startScreen: [number, number]; additive: boolean };

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

export class InputController {
  private pointers = new Map<number, { x: number; y: number; type: string }>();
  private mode: Mode = { kind: "none" };
  private readonly cursor: HTMLElement;
  private readonly cleanup: Array<() => void> = [];
  private readonly rig: RigPointer;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly model: EditorModel,
    private readonly vp: Viewport,
    private readonly pausePlayback: () => void,
  ) {
    this.cursor = document.createElement("div");
    this.cursor.className = "brush-cursor";
    this.cursor.hidden = true;
    canvas.parentElement!.append(this.cursor);
    this.rig = new RigPointer(model, vp);
    const on = <K extends keyof HTMLElementEventMap>(t: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      canvas.addEventListener(t, fn as EventListener, opts);
      this.cleanup.push(() => canvas.removeEventListener(t, fn as EventListener));
    };
    on("pointerdown", (e) => this.down(e));
    on("pointermove", (e) => this.move(e));
    on("pointerup", (e) => this.up(e));
    on("pointercancel", (e) => this.up(e, true));
    on("pointerleave", () => (this.cursor.hidden = true));
    on("wheel", (e) => this.wheel(e), { passive: false });
    on("contextmenu", (e) => e.preventDefault());
  }

  dispose(): void {
    this.cleanup.forEach((f) => f());
    this.cursor.remove();
  }

  /** Hay una operación en curso: no es seguro guardar ni cambiar el documento por otra vía. */
  get busy(): boolean {
    return this.mode.kind === "draw" || this.mode.kind === "rig" || this.mode.kind === "xform" || this.mode.kind === "marquee" || this.mode.kind === "gesture";
  }

  /** Cancela cualquier operación en curso (p. ej. al deshacer o cambiar de herramienta). */
  cancel(): void {
    if (this.mode.kind === "draw") this.vp.cancelLive();
    if (this.mode.kind === "xform") this.model.cancelTransform();
    if (this.mode.kind === "rig") this.rig.cancel();
    this.vp.marquee = null;
    this.mode = { kind: "none" };
  }

  /* ───────────── eventos ───────────── */
  private down(e: PointerEvent): void {
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    if (this.model.playing) {
      this.pausePlayback();
      return;
    }
    // Rechazo de palma: con el lápiz apoyado se ignoran los dedos.
    if (e.pointerType === "touch" && [...this.pointers.values()].some((p) => p.type === "pen")) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* el puntero ya terminó */
    }

    const touches = [...this.pointers.values()].filter((p) => p.type === "touch");
    if (e.pointerType === "touch" && touches.length === 2) {
      this.cancel();
      const a = touches[0]!;
      const b = touches[1]!;
      this.mode = { kind: "gesture", midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
      return;
    }
    if (this.mode.kind !== "none") return;

    const tool = this.model.prefs.tool;
    const panning = e.button === 1 || tool === "hand" || e.altKey || (e.pointerType === "touch" && !this.model.prefs.touchDraws);
    if (panning) {
      this.mode = { kind: "pan", id: e.pointerId, x: e.clientX, y: e.clientY };
      return;
    }
    if (tool === "pen" || tool === "eraser") this.startStroke(e);
    else if (tool === "select") this.startSelect(e);
    else if (tool === "rig") {
      const w = this.vp.toWorld(e.clientX, e.clientY);
      if (this.rig.down(w, e.pointerType === "touch")) this.mode = { kind: "rig", id: e.pointerId };
    }
  }

  private move(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (e.pointerType !== "touch") this.updateCursor(e);
    if (!p) return;
    const m = this.mode;
    if (m.kind === "gesture") {
      p.x = e.clientX;
      p.y = e.clientY;
      const t = [...this.pointers.values()].filter((q) => q.type === "touch");
      if (t.length < 2) return;
      const a = t[0]!;
      const b = t[1]!;
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const r = this.canvas.getBoundingClientRect();
      this.vp.panBy(midX - m.midX, midY - m.midY);
      this.vp.zoomAt(dist / m.dist, midX - r.left, midY - r.top);
      this.mode = { kind: "gesture", midX, midY, dist };
      return;
    }
    p.x = e.clientX;
    p.y = e.clientY;
    if (m.kind === "pan" && m.id === e.pointerId) {
      this.vp.panBy(e.clientX - m.x, e.clientY - m.y);
      m.x = e.clientX;
      m.y = e.clientY;
    } else if (m.kind === "draw" && m.id === e.pointerId) {
      const evs = e.getCoalescedEvents?.();
      for (const ce of evs && evs.length ? evs : [e]) this.addPoint(m, ce);
    } else if (m.kind === "rig" && m.id === e.pointerId) {
      this.rig.move(this.vp.toWorld(e.clientX, e.clientY));
    } else if (m.kind === "xform" && m.id === e.pointerId) {
      this.dragTransform(m, e);
    } else if (m.kind === "marquee" && m.id === e.pointerId) {
      const [wx, wy] = this.vp.toWorld(e.clientX, e.clientY);
      this.vp.marquee = normRect(m.start, [wx, wy]);
      this.vp.requestRender();
    }
  }

  private up(e: PointerEvent, cancelled = false): void {
    this.pointers.delete(e.pointerId);
    const m = this.mode;
    if (m.kind === "gesture") {
      if ([...this.pointers.values()].filter((q) => q.type === "touch").length < 2) {
        this.mode = this.pointers.size > 0 ? { kind: "ignore" } : { kind: "none" };
      }
      return;
    }
    if (m.kind === "ignore") {
      if (this.pointers.size === 0) this.mode = { kind: "none" };
      return;
    }
    if ("id" in m && m.id !== e.pointerId) return;
    if (m.kind === "draw") {
      if (cancelled) this.vp.cancelLive();
      else this.finishStroke(m);
    } else if (m.kind === "rig") {
      this.rig.up(cancelled);
    } else if (m.kind === "xform") {
      if (cancelled) this.model.cancelTransform();
      else this.model.endTransform();
    } else if (m.kind === "marquee") {
      this.finishMarquee(m, e, cancelled);
    }
    this.mode = { kind: "none" };
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const k = e.ctrlKey ? 0.01 : 0.0016;
    this.vp.zoomAt(Math.exp(-e.deltaY * k), e.clientX - r.left, e.clientY - r.top);
  }

  private updateCursor(e: PointerEvent): void {
    const tool = this.model.prefs.tool;
    if ((tool !== "pen" && tool !== "eraser") || this.model.playing) {
      this.cursor.hidden = true;
      return;
    }
    const r = this.canvas.getBoundingClientRect();
    const d = Math.max(4, this.model.brush.size * this.vp.view.zoom);
    this.cursor.hidden = false;
    this.cursor.style.width = this.cursor.style.height = `${d}px`;
    this.cursor.style.transform = `translate(${e.clientX - r.left - d / 2}px, ${e.clientY - r.top - d / 2}px)`;
  }

  /* ───────────── dibujo ───────────── */
  private startStroke(e: PointerEvent): void {
    if (!this.model.canDraw()) return;
    const [x, y] = this.vp.toWorld(e.clientX, e.clientY);
    const b = this.model.brush;
    const pressure = e.pointerType === "pen" ? (e.pressure > 0 ? e.pressure : 0.5) : 1;
    const eraser = this.model.prefs.tool === "eraser";
    const draft: Stroke = {
      id: shortId(),
      kind: eraser ? "eraser" : "pen",
      color: this.model.prefs.color,
      size: b.size,
      opacity: b.opacity,
      sens: b.sens,
      points: [r1(x), r1(y), r2(pressure)],
    };
    this.mode = { kind: "draw", id: e.pointerId, draft, before: this.model.currentStrokes(), lastP: pressure };
    this.vp.beginLive(draft);
  }

  private addPoint(m: Extract<Mode, { kind: "draw" }>, e: PointerEvent): void {
    const pts = m.draft.points;
    const [x, y] = this.vp.toWorld(e.clientX, e.clientY);
    const lx = pts[pts.length - 3]!;
    const ly = pts[pts.length - 2]!;
    if (Math.hypot(x - lx, y - ly) < 0.6) return;
    let p = 1;
    if (e.pointerType === "pen") {
      const raw = e.pressure > 0 ? e.pressure : m.lastP;
      p = m.lastP * 0.35 + raw * 0.65; // suaviza el ruido del sensor
      m.lastP = p;
    }
    pts.push(r1(x), r1(y), r2(p));
    this.vp.liveUpdate();
  }

  private finishStroke(m: Extract<Mode, { kind: "draw" }>): void {
    this.vp.liveFinish();
    const stroke: Stroke = { ...m.draft, points: [...m.draft.points] };
    const before = this.model.currentStrokes();
    this.model.commitStroke(stroke);
    const after = this.model.currentStrokes();
    if (after !== before) this.vp.bakeLive(before, after);
    else this.vp.cancelLive();
    if (stroke.kind === "pen") this.model.rememberColor(stroke.color);
  }

  /* ───────────── selección ───────────── */
  private startSelect(e: PointerEvent): void {
    const [x, y] = this.vp.toWorld(e.clientX, e.clientY);
    const zoom = this.vp.view.zoom;
    const touch = e.pointerType === "touch";
    const bounds = this.model.selection.size ? this.model.selectionBounds() : null;

    if (bounds) {
      const r = (touch ? 26 : 12) / zoom;
      const h = handlesFor(bounds, zoom).find((q) => Math.hypot(x - q.x, y - q.y) <= r);
      if (h) return this.beginXform(e, h.id, bounds, [x, y]);
      if (x >= bounds.x && x <= bounds.x + bounds.w && y >= bounds.y && y <= bounds.y + bounds.h) {
        return this.beginXform(e, "move", bounds, [x, y]);
      }
    }
    const tol = (touch ? 14 : 5) / zoom;
    const strokes = this.model.currentStrokes();
    let hit: Stroke | undefined;
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i]!;
      if (s.kind === "pen" && hitStroke(s, x, y, tol)) {
        hit = s;
        break;
      }
    }
    if (hit) {
      const ids = new Set(this.model.selection);
      if (e.shiftKey) {
        if (ids.has(hit.id)) ids.delete(hit.id);
        else ids.add(hit.id);
      } else if (!ids.has(hit.id)) {
        ids.clear();
        ids.add(hit.id);
      }
      this.model.setSelection(ids);
      const nb = this.model.selectionBounds();
      if (nb && ids.has(hit.id)) this.beginXform(e, "move", nb, [x, y]);
      return;
    }
    if (!e.shiftKey) this.model.setSelection([]);
    this.mode = { kind: "marquee", id: e.pointerId, start: [x, y], startScreen: [e.clientX, e.clientY], additive: e.shiftKey };
  }

  private beginXform(e: PointerEvent, handle: HandleId | "move", bounds: Rect, start: [number, number]): void {
    if (!this.model.canDraw()) return; // capa bloqueada u oculta: se avisa y no se transforma
    this.model.beginTransform();
    this.mode = { kind: "xform", id: e.pointerId, handle, base: this.model.selectedStrokes(), bounds, start };
  }

  private dragTransform(m: Extract<Mode, { kind: "xform" }>, e: PointerEvent): void {
    const [x, y] = this.vp.toWorld(e.clientX, e.clientY);
    const b = m.bounds;
    let mat: Matrix;
    if (m.handle === "move") {
      mat = translation(x - m.start[0], y - m.start[1]);
    } else if (m.handle === "rotate") {
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      let ang = Math.atan2(y - cy, x - cx) - Math.atan2(m.start[1] - cy, m.start[0] - cx);
      if (e.shiftKey) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
      mat = rotateAbout(ang, cx, cy);
    } else {
      const a = anchorFor(b, m.handle);
      const h = handlesFor(b, 1).find((q) => q.id === m.handle)!;
      const dx = h.x - a.x;
      const dy = h.y - a.y;
      const MIN = 0.02;
      const sx = Math.abs(dx) > 1e-6 ? Math.max(MIN, (x - a.x) / dx) : 1;
      const sy = Math.abs(dy) > 1e-6 ? Math.max(MIN, (y - a.y) / dy) : 1;
      if (m.handle.length === 2) {
        // Esquina: escala uniforme proyectando sobre la diagonal
        const s = Math.max(MIN, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy));
        mat = scaleAbout(s, s, a.x, a.y);
      } else if (m.handle === "e" || m.handle === "w") mat = scaleAbout(sx, 1, a.x, a.y);
      else mat = scaleAbout(1, sy, a.x, a.y);
    }
    this.model.previewTransform(m.base, mat);
  }

  private finishMarquee(m: Extract<Mode, { kind: "marquee" }>, e: PointerEvent, cancelled: boolean): void {
    const rect = this.vp.marquee;
    this.vp.marquee = null;
    this.vp.requestRender();
    if (cancelled || !rect) return;
    const moved = Math.hypot(e.clientX - m.startScreen[0], e.clientY - m.startScreen[1]);
    if (moved < 4) return; // un toque en vacío solo deselecciona
    const ids = new Set(m.additive ? this.model.selection : []);
    for (const s of this.model.currentStrokes()) if (s.kind === "pen" && rectsIntersect(strokeBounds(s), rect)) ids.add(s.id);
    this.model.setSelection(ids);
  }
}

function normRect(a: [number, number], b: [number, number]): Rect {
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) };
}

