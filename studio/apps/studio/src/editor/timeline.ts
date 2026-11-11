import type { Frame, Stroke } from "@gas/core";
import { h } from "../dom";
import { es } from "../es";
import { frameImage } from "./cache";
import { icon } from "./icons";
import { iconBtn, setDisabled, setPressed, stepper } from "./ui";
import type { Change, EditorModel } from "./model";
import type { Player } from "./player";
import { FPS_PRESETS, MAX_HOLD } from "@gas/core";

const T = es.editor;
const THUMB_W = 88;

interface Cell {
  btn: HTMLButtonElement;
  canvas: HTMLCanvasElement;
  num: HTMLElement;
  hold: HTMLElement;
  frame: Frame | null;
  /** Fotograma dibujado en la miniatura (para saber si hay que redibujarla). */
  drawn: Frame | null;
}

export class Timeline {
  readonly el: HTMLElement;
  private cells = new Map<string, Cell>();
  private strip: HTMLElement;
  private pending = new Set<string>();
  private pumpTimer = 0;
  private lastActive = "";
  private readonly refs: Record<string, HTMLElement> = {};
  private onionSteppers: Array<{ el: HTMLElement; refresh: () => void }> = [];
  private holdStepper!: { el: HTMLElement; refresh: () => void };

  constructor(
    private readonly model: EditorModel,
    private readonly player: Player,
    private readonly peek: (strokes: readonly Stroke[]) => HTMLCanvasElement | null = () => null,
  ) {
    const m = model;
    const R = this.refs;

    R["first"] = iconBtn("first", T.first, () => m.setFrameIndex(0), { testid: "first" });
    R["prev"] = iconBtn("prev", T.prevFrame, () => m.setFrameIndex(m.frameIndex - 1), { testid: "prev" });
    R["play"] = iconBtn("play", T.play, () => player.toggle(), { testid: "play", cls: "primary" });
    R["next"] = iconBtn("next", T.nextFrame, () => m.setFrameIndex(m.frameIndex + 1), { testid: "next" });
    R["last"] = iconBtn("last", T.last, () => m.setFrameIndex(m.doc.frames.length - 1), { testid: "last" });
    R["loop"] = iconBtn("loop", T.loop, () => ((m.loop = !m.loop), m.emit({ ui: true })), { testid: "loop", pressed: m.loop });

    const fps = h("select", { "aria-label": T.fps, "data-testid": "fps", onchange: (e) => {
      m.setFps(Number((e.target as HTMLSelectElement).value));
      player.rebase();
    } });
    R["fps"] = fps;

    R["add"] = iconBtn("plus", T.addFrame, () => m.addFrame(), { testid: "add-frame", text: "Nuevo" });
    R["dup"] = iconBtn("dup", T.dupFrame, () => m.duplicateFrame(), { testid: "dup-frame", text: "Duplicar" });
    R["del"] = iconBtn("trash", T.delFrame, () => m.deleteFrame(), { testid: "del-frame", text: "Eliminar" });

    this.holdStepper = stepper({
      label: T.hold, min: 1, max: MAX_HOLD, testid: "hold",
      value: () => m.frame.hold, set: (n) => m.setHold(n), lessLabel: T.holdLess, moreLabel: T.holdMore,
    });
    this.holdStepper.el.title = T.holdHint;

    R["onion"] = iconBtn("onion", T.onion, () => m.updatePrefs((p) => (p.onion.enabled = !p.onion.enabled)), { testid: "onion", pressed: m.prefs.onion.enabled, text: T.onion });
    const before = stepper({ label: T.onionBefore, min: 0, max: 5, testid: "onion-before", value: () => m.prefs.onion.before, set: (n) => m.updatePrefs((p) => (p.onion.before = n)), lessLabel: `${T.onionBefore} −`, moreLabel: `${T.onionBefore} +` });
    const after = stepper({ label: T.onionAfter, min: 0, max: 5, testid: "onion-after", value: () => m.prefs.onion.after, set: (n) => m.updatePrefs((p) => (p.onion.after = n)), lessLabel: `${T.onionAfter} −`, moreLabel: `${T.onionAfter} +` });
    this.onionSteppers = [before, after];

    R["pos"] = h("span", { class: "tl-pos", "data-testid": "frame-pos", "aria-live": "polite" });

    this.strip = h("div", { class: "tl-strip", role: "listbox", "aria-label": "Fotogramas", "data-testid": "strip" });
    this.el = h(
      "section",
      { class: "timeline", "aria-label": "Línea de tiempo" },
      h("div", { class: "tl-controls" },
        h("div", { class: "tl-group transport" }, R["first"]!, R["prev"]!, R["play"]!, R["next"]!, R["last"]!, R["loop"]!),
        h("label", { class: "tl-fps" }, h("span", {}, T.fps), fps),
        h("div", { class: "tl-group" }, R["add"]!, R["dup"]!, R["del"]!),
        this.holdStepper.el,
        h("div", { class: "tl-group onion" }, R["onion"]!, before.el, after.el),
        R["pos"]!,
      ),
      this.strip,
    );
    this.update({ doc: true, ui: true });
  }

