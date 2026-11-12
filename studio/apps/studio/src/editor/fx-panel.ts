import { h } from "../dom";
import { btn, checkField, hint, rangeField, row, section, selectField, type Field } from "./char-ui";
import type { EditorModel } from "./model";

export const SKIN_SHADOW = "#7a5a78";
const BLENDS: Array<[string, string]> = [["normal", "Normal"], ["multiply", "Multiplicar (sombras)"], ["screen", "Trama (luces)"], ["overlay", "Superponer"], ["add", "Sumar (brillos)"]];

/**
 * «Acabado de capa»: opacidad, modo de mezcla, recorte a la capa de debajo y desenfoque (sombra suave),
 * más atajos para crear capas de sombra y de luz ya configuradas. Vale para episodios y personajes.
 */
export class FxPanel {
  readonly el: HTMLElement;
  private fields: Field[] = [];
  private readonly title = h("p", { class: "hint", "data-testid": "fx-layer" });

  constructor(private readonly m: EditorModel) {
    const L = () => this.m.layer;
    const set = (p: Parameters<EditorModel["setLayerFx"]>[1]) => this.m.setLayerFx(this.m.layerId, p);
    const add = <T extends Field>(f: T) => (this.fields.push(f), f.el);
    const body = section("Acabado de capa", "cp-fx", false,
      this.title,
      add(rangeField("Opacidad de la capa", "fx-opacity", { min: 0, max: 1, step: 0.05 }, () => L().opacity ?? 1, (v) => set({ opacity: v }))),
      add(selectField("Modo de mezcla", "fx-blend", BLENDS, () => L().blend ?? "normal", (v) => set({ blend: v as never }))),
      add(checkField("Recortar a la capa de debajo (la sombra no se sale de la prenda)", "fx-clip", () => L().clip === true, (v) => set({ clip: v }))),
      add(rangeField("Desenfoque (0 sombra dura · más = suave)", "fx-blur", { min: 0, max: 40, step: 1 }, () => L().blur ?? 0, (v) => set({ blur: v }))),
      hint("Atajos: crean una capa nueva encima de la activa, recortada a ella."),
      row(
        btn("Sombra dura", "fx-add-shadow", () => this.addFx("Sombra", { blend: "multiply", clip: true, opacity: 0.55 }, "#7a5a78")),
        btn("Sombra suave", "fx-add-soft", () => this.addFx("Sombra suave", { blend: "multiply", clip: true, opacity: 0.5, blur: 10 }, "#7a5a78")),
        btn("Luz", "fx-add-light", () => this.addFx("Luz", { blend: "screen", clip: true, opacity: 0.6 }, "#fff2c8")),
        btn("Brillo", "fx-add-shine", () => this.addFx("Brillo", { blend: "add", clip: true, opacity: 0.5, blur: 2 }, "#ffffff")),
      ));
    this.el = h("section", { class: "panel-section rig-section", "data-section": "fx" }, h("h3", {}, "Acabado"), body);
    this.update();
  }

  private addFx(name: string, fx: Parameters<EditorModel["setLayerFx"]>[1], color: string): void {
    const base = this.m.layer;
    const id = this.m.addLayerAbove(base.id, `${name}: ${base.name}`.slice(0, 60), fx);
    if (id) {
      this.m.updatePrefs((p) => (p.color = color));
      this.m.setTool("fill");
      this.m.notice(`Capa «${name}» creada: pinta con Relleno o Pincel; solo se ve dentro de «${base.name}».`);
    }
  }

  update(): void {
    const l = this.m.layer;
    this.title.textContent = `Capa activa: ${l.name}`;
    for (const f of this.fields) f.refresh();
  }
}
