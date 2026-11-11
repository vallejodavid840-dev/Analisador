import { h } from "../dom";
import { es } from "../es";
import type { EditorModel } from "./model";

const T = es.editor;

export const PALETTE = [
  "#111111", "#3a3a46", "#7b7b8a", "#bdbdc9", "#ffffff",
  "#f6d5bd", "#e9b896", "#c98c64", "#8d5a3b",
  "#1d1a26", "#5b3a29", "#d9a441", "#f2e07a",
  "#e8323c", "#8a1e2b", "#ff8fb8", "#ff7a1a", "#ffc233",
  "#2fd3a8", "#1f6b4a", "#35a7ff", "#2b4aa8", "#1f2a5a", "#7c4dff",
];

const sizeFromSlider = (v: number) => Math.round(1 + (v / 100) ** 2 * 199);
const sliderFromSize = (s: number) => Math.round(100 * Math.sqrt(Math.max(0, s - 1) / 199));

function slider(opts: { label: string; testid: string; min: number; max: number; value: number; text: (v: number) => string; onInput: (v: number) => void }) {
  const out = h("output", { class: "range-out", "data-testid": `${opts.testid}-out` }, opts.text(opts.value));
  const input = h("input", { type: "range", min: opts.min, max: opts.max, step: 1, value: opts.value, "aria-label": opts.label, "data-testid": opts.testid });
  input.addEventListener("input", () => {
    const v = Number(input.value);
    out.textContent = opts.text(v);
    opts.onInput(v);
  });
  const el = h("label", { class: "range" }, h("span", { class: "range-label" }, opts.label, out), input);
  return {
    el,
    set(v: number) {
      if (document.activeElement !== input) input.value = String(v);
      out.textContent = opts.text(v);
    },
  };
}

/** Panel del pincel/borrador: tamaño, opacidad, presión y entrada táctil. */
export class BrushPanel {
  readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly size: ReturnType<typeof slider>;
  private readonly opacity: ReturnType<typeof slider>;
  private readonly sens: ReturnType<typeof slider>;
  private readonly finger: HTMLInputElement;

  constructor(private readonly model: EditorModel) {
    const brush = () => model.brush;
    this.title = h("h3", {});
    this.size = slider({
      label: T.size, testid: "brush-size", min: 0, max: 100, value: sliderFromSize(brush().size),
      text: (v) => `${sizeFromSlider(v)} px`,
      onInput: (v) => model.updatePrefs((p) => ((model.prefs.tool === "eraser" ? p.eraser : p.pen).size = sizeFromSlider(v))),
    });
    this.opacity = slider({
      label: T.opacity, testid: "brush-opacity", min: 1, max: 100, value: Math.round(brush().opacity * 100),
      text: (v) => `${v} %`,
      onInput: (v) => model.updatePrefs((p) => ((model.prefs.tool === "eraser" ? p.eraser : p.pen).opacity = v / 100)),
    });
    this.sens = slider({
      label: T.sens, testid: "brush-sens", min: 0, max: 100, value: Math.round(brush().sens * 100),
      text: (v) => `${v} %`,
      onInput: (v) => model.updatePrefs((p) => ((model.prefs.tool === "eraser" ? p.eraser : p.pen).sens = v / 100)),
    });
    this.finger = h("input", { type: "checkbox", "data-testid": "finger-draws", checked: model.prefs.touchDraws });
    this.finger.addEventListener("change", () => model.updatePrefs((p) => (p.touchDraws = this.finger.checked)));
    this.el = h(
      "section",
      { class: "panel-section", "data-section": "brush" },
      this.title,
      this.size.el,
      this.opacity.el,
      this.sens.el,
      h("label", { class: "check" }, this.finger, h("span", {}, T.fingerDraws)),
      h("p", { class: "hint" }, T.fingerHint),
    );
    this.update();
  }

  update(): void {
    const eraser = this.model.prefs.tool === "eraser";
    const b = this.model.brush;
    this.title.textContent = eraser ? T.eraserTitle : T.brushTitle;
    this.size.set(sliderFromSize(b.size));
    this.opacity.set(Math.round(b.opacity * 100));
    this.sens.set(Math.round(b.sens * 100));
    this.sens.el.hidden = eraser;
    this.finger.checked = this.model.prefs.touchDraws;
  }
}

export class ColorPanel {
  readonly el: HTMLElement;
  private readonly picker: HTMLInputElement;
  private readonly hex: HTMLInputElement;
  private readonly recent: HTMLElement;

  constructor(private readonly model: EditorModel) {
    const set = (c: string) => {
      model.updatePrefs((p) => (p.color = c.toLowerCase()));
      if (model.prefs.tool !== "pen") model.setTool("pen"); // elegir un color implica querer pintar con él
    };
    this.picker = h("input", { type: "color", class: "color-picker", "aria-label": T.colorTitle, "data-testid": "color-picker" });
    this.picker.addEventListener("input", () => set(this.picker.value));
    this.hex = h("input", { type: "text", class: "color-hex", maxlength: 7, "aria-label": T.colorHex, "data-testid": "color-hex", spellcheck: "false", autocomplete: "off" });
    this.hex.addEventListener("input", () => {
      const v = this.hex.value.startsWith("#") ? this.hex.value : `#${this.hex.value}`;
      if (/^#[0-9a-fA-F]{6}$/.test(v)) set(v);
    });
    this.hex.addEventListener("keydown", (e) => e.stopPropagation());
    const swatch = (c: string) => {
      const b = h("button", { type: "button", class: "swatch", style: `background:${c}`, "aria-label": `${T.colorTitle} ${c}`, title: c, "data-color": c, "data-testid": "swatch", onclick: () => set(c) });
      return b;
    };
    this.recent = h("div", { class: "swatches", "data-testid": "recent" });
    this.el = h(
      "section",
      { class: "panel-section", "data-section": "color" },
      h("h3", {}, T.colorTitle),
      h("div", { class: "color-row" }, this.picker, this.hex),
      h("h4", {}, T.recent),
      this.recent,
      h("h4", {}, T.palette),
      h("div", { class: "swatches" }, ...PALETTE.map(swatch)),
    );
    this.update();
  }

  update(): void {
    const c = this.model.prefs.color;
    this.picker.value = c;
    if (document.activeElement !== this.hex) this.hex.value = c;
    for (const b of this.el.querySelectorAll<HTMLElement>(".swatch")) b.classList.toggle("sel", b.dataset["color"] === c);
    this.recent.replaceChildren(
      ...this.model.prefs.recent.map((r) => h("button", { type: "button", class: `swatch ${r === c ? "sel" : ""}`, style: `background:${r}`, "aria-label": `${T.recent} ${r}`, title: r, "data-color": r, onclick: () => {
        this.model.updatePrefs((p) => (p.color = r));
        if (this.model.prefs.tool !== "pen") this.model.setTool("pen");
      } })),
    );
  }
}
