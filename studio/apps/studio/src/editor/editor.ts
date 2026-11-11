import type { Animation } from "@gas/core";
import { animationApi, type ApiError } from "../api";
import { h } from "../dom";
import { es } from "../es";
import { logoMark } from "../logo";
import { AutoSave, type SaveStatus } from "./autosave";
import { deleteDraft, draftKey, getDraft } from "./drafts";
import { icon, type IconName } from "./icons";
import { InputController } from "./input";
import { LayersPanel } from "./layers";
import { EditorModel, loadPrefs, type Tool } from "./model";
import { BrushPanel, ColorPanel } from "./panels";
import { Player } from "./player";
import { Timeline } from "./timeline";
import { iconBtn, setDisabled, setPressed } from "./ui";
import { Viewport } from "./viewport";

const T = es.editor;

export interface EditorOptions {
  projectId: string;
  projectName: string;
  episodeId: string;
  episodeTitle: string;
  /** Vuelve al proyecto (después de dejar guardado el trabajo). */
  onExit: () => void;
}

const TOOLS: Array<{ tool: Tool; icon: IconName }> = [
  { tool: "pen", icon: "pen" },
  { tool: "eraser", icon: "eraser" },
  { tool: "select", icon: "select" },
  { tool: "hand", icon: "hand" },
];

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);

export interface Diagnostics {
  model: EditorModel;
  viewport: Viewport;
  player: Player;
  autosave: AutoSave;
}
declare global {
  interface Window {
    /** Solo lectura y diagnóstico (pruebas automáticas). */
    __gas?: Diagnostics;
  }
}

