import { h } from "../dom";
import { icon, type IconName } from "./icons";

export interface BtnOpts {
  testid?: string;
  cls?: string;
  pressed?: boolean;
  text?: string;
}

/** Botón de icono accesible: siempre lleva nombre en español (aria-label + title). */
export function iconBtn(name: IconName, label: string, onclick: () => void, o: BtnOpts = {}): HTMLButtonElement {
  const b = h("button", {
    type: "button",
    class: `ibtn ${o.cls ?? ""}`.trim(),
    "aria-label": label,
    title: label,
    "data-testid": o.testid,
    "aria-pressed": o.pressed === undefined ? undefined : String(o.pressed),
    onclick: () => onclick(),
  });
  b.append(icon(name, 22));
  if (o.text) b.append(h("span", { class: "ibtn-text" }, o.text));
  return b;
}

export function setPressed(b: HTMLElement, on: boolean): void {
  b.setAttribute("aria-pressed", String(on));
  b.classList.toggle("on", on);
}

export function setDisabled(b: HTMLElement, off: boolean): void {
  b.toggleAttribute("disabled", off);
}

export function stepper(opts: {
  label: string;
  min: number;
  max: number;
  value: () => number;
  set: (n: number) => void;
  testid: string;
  lessLabel: string;
  moreLabel: string;
}): { el: HTMLElement; refresh: () => void } {
  const out = h("output", { class: "step-val", "data-testid": `${opts.testid}-val`, "aria-live": "polite" });
  const less = iconBtn("minus", opts.lessLabel, () => opts.set(Math.max(opts.min, opts.value() - 1)), { testid: `${opts.testid}-less`, cls: "small" });
  const more = iconBtn("plus", opts.moreLabel, () => opts.set(Math.min(opts.max, opts.value() + 1)), { testid: `${opts.testid}-more`, cls: "small" });
  const el = h("div", { class: "stepper", role: "group", "aria-label": opts.label }, h("span", { class: "step-label" }, opts.label), less, out, more);
  const refresh = () => {
    out.textContent = String(opts.value());
    setDisabled(less, opts.value() <= opts.min);
    setDisabled(more, opts.value() >= opts.max);
  };
  refresh();
  return { el, refresh };
}
