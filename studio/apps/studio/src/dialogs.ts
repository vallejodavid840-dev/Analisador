import { h } from "./dom";
import { icon } from "./editor/icons";

export interface ModalHandle {
  close: () => void;
  body: HTMLElement;
}

/** Ventana modal accesible (Esc cierra, foco al abrir). Reutiliza el estilo de la ventana de exportación. */
export function openModal(title: string, testid: string, content: Node[], o: { onClose?: () => void; wide?: boolean } = {}): ModalHandle {
  const body = h("div", { class: "modal-body" }, ...content);
  const closeBtn = h("button", { type: "button", class: "ibtn", "aria-label": "Cerrar", title: "Cerrar", "data-testid": `${testid}-close`, onclick: () => close() }, icon("close", 20));
  const panel = h("div", { class: "modal-panel", role: "dialog", "aria-modal": "true", "aria-label": title, "data-testid": testid, ...(o.wide ? { style: "width:min(860px,100%)" } : {}) },
    h("header", { class: "modal-head" }, icon("person", 22), h("h2", {}, title), closeBtn), body);
  const backdrop = h("div", { class: "modal-backdrop" }, panel);
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    window.removeEventListener("keydown", onKey, true);
    backdrop.remove();
    o.onClose?.();
  }
  window.addEventListener("keydown", onKey, true);
  document.body.append(backdrop);
  queueMicrotask(() => (panel.querySelector("input,select,textarea,button.btn") as HTMLElement | null)?.focus());
  return { close, body };
}

/** Pide un texto (nombre, carpeta…). Devuelve null si se cancela. */
export function askText(title: string, label: string, value = "", testid = "ask"): Promise<string | null> {
  return new Promise((resolve) => {
    const input = h("input", { type: "text", maxlength: 80, value, "data-testid": `${testid}-input`, "aria-label": label });
    let done = false;
    const finish = (v: string | null) => { if (done) return; done = true; m.close(); resolve(v); };
    const m = openModal(title, testid, [
      h("label", { class: "field" }, h("span", {}, label), input),
      h("div", { class: "row" }, h("button", { type: "button", class: "btn btn-primary big", "data-testid": `${testid}-ok`, onclick: () => finish(input.value) }, "Aceptar"), h("button", { type: "button", class: "btn big", "data-testid": `${testid}-cancel`, onclick: () => finish(null) }, "Cancelar")),
    ], { onClose: () => finish(null) });
    input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") finish(input.value); });
    input.select();
  });
}

/** Confirmación explícita (acciones destructivas). */
export function confirmDialog(title: string, message: string, okLabel: string, testid = "confirm"): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => { if (done) return; done = true; m.close(); resolve(v); };
    const m = openModal(title, testid, [
      h("p", {}, message),
      h("div", { class: "row" }, h("button", { type: "button", class: "btn btn-primary big", "data-testid": `${testid}-ok`, onclick: () => finish(true) }, okLabel), h("button", { type: "button", class: "btn big", "data-testid": `${testid}-cancel`, onclick: () => finish(false) }, "Cancelar")),
    ], { onClose: () => finish(false) });
  });
}
