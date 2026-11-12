import type { Animation } from "@gas/core";
import type { ApiError } from "../api";
import { h } from "../dom";
import { es } from "../es";
import { logoMark } from "../logo";
import { AutoSave, type SaveStatus } from "./autosave";
import { characterBackend, episodeBackend, type DocBackend } from "./backend";
import { deleteDraft, getDraft } from "./drafts";
import { icon, type IconName } from "./icons";
import { openExportDialog } from "./export-dialog";
import { InputController } from "./input";
import { LayersPanel } from "./layers";
import { EditorModel, loadPrefs, type Tool } from "./model";
import { BrushPanel, ColorPanel } from "./panels";
import { Player } from "./player";
import { RigPanel } from "./rig-panel";
import { CharPanel } from "./char-panel";
import { FxPanel } from "./fx-panel";
import { InsertPanel } from "./insert-panel";
import { characterApi } from "../api";
import { openFicha } from "../ficha";
import { frameImage } from "./cache";
import { posedFrame, viewFrameIndex } from "@gas/engine";
import { Timeline } from "./timeline";
import { iconBtn, setDisabled, setPressed } from "./ui";
import { Viewport } from "./viewport";

const T = es.editor;

export interface EditorOptions {
  projectId: string;
  projectName: string;
  episodeId: string;
  episodeTitle: string;
  /** Modo personaje (Fase 4): se edita un personaje de la biblioteca en vez de un episodio. */
  character?: { id: string; name: string };
  /** Vuelve al proyecto (después de dejar guardado el trabajo). */
  onExit: () => void;
}

