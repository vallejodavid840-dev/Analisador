import { h } from "../dom";
import { es } from "../es";
import { icon } from "./icons";
import { iconBtn, setDisabled } from "./ui";
import type { EditorModel } from "./model";

const T = es.editor;

/** Panel de capas: la superior primero, como en cualquier programa de dibujo. */
export class LayersPanel {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly delBtn: HTMLButtonElement;
  private editing: string | null = null;

  constructor(private readonly model: EditorModel) {
    this.list = h("ul", { class: "layer-list", "data-testid": "layer-list" });
    this.delBtn = iconBtn("trash", T.deleteLayer, () => this.remove(), { testid: "del-layer", text: "Eliminar" });
    this.el = h(
      "section",
      { class: "panel-section", "data-section": "layers" },
      h("h3", {}, T.layersTitle),
      this.list,
      h("div", { class: "layer-actions" }, iconBtn("plus", T.addLayer, () => model.addLayer(), { testid: "add-layer", text: "Nueva" }), this.delBtn),
    );
    this.update();
  }

  private remove(): void {
    const l = this.model.layer;
    if (this.model.doc.layers.length <= 1) {
      this.model.notice("Debe quedar al menos una capa.");
      return;
    }
    if (confirm(T.confirmDeleteLayer(l.name))) this.model.removeLayer(l.id);
  }

  private startRename(id: string): void {
    this.editing = id;
    this.update();
  }

  update(): void {
    if (this.editing && !this.model.doc.layers.some((l) => l.id === this.editing)) this.editing = null;
    const m = this.model;
    const layers = m.doc.layers;
    const rows: HTMLElement[] = [];
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i]!;
      const active = l.id === m.layerId;
      const vis = h("button", { type: "button", class: `ibtn small ${l.visible ? "" : "off"}`, "aria-label": `${l.visible ? T.hide : T.show}: ${l.name}`, title: l.visible ? T.hide : T.show, "aria-pressed": String(l.visible), "data-testid": "layer-vis", onclick: () => m.toggleVisible(l.id) });
      vis.append(icon(l.visible ? "eye" : "eyeOff", 20));
      const lock = h("button", { type: "button", class: `ibtn small ${l.locked ? "on" : ""}`, "aria-label": `${l.locked ? T.unlock : T.lock}: ${l.name}`, title: l.locked ? T.unlock : T.lock, "aria-pressed": String(l.locked), "data-testid": "layer-lock", onclick: () => m.toggleLocked(l.id) });
      lock.append(icon(l.locked ? "lock" : "unlock", 20));

      let nameEl: HTMLElement;
      if (this.editing === l.id) {
        const input = h("input", { type: "text", class: "layer-name-input", value: l.name, maxlength: 60, "aria-label": T.renameLayer, "data-testid": "layer-name-input" });
        const done = (commit: boolean) => {
          if (this.editing !== l.id) return;
          this.editing = null;
          if (commit && input.value.trim()) m.renameLayer(l.id, input.value);
          else this.update();
        };
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") done(true);
          else if (e.key === "Escape") done(false);
          e.stopPropagation();
        });
        input.addEventListener("blur", () => done(true));
        nameEl = input;
        queueMicrotask(() => {
          input.focus();
          input.select();
        });
      } else {
        nameEl = h("button", { type: "button", class: "layer-name", "data-testid": "layer-name", "aria-current": active ? "true" : undefined, onclick: () => m.setLayer(l.id), ondblclick: () => this.startRename(l.id) }, l.name);
      }
      const edit = iconBtn("edit", `${T.renameLayer}: ${l.name}`, () => this.startRename(l.id), { cls: "small", testid: "layer-rename" });
      const up = iconBtn("up", `${T.layerUp}: ${l.name}`, () => m.moveLayer(l.id, 1), { cls: "small", testid: "layer-up" });
      const down = iconBtn("down", `${T.layerDown}: ${l.name}`, () => m.moveLayer(l.id, -1), { cls: "small", testid: "layer-down" });
      setDisabled(up, i === layers.length - 1);
      setDisabled(down, i === 0);
      rows.push(h("li", { class: `layer-row ${active ? "active" : ""} ${l.locked ? "locked" : ""} ${l.visible ? "" : "hidden"}`, "data-testid": "layer-row", "data-layer-id": l.id }, vis, lock, nameEl, edit, up, down));
    }
    this.list.replaceChildren(...rows);
    setDisabled(this.delBtn, layers.length <= 1);
  }
}
