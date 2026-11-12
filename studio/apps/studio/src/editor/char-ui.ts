import { h } from "../dom";

/* Pequeños constructores de formulario para los paneles de personaje (táctiles: ≥44 px, etiquetas en español). */

export interface Field {
  el: HTMLElement;
  refresh: () => void;
}

export function section(title: string, testid: string, open: boolean, ...children: Array<Node | null | false>): HTMLDetailsElement {
  const d = h("details", { class: "cp-sec", "data-testid": testid }, h("summary", {}, title), h("div", { class: "cp-body" }, ...children.filter((c): c is Node => !!c)));
  if (open) d.setAttribute("open", "");
  return d;
}

export function rangeField(label: string, testid: string, o: { min: number; max: number; step: number; digits?: number }, get: () => number, onCommit: (v: number) => void): Field {
  const out = h("output", { class: "cp-val", "data-testid": `${testid}-val` });
  const input = h("input", { type: "range", min: o.min, max: o.max, step: o.step, "data-testid": testid, "aria-label": label });
  const show = () => (out.textContent = (+input.value).toFixed(o.digits ?? (o.step < 1 ? 2 : 0)));
  input.addEventListener("input", show);
  input.addEventListener("change", () => onCommit(Number(input.value)));
  input.addEventListener("keydown", (e) => e.stopPropagation());
  const el = h("label", { class: "field cp-range" }, h("span", {}, label, out), input);
  return {
    el,
    refresh: () => {
      if (document.activeElement !== input) input.value = String(get());
      show();
    },
  };
}

export function selectField(label: string, testid: string, options: ReadonlyArray<[string, string]>, get: () => string, onChange: (v: string) => void): Field {
  const sel = h("select", { "data-testid": testid, "aria-label": label }, ...options.map(([v, l]) => h("option", { value: v }, l)));
  sel.addEventListener("change", () => onChange(sel.value));
  sel.addEventListener("keydown", (e) => e.stopPropagation());
  return { el: h("label", { class: "field" }, h("span", {}, label), sel), refresh: () => { if (document.activeElement !== sel) sel.value = get(); } };
}

export function checkField(label: string, testid: string, get: () => boolean, onChange: (v: boolean) => void): Field {
  const cb = h("input", { type: "checkbox", "data-testid": testid });
  cb.addEventListener("change", () => onChange(cb.checked));
  return { el: h("label", { class: "infl-row cp-check" }, cb, h("span", {}, label)), refresh: () => { cb.checked = get(); } };
}

/** Color: selector nativo + hexadecimal editable + paleta de muestras. `onCommit` solo con un color válido. */
export function colorField(label: string, testid: string, swatches: readonly string[], get: () => string, onCommit: (hex: string) => void): Field {
  const native = h("input", { type: "color", "data-testid": `${testid}-native`, "aria-label": label });
  const hex = h("input", { type: "text", maxlength: 7, spellcheck: false, autocomplete: "off", class: "cp-hex", "data-testid": testid, "aria-label": `${label} (hexadecimal)` });
  const ok = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);
  const commit = (v: string) => { if (ok(v)) onCommit(v.toLowerCase()); };
  native.addEventListener("change", () => { hex.value = native.value; commit(native.value); });
  hex.addEventListener("change", () => commit(hex.value.startsWith("#") ? hex.value : `#${hex.value}`));
  hex.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") hex.blur(); });
  const row = h("div", { class: "cp-swatches", role: "group", "aria-label": `${label}: muestras` }, ...swatches.map((c) => {
    const b = h("button", { type: "button", class: "swatch", style: `background:${c}`, "aria-label": `${label} ${c}`, title: c, "data-testid": `${testid}-sw`, onclick: () => commit(c) });
    return b;
  }));
  const el = h("div", { class: "field cp-color" }, h("span", {}, label), h("div", { class: "cp-color-row" }, native, hex), row);
  return { el, refresh: () => { const v = get(); if (document.activeElement !== hex) hex.value = v; native.value = v; } };
}

export const btn = (label: string, testid: string, onclick: () => void, cls = ""): HTMLButtonElement => h("button", { type: "button", class: `btn sm ${cls}`.trim(), "data-testid": testid, onclick }, label);
export const row = (...c: Node[]) => h("div", { class: "row" }, ...c);
export const hint = (t: string) => h("p", { class: "hint" }, t);
export const sub = (t: string) => h("h4", {}, t);