export async function openEditor(root: HTMLElement, opts: EditorOptions): Promise<() => void> {
  root.replaceChildren(h("div", { class: "editor-loading", role: "status" }, T.loading));

  let anim: Animation;
  try {
    anim = await animationApi.load(opts.projectId, opts.episodeId);
  } catch (err) {
    root.replaceChildren(h("div", { class: "editor-loading" }, h("p", { class: "msg msg-error", role: "alert" }, `${T.loadFailed}: ${(err as ApiError).message}`), h("button", { class: "btn", type: "button", onclick: opts.onExit }, T.back)));
    return () => undefined;
  }

  // ¿Quedó trabajo sin guardar de una sesión anterior (cierre, corte de red, batería)?
  const key = draftKey(opts.projectId, opts.episodeId);
  const draft = await getDraft(key);
  let recovered = false;
  const serverRevision = anim.revision;
  if (draft && draft.baseRevision === serverRevision && JSON.stringify({ ...draft.doc, revision: 0 }) !== JSON.stringify({ ...anim, revision: 0 })) {
    anim = { ...draft.doc, revision: serverRevision };
    recovered = true;
  } else if (draft) {
    await deleteDraft(key); // el servidor ya está al día o más adelantado
  }

  const model = new EditorModel(anim, loadPrefs());
  const player = new Player(model);

  /* ───── DOM ───── */
  const stage = h("div", { class: "stage", "data-testid": "stage-host" });
  const toast = h("div", { class: "toast", role: "status", "aria-live": "polite", "data-testid": "toast", hidden: true });
  const banner = h("div", { class: "banner", role: "alert", hidden: true });
  const zoomOut = iconBtn("minus", T.zoomOut, () => viewport.zoomCenter(1 / 1.25), { testid: "zoom-out", cls: "small" });
  const zoomIn = iconBtn("plus", T.zoomIn, () => viewport.zoomCenter(1.25), { testid: "zoom-in", cls: "small" });
  const zoomFit = iconBtn("fit", T.fit, () => viewport.fit(), { testid: "zoom-fit", cls: "small" });
  const zoomPct = h("button", { type: "button", class: "zoom-pct", "data-testid": "zoom-pct", "aria-label": "Zoom al 100 %", title: "Zoom al 100 %", onclick: () => viewport.zoomCenter(1 / viewport.view.zoom) });
  const selBar = h("div", { class: "selbar", "data-testid": "selbar", hidden: true });
  stage.append(h("div", { class: "zoom-ctl" }, zoomOut, zoomPct, zoomIn, zoomFit), selBar, toast, banner);

  const viewport = new Viewport(stage, model);
  const input = new InputController(viewport.canvas, model, viewport, () => player.pause());
  const timeline = new Timeline(model, player, (strokes) => viewport.cache.peek(strokes));
  const brush = new BrushPanel(model);
  const color = new ColorPanel(model);
  const layers = new LayersPanel(model);
  const autosave = new AutoSave(opts.projectId, model, serverRevision, () => input.busy);

  let toastTimer = 0;
  model.notice = (msg) => {
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toast.hidden = true), 3200);
  };

  // Herramientas
  const toolBtns = new Map<Tool, HTMLButtonElement>();
  const toolbar = h("nav", { class: "tools", "aria-label": "Herramientas" });
  for (const t of TOOLS) {
    const b = iconBtn(t.icon, `${T.tools[t.tool]} (${T.toolKeys[t.tool]})`, () => { input.cancel(); model.setTool(t.tool); }, { testid: `tool-${t.tool}`, cls: "tool", text: T.tools[t.tool] });
    toolBtns.set(t.tool, b);
    toolbar.append(b);
  }
  // Paneles: en pantallas pequeñas se abren como hoja inferior.
  let sheet: "brush" | "color" | "layers" | null = null;
  const sheetBtns = {
    brush: iconBtn("brush", T.brushTitle, () => toggleSheet("brush"), { testid: "open-brush", cls: "tool sheet-btn", text: "Ajustes" }),
    color: iconBtn("palette", T.colorTitle, () => toggleSheet("color"), { testid: "open-color", cls: "tool sheet-btn", text: T.colorTitle }),
    layers: iconBtn("layers", T.layersTitle, () => toggleSheet("layers"), { testid: "open-layers", cls: "tool sheet-btn", text: T.layersTitle }),
  };
  const colorDot = h("span", { class: "color-dot" });
  sheetBtns.color.append(colorDot);
  toolbar.append(sheetBtns.brush, sheetBtns.color, sheetBtns.layers);

  const side = h("aside", { class: "side", "data-testid": "side" },
    h("button", { type: "button", class: "ibtn sheet-close", "aria-label": T.sheetClose, title: T.sheetClose, onclick: () => toggleSheet(null) }, icon("close", 20)),
    brush.el, color.el, layers.el);
  function toggleSheet(s: typeof sheet): void {
    sheet = sheet === s ? null : s;
    side.dataset["open"] = sheet ?? "";
    for (const [k, b] of Object.entries(sheetBtns)) setPressed(b, sheet === k);
  }

  // Barra superior
  const statusEl = h("span", { class: "save-chip", "data-testid": "save-status", role: "status", "aria-live": "polite" });
  const undoBtn = iconBtn("undo", `${T.undo} (Ctrl+Z)`, () => undo(), { testid: "undo" });
  const redoBtn = iconBtn("redo", `${T.redo} (Ctrl+Mayús+Z)`, () => redo(), { testid: "redo" });
  const top = h("header", { class: "editor-top" },
    h("button", { type: "button", class: "btn back", "data-testid": "exit", "aria-label": "Volver al proyecto", onclick: () => void exit() }, h("span", {}, "←"), h("span", { class: "back-text" }, " Proyecto")),
    h("span", { class: "brand-mini" }, logoMark()),
    h("div", { class: "doc-title" }, h("strong", {}, opts.episodeTitle), h("span", {}, opts.projectName)),
    statusEl, undoBtn, redoBtn);

  const editor = h("div", { class: "editor", "data-testid": "editor" }, top, toolbar, stage, side, timeline.el);
  root.replaceChildren(editor);

  function undo(): void { input.cancel(); player.pause(); model.undo(); }
  function redo(): void { input.cancel(); player.pause(); model.redo(); }

  /* ───── estado → UI ───── */
  const statusText: Record<SaveStatus, string> = T.status;
  autosave.onStatus = (s, detail) => {
    statusEl.textContent = statusText[s];
    statusEl.dataset["status"] = s;
    statusEl.title = detail;
    if (s === "conflict") {
      banner.hidden = false;
      banner.replaceChildren(h("strong", {}, T.conflictTitle), h("p", {}, T.conflictBody),
        h("button", { class: "btn btn-primary", type: "button", "data-testid": "conflict-reload", onclick: () => void reloadFromDisk() }, T.conflictReload));
    } else banner.hidden = true;
  };
  statusEl.textContent = statusText.saved;
  statusEl.dataset["status"] = "saved";

  async function reloadFromDisk(): Promise<void> {
    await autosave.discardDraft();
    autosave.dispose();
    window.location.reload();
  }

  function refreshUi(): void {
    for (const [t, b] of toolBtns) setPressed(b, model.prefs.tool === t);
    setDisabled(undoBtn, !model.history.canUndo);
    setDisabled(redoBtn, !model.history.canRedo);
    zoomPct.textContent = T.zoomPct(viewport.view.zoom);
    colorDot.style.background = model.prefs.color;
    stage.dataset["tool"] = model.prefs.tool;
    stage.dataset["playing"] = String(model.playing);
    const n = model.selection.size;
    selBar.hidden = !(model.prefs.tool === "select" && n > 0);
    if (!selBar.hidden) {
      selBar.replaceChildren(
        h("span", { class: "sel-count", "data-testid": "sel-count" }, T.selCount(n)),
        iconBtn("flip", T.selFlip, () => model.flipSelection(), { testid: "sel-flip", text: "Voltear" }),
        iconBtn("dup", T.selDup, () => model.duplicateSelection(), { testid: "sel-dup", text: "Duplicar" }),
        iconBtn("trash", T.selDel, () => model.deleteSelection(), { testid: "sel-del", text: "Eliminar" }),
      );
    }
  }
  viewport.onViewChange = () => { zoomPct.textContent = T.zoomPct(viewport.view.zoom); };

  const unsub = model.subscribe((c) => {
    if (c.doc || c.ui) {
      timeline.update(c);
      layers.update();
      brush.update();
      color.update();
      refreshUi();
    }
  });
  refreshUi();
  viewport.fit();
  if (recovered) {
    autosave.markDirty();
    model.notice(T.recovered);
  }

  /* ───── teclado ───── */
  const onKey = (e: KeyboardEvent) => {
    const typing = isTyping(e.target);
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === "z" && !typing) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k === "y" && !typing) { e.preventDefault(); redo(); return; }
    if (typing || mod || e.altKey) return;
    switch (k) {
      case "b": input.cancel(); model.setTool("pen"); break;
      case "e": input.cancel(); model.setTool("eraser"); break;
      case "v": input.cancel(); model.setTool("select"); break;
      case "h": input.cancel(); model.setTool("hand"); break;
      case " ": case "enter": e.preventDefault(); if (!(document.activeElement instanceof HTMLButtonElement)) player.toggle(); break;
      case "arrowleft": e.preventDefault(); player.pause(); model.setFrameIndex(model.frameIndex - 1); break;
      case "arrowright": e.preventDefault(); player.pause(); model.setFrameIndex(model.frameIndex + 1); break;
      case "delete": case "backspace": if (model.selection.size) { e.preventDefault(); model.deleteSelection(); } break;
      case "escape": input.cancel(); model.setSelection([]); break;
      case "o": model.updatePrefs((p) => (p.onion.enabled = !p.onion.enabled)); break;
      case "[": model.updatePrefs((p) => { const b = model.prefs.tool === "eraser" ? p.eraser : p.pen; b.size = Math.max(1, Math.round(b.size * 0.85 - 0.5)); }); break;
      case "]": model.updatePrefs((p) => { const b = model.prefs.tool === "eraser" ? p.eraser : p.pen; b.size = Math.min(200, Math.round(b.size * 1.15 + 0.5)); }); break;
      case "+": case "=": viewport.zoomCenter(1.25); break;
      case "-": viewport.zoomCenter(1 / 1.25); break;
      case "0": viewport.fit(); break;
      default: return;
    }
  };
  window.addEventListener("keydown", onKey);

  const onHide = () => { if (document.visibilityState === "hidden") autosave.flushOnExit(false); };
  const onPageHide = () => autosave.flushOnExit(true);
  const onBeforeUnload = (e: BeforeUnloadEvent) => { if (autosave.dirty && autosave.status !== "conflict") e.preventDefault(); };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("beforeunload", onBeforeUnload);

  window.__gas = { model, viewport, player, autosave };

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    player.pause();
    input.dispose();
    viewport.dispose();
    unsub();
    autosave.dispose();
    window.removeEventListener("keydown", onKey);
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("beforeunload", onBeforeUnload);
    clearTimeout(toastTimer);
    delete window.__gas;
  };

  async function exit(): Promise<void> {
    player.pause();
    input.cancel();
    if (autosave.dirty && autosave.status !== "conflict") {
      const ok = await autosave.save();
      if (!ok && autosave.dirty && !confirm("No se pudo guardar. ¿Salir de todos modos? Tu trabajo queda como borrador en este dispositivo.")) return;
    }
    dispose();
    opts.onExit();
  }

  return dispose;
}
