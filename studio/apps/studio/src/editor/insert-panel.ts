import { VIEW_LABEL, VIEW_ORDER, applyInstanceExpression, applyInstancePose, insertCharacter, removeInstance } from "@gas/engine";
import type { CharacterMeta, ViewKind } from "@gas/core";
import { characterApi } from "../api";
import { openModal } from "../dialogs";
import { h } from "../dom";
import { btn, hint, row, selectField } from "./char-ui";
import type { EditorModel } from "./model";

/**
 * Personajes de la biblioteca en este episodio: insertar (copia autónoma con capas, esqueleto, expresiones y poses),
 * aplicar una expresión o una pose guardada al dibujo actual (o a un rango) y quitar.
 */
export class InsertPanel {
  readonly el: HTMLElement;
  private readonly list = h("div", { class: "cp-instances", "data-testid": "instances" });
  private sig = "";

  constructor(private readonly m: EditorModel) {
    this.el = h("section", { class: "panel-section rig-section", "data-section": "chars" }, h("h3", {}, "Personajes"),
      hint("Inserta personajes de la biblioteca. Cada uno es una copia con su esqueleto, expresiones y poses guardadas."),
      row(btn("Insertar personaje…", "insert-open", () => void this.open(), "primary")), this.list);
    this.update();
  }

  private async open(): Promise<void> {
    let all: CharacterMeta[] = [];
    try {
      all = (await characterApi.list()).characters;
    } catch (err) {
      return this.m.notice(`No se pudo abrir la biblioteca: ${(err as Error).message}`);
    }
    if (all.length === 0) return this.m.notice("La biblioteca está vacía: crea un personaje primero (Proyectos → Biblioteca de personajes).");
    let sel = all[0]!.id;
    let view: ViewKind = "front";
    const name = h("input", { type: "text", maxlength: 80, value: all[0]!.sheet.name, "data-testid": "insert-name", "aria-label": "Nombre en el episodio" });
    name.addEventListener("keydown", (e) => e.stopPropagation());
    const chSel = h("select", { "data-testid": "insert-character", "aria-label": "Personaje" }, ...all.map((c) => h("option", { value: c.id }, c.sheet.name)));
    chSel.addEventListener("change", () => { sel = chSel.value; name.value = all.find((c) => c.id === sel)?.sheet.name ?? ""; });
    const viewSel = h("select", { "data-testid": "insert-view", "aria-label": "Vista" }, ...VIEW_ORDER.map((k) => h("option", { value: k }, k === "front" ? `${VIEW_LABEL[k]} (con esqueleto)` : `${VIEW_LABEL[k]} (sin esqueleto)`)));
    viewSel.addEventListener("change", () => (view = viewSel.value as ViewKind));
    const msg = h("p", { class: "msg", role: "alert", "data-testid": "insert-msg" });
    const m = openModal("Insertar personaje", "insert-dialog", [
      h("label", { class: "field" }, h("span", {}, "Personaje"), chSel),
      h("label", { class: "field" }, h("span", {}, "Vista"), viewSel),
      h("label", { class: "field" }, h("span", {}, "Nombre en este episodio"), name),
      msg,
      h("div", { class: "row" }, h("button", { type: "button", class: "btn btn-primary big", "data-testid": "insert-ok", onclick: async () => {
        try {
          const drawing = await characterApi.drawing(sel);
          const SLOTS = [0.5, 0.3, 0.7, 0.15, 0.85, 0.4, 0.6];
          const ok = this.m.edit((d) => insertCharacter(d, drawing, { characterId: sel, name: name.value.trim() || "Personaje", view, feet: [d.width * SLOTS[(d.instances?.length ?? 0) % SLOTS.length]!, d.height * 0.94] }).doc);
          if (ok) { this.m.notice("Personaje insertado en todos los dibujos del episodio."); m.close(); }
          else m.close();
        } catch (err) {
          msg.textContent = (err as Error).message;
          msg.className = "msg msg-error";
        }
      } }, "Insertar")),
    ]);
  }

  update(): void {
    const d = this.m.doc;
    const insts = d.instances ?? [];
    const sig = JSON.stringify([insts.map((i) => [i.id, i.name, i.expressions.map((e) => e.id), i.poses.map((p) => p.id)]), this.m.frameIndex]);
    if (sig === this.sig) return;
    this.sig = sig;
    this.list.replaceChildren(...insts.map((i) => {
      const exprSel = selectField("Expresión", "inst-expr", [["", "— elegir —"], ...i.expressions.map((e) => [e.id, e.name] as [string, string])], () => "", (v) => { if (v) this.m.edit((x) => applyInstanceExpression(x, i.id, v, this.m.frameIndex), {}); });
      const poseSel = selectField("Pose guardada", "inst-pose", [["", "— elegir —"], ...i.poses.map((p) => [p.id, p.name] as [string, string])], () => "", (v) => { if (v) this.m.edit((x) => applyInstancePose(x, i.id, v, this.m.frameIndex)); });
      const rangeBtn = btn("Expresión a todos los dibujos", "inst-expr-all", () => {
        const v = (exprSel.el.querySelector("select") as HTMLSelectElement).value;
        if (v) this.m.edit((x) => applyInstanceExpression(x, i.id, v, 0, x.frames.length - 1));
      });
      return h("div", { class: "cp-inst", "data-testid": "instance", "data-name": i.name }, h("h4", {}, i.name), exprSel.el, rangeBtn, i.skeletonId ? poseSel.el : hint("Vista sin esqueleto: no tiene poses."), row(btn("Quitar del episodio", "inst-remove", () => { if (confirm(`¿Quitar a «${i.name}» de este episodio (capas, esqueleto y poses)?`)) this.m.edit((x) => removeInstance(x, i.id)); })));
    }));
  }
}