  private makeCell(): Cell {
    const doc = this.model.doc;
    const ch = Math.round((THUMB_W * doc.height) / doc.width);
    const canvas = h("canvas", { width: THUMB_W * 2, height: ch * 2, class: "thumb", "aria-hidden": "true" });
    canvas.style.width = `${THUMB_W}px`;
    canvas.style.height = `${ch}px`;
    const num = h("span", { class: "cell-num" });
    const hold = h("span", { class: "cell-hold" });
    const btn = h("button", { type: "button", class: "cell", role: "option", "data-testid": "frame-cell" }, canvas, num, hold);
    return { btn, canvas, num, hold, frame: null, drawn: null };
  }

  /** Redibuja las miniaturas pendientes por lotes pequeños para no bloquear el dibujo. */
  private pump(delay: number): void {
    if (this.pumpTimer) return;
    this.pumpTimer = window.setTimeout(() => {
      this.pumpTimer = 0;
      let n = 0;
      for (const id of this.pending) {
        this.pending.delete(id);
        const c = this.cells.get(id);
        if (c?.frame) this.paintThumb(c);
        if (++n >= 4) break;
      }
      if (this.pending.size) this.pump(16);
    }, delay);
  }

  private paintThumb(c: Cell): void {
    const doc = this.model.doc;
    const f = c.frame!;
    const img = frameImage(doc, f, { scale: (THUMB_W * 2) / doc.width, background: "#ffffff", layerSource: this.peek });
    const ctx = c.canvas.getContext("2d")!;
    ctx.clearRect(0, 0, c.canvas.width, c.canvas.height);
    ctx.drawImage(img, 0, 0, c.canvas.width, c.canvas.height);
    c.drawn = f;
  }

  update(change: Change): void {
    const m = this.model;
    const doc = m.doc;
    const R = this.refs;

    // Celdas (reconciliación por id: no se reconstruye lo que no cambió).
    const seen = new Set<string>();
    const ordered: HTMLElement[] = [];
    doc.frames.forEach((f, i) => {
      seen.add(f.id);
      let c = this.cells.get(f.id);
      if (!c) {
        c = this.makeCell();
        this.cells.set(f.id, c);
        const id = f.id;
        c.btn.addEventListener("click", () => {
          if (m.playing) this.player.pause();
          const idx = m.doc.frames.findIndex((x) => x.id === id);
          m.setFrameIndex(idx);
        });
      }
      if (c.frame !== f) {
        const wasNew = c.frame === null;
        c.frame = f;
        this.pending.add(f.id);
        this.pump(wasNew || f.id !== m.frameId ? 0 : 140);
      }
      const active = f.id === m.frameId;
      c.btn.classList.toggle("active", active);
      c.btn.setAttribute("aria-selected", String(active));
      c.btn.setAttribute("aria-label", T.frameCell(i + 1, f.hold));
      c.btn.dataset["index"] = String(i);
      c.btn.style.width = `${THUMB_W + 16 + Math.min(f.hold - 1, 6) * 14}px`;
      c.num.textContent = String(i + 1);
      c.hold.textContent = f.hold > 1 ? `×${f.hold}` : "";
      ordered.push(c.btn);
    });
    for (const [id, c] of this.cells) {
      if (!seen.has(id)) {
        c.btn.remove();
        this.cells.delete(id);
        this.pending.delete(id);
      }
    }
    if (this.strip.children.length !== ordered.length || ordered.some((b, i) => this.strip.children[i] !== b)) {
      this.strip.replaceChildren(...ordered);
    }
    if (this.lastActive !== m.frameId) {
      this.lastActive = m.frameId;
      this.cells.get(m.frameId)?.btn.scrollIntoView({ block: "nearest", inline: "nearest" });
    }

    // Controles
    const i = m.frameIndex;
    R["pos"]!.textContent = T.frame(i + 1, doc.frames.length);
    const play = R["play"]!;
    play.replaceChildren(icon(m.playing ? "pause" : "play", 22));
    play.setAttribute("aria-label", m.playing ? T.pause : T.play);
    play.title = m.playing ? T.pause : T.play;
    play.classList.toggle("on", m.playing);
    setDisabled(R["first"]!, i === 0);
    setDisabled(R["prev"]!, i === 0);
    setDisabled(R["next"]!, i >= doc.frames.length - 1);
    setDisabled(R["last"]!, i >= doc.frames.length - 1);
    setDisabled(R["del"]!, doc.frames.length <= 1 || m.playing);
    setDisabled(R["add"]!, m.playing);
    setDisabled(R["dup"]!, m.playing);
    setPressed(R["loop"]!, m.loop);
    setPressed(R["onion"]!, m.prefs.onion.enabled);
    this.holdStepper.refresh();
    this.onionSteppers.forEach((s) => s.refresh());

    const fps = R["fps"] as HTMLSelectElement;
    const opts = [...new Set<number>([...FPS_PRESETS, doc.fps])].sort((a, b) => a - b);
    if (fps.options.length !== opts.length || ![...fps.options].every((o, k) => Number(o.value) === opts[k])) {
      fps.replaceChildren(...opts.map((f) => h("option", { value: f }, `${f} FPS`)));
    }
    fps.value = String(doc.fps);
    void change;
  }
}