const TOOLS: Array<{ tool: Tool; icon: IconName }> = [
  { tool: "pen", icon: "pen" },
  { tool: "fill", icon: "fill" },
  { tool: "eraser", icon: "eraser" },
  { tool: "select", icon: "select" },
  { tool: "hand", icon: "hand" },
  { tool: "rig", icon: "bones" },
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

  const backend: DocBackend = opts.character ? characterBackend(opts.character.id) : episodeBackend(opts.projectId, opts.episodeId);
  let anim: Animation;
  try {
    anim = await backend.load();
  } catch (err) {
    root.replaceChildren(h("div", { class: "editor-loading" }, h("p", { class: "msg msg-error", role: "alert" }, `${T.loadFailed}: ${(err as ApiError).message}`), h("button", { class: "btn", type: "button", onclick: opts.onExit }, T.back)));
    return () => undefined;
  }

  // ¿Quedó trabajo sin guardar de una sesión anterior (cierre, corte de red, batería)?
  const key = backend.draftKey;
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
  const rigPanel = new RigPanel(model);
  const fxPanel = new FxPanel(model);
  const charMode = !!opts.character;
  const charPanel = charMode ? new CharPanel(model, { characterId: opts.character!.id, characterName: opts.character!.name, openFicha: () => void openFicha(opts.character!.id) }) : null;
  const insertPanel = charMode ? null : new InsertPanel(model);
  if (charPanel) {
    charPanel.onRefs = (items) => viewport.setReferences(items);
    model.rig.show = false; // el esqueleto solo se ve al elegir «Esqueleto» o «Huesos»
    model.rig.restView = true; // los personajes se dibujan SIN deformar: así lo dibujado cae en el sitio correcto del reposo
  }
  const autosave = new AutoSave(backend, model, serverRevision, () => input.busy);

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
  let sheet: "brush" | "color" | "layers" | "rig" | "char" | "chars" | "fx" | null = null;
  const sheetBtns = {
    brush: iconBtn("brush", T.brushTitle, () => toggleSheet("brush"), { testid: "open-brush", cls: "tool sheet-btn", text: "Ajustes" }),
    color: iconBtn("palette", T.colorTitle, () => toggleSheet("color"), { testid: "open-color", cls: "tool sheet-btn", text: T.colorTitle }),
    layers: iconBtn("layers", T.layersTitle, () => toggleSheet("layers"), { testid: "open-layers", cls: "tool sheet-btn", text: T.layersTitle }),
    rig: iconBtn("bones", es.rig.title, () => toggleSheet("rig"), { testid: "open-rig", cls: "tool sheet-btn", text: "Huesos" }),
    ...(charMode ? { char: iconBtn("person", "Personaje", () => toggleSheet("char"), { testid: "open-char", cls: "tool sheet-btn", text: "Personaje" }) } : { chars: iconBtn("person", "Personajes", () => toggleSheet("chars"), { testid: "open-chars", cls: "tool sheet-btn", text: "Personajes" }) }),
    fx: iconBtn("layers", "Acabado de capa", () => toggleSheet("fx"), { testid: "open-fx", cls: "tool sheet-btn", text: "Acabado" }),
  } as Record<string, HTMLButtonElement>;
  const colorDot = h("span", { class: "color-dot" });
  sheetBtns.color!.append(colorDot);
  toolbar.append(...Object.values(sheetBtns));

  const side = h("aside", { class: "side", "data-testid": "side" },
    h("button", { type: "button", class: "ibtn sheet-close", "aria-label": T.sheetClose, title: T.sheetClose, onclick: () => toggleSheet(null) }, icon("close", 20)),
    brush.el, color.el, layers.el, ...(charPanel ? [charPanel.el] : []), ...(insertPanel ? [insertPanel.el] : []), fxPanel.el, rigPanel.el);
  function toggleSheet(s: typeof sheet): void {
    sheet = sheet === s ? null : s;
    side.dataset["open"] = sheet ?? "";
    for (const [k, b] of Object.entries(sheetBtns)) setPressed(b, sheet === k);
  }

  // Barra superior
  const statusEl = h("span", { class: "save-chip", "data-testid": "save-status", role: "status", "aria-live": "polite" });
  const undoBtn = iconBtn("undo", `${T.undo} (Ctrl+Z)`, () => undo(), { testid: "undo" });
  const redoBtn = iconBtn("redo", `${T.redo} (Ctrl+Mayús+Z)`, () => redo(), { testid: "redo" });
  let exportClose: (() => void) | null = null;
  const exportBtn = iconBtn("export", "Exportar episodio a vídeo o imágenes", () => {
    if (exportClose) return;
    input.cancel();
    player.pause();
    void openExportDialog({ projectId: opts.projectId, episodeId: opts.episodeId, episodeTitle: opts.episodeTitle, model, autosave, onClose: () => (exportClose = null) }).then((c) => (exportClose = c));
  }, { testid: "export-open", cls: "export-btn", text: es.editor.exportBtn });
  const top = h("header", { class: "editor-top" },
    h("button", { type: "button", class: "btn back", "data-testid": "exit", "aria-label": "Volver al proyecto", onclick: () => void exit() }, h("span", {}, "←"), h("span", { class: "back-text" }, " Proyecto")),
    h("span", { class: "brand-mini" }, logoMark()),
    h("div", { class: "doc-title" }, h("strong", { "data-testid": "doc-title" }, opts.episodeTitle), h("span", {}, opts.projectName)),
    statusEl, ...(charMode ? [iconBtn("person", "Ficha del personaje", () => void openFicha(opts.character!.id), { testid: "open-ficha", cls: "export-btn", text: "Ficha" })] : [exportBtn]), undoBtn, redoBtn);

  const editor = h("div", { class: `editor${charMode ? " char-mode" : ""}`, "data-testid": "editor" }, top, toolbar, stage, side, timeline.el);
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
  // Miniatura de la biblioteca: la vista frontal, ya guardada. Se regenera unos segundos después de dejar de editar.
  let thumbTimer = 0;
  let thumbVersion = -1;
  const writeThumb = () => {
    if (!charMode || autosave.dirty || thumbVersion === model.history.version) return;
    thumbVersion = model.history.version;
    const fi = viewFrameIndex(model.doc, "front");
    if (fi < 0) return;
    try {
      const img = frameImage(model.doc, posedFrame(model.doc, fi), { scale: 200 / model.doc.width, background: "#ffffff" });
      void characterApi.patch(opts.character!.id, { thumbnail: img.toDataURL("image/png") }).catch(() => undefined);
    } catch { /* la miniatura es un extra: nunca debe estorbar */ }
  };
  const prevOnStatus = autosave.onStatus;
  autosave.onStatus = (st, detail) => {
    prevOnStatus(st, detail);
    if (charMode && st === "saved") { clearTimeout(thumbTimer); thumbTimer = window.setTimeout(writeThumb, 2500); }
  };

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
    side.dataset["tool"] = model.prefs.tool;
    stage.dataset["playing"] = String(model.playing);
    const n = model.selection.size;
    selBar.hidden = !(model.prefs.tool === "select" && n > 0);
    if (!selBar.hidden) {
      selBar.replaceChildren(
        h("span", { class: "sel-count", "data-testid": "sel-count" }, T.selCount(n)),
        iconBtn("flip", T.selFlip, () => model.flipSelection(), { testid: "sel-flip", text: "Voltear" }),
        iconBtn("dup", T.selDup, () => model.duplicateSelection(), { testid: "sel-dup", text: "Duplicar" }),
        iconBtn("trash", T.selDel, () => model.deleteSelection(), { testid: "sel-del", text: "Eliminar" }),
        (() => {
          // Separar las partes de un personaje: enviar la selección a otra capa (para vincular cada capa a su hueso)
          const sel = h("select", { class: "sel-move", "data-testid": "sel-move-layer", "aria-label": es.rig.moveTo }, h("option", { value: "" }, es.rig.moveTo), ...model.doc.layers.filter((l) => l.id !== model.layerId).map((l) => h("option", { value: l.id }, l.name)));
          sel.addEventListener("change", () => sel.value && model.moveSelectionToLayer(sel.value));
          return sel;
        })(),
      );
    }
  }
  viewport.onViewChange = () => { zoomPct.textContent = T.zoomPct(viewport.view.zoom); };

  const unsub = model.subscribe((c) => {
    if (c.doc || c.ui) {
      timeline.update(c);
      // Durante la reproducción solo cambia el fotograma: los paneles (capas, esqueleto, pincel…) no necesitan
      // reconstruirse 24 veces por segundo; se actualizan al pausar (que emite un cambio de UI).
      if (model.playing && !c.doc) {
        zoomPct.textContent = T.zoomPct(viewport.view.zoom);
        return;
      }
      layers.update();
      charPanel?.update();
      insertPanel?.update();
      fxPanel.update();
      rigPanel.update();
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
    if (exportClose) return; // con la ventana de exportación abierta, los atajos del editor no actúan
    const typing = isTyping(e.target);
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === "z" && !typing) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k === "y" && !typing) { e.preventDefault(); redo(); return; }
    if (typing || mod || e.altKey) return;
    switch (k) {
      case "b": input.cancel(); model.setTool("pen"); break;
      case "g": input.cancel(); model.setTool("fill"); break;
      case "e": input.cancel(); model.setTool("eraser"); break;
      case "v": input.cancel(); model.setTool("select"); break;
      case "h": input.cancel(); model.setTool("hand"); break;
      case "k": input.cancel(); model.setTool("rig"); break;
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
    exportClose?.();
    input.dispose();
    viewport.dispose();
    unsub();
    autosave.dispose();
    window.removeEventListener("keydown", onKey);
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("beforeunload", onBeforeUnload);
    clearTimeout(toastTimer);
    clearTimeout(thumbTimer);
    delete window.__gas;
  };

  async function exit(): Promise<void> {
    player.pause();
    input.cancel();
    if (autosave.dirty && autosave.status !== "conflict") {
      const ok = await autosave.save();
      if (!ok && autosave.dirty && !confirm("No se pudo guardar. ¿Salir de todos modos? Tu trabajo queda como borrador en este dispositivo.")) return;
    }
    if (charMode) writeThumb();
    dispose();
    opts.onExit();
  }

  return dispose;
}
