import { EMPTY_SHEET, type CharacterMeta, type CharacterSheet } from "@gas/core";
import { characterApi } from "./api";
import { openModal } from "./dialogs";
import { h } from "./dom";

const FIELDS: Array<{ key: keyof CharacterSheet; label: string; kind: "text" | "area"; max?: number }> = [
  { key: "name", label: "Nombre", kind: "text", max: 80 },
  { key: "age", label: "Edad ficticia", kind: "text", max: 20 },
  { key: "height", label: "Altura", kind: "text", max: 20 },
  { key: "gang", label: "Grupo o pandilla", kind: "text", max: 80 },
  { key: "rank", label: "Posición dentro de la pandilla", kind: "text", max: 80 },
  { key: "description", label: "Descripción", kind: "area" },
  { key: "personality", label: "Personalidad", kind: "area" },
  { key: "history", label: "Historia", kind: "area" },
  { key: "relations", label: "Relaciones", kind: "area" },
  { key: "design", label: "Diseño visual", kind: "area" },
  { key: "outfit", label: "Vestimenta habitual", kind: "area" },
];

/** Ficha del personaje: todos los campos son texto libre y editable. Se guarda en la biblioteca. */
export async function openFicha(id: string, onSaved?: (m: CharacterMeta) => void): Promise<void> {
  let meta: CharacterMeta;
  try {
    meta = await characterApi.meta(id);
  } catch (err) {
    alert(`No se pudo abrir la ficha: ${(err as Error).message}`);
    return;
  }
  const inputs = new Map<string, HTMLInputElement | HTMLTextAreaElement>();
  const msg = h("p", { class: "msg", role: "status", "data-testid": "ficha-msg" });
  const fields: Node[] = FIELDS.map((f) => {
    const el = f.kind === "text"
      ? h("input", { type: "text", maxlength: f.max ?? 200, "data-testid": `ficha-${f.key}`, "aria-label": f.label })
      : h("textarea", { rows: 4, maxlength: 8000, "data-testid": `ficha-${f.key}`, "aria-label": f.label });
    el.value = (meta.sheet[f.key] as string) ?? "";
    el.addEventListener("keydown", (e) => e.stopPropagation());
    inputs.set(f.key, el);
    return h("label", { class: "field" }, h("span", {}, f.label), el);
  });
  const folder = h("input", { type: "text", maxlength: 60, value: meta.folder, "data-testid": "ficha-folder", "aria-label": "Carpeta" });
  const tags = h("input", { type: "text", value: meta.tags.join(", "), "data-testid": "ficha-tags", "aria-label": "Etiquetas (separadas por comas)" });
  for (const i of [folder, tags]) i.addEventListener("keydown", (e) => e.stopPropagation());
  const save = async () => {
    const sheet: CharacterSheet = { ...EMPTY_SHEET(meta.sheet.name) };
    for (const [k, el] of inputs) (sheet as unknown as Record<string, string>)[k] = el.value;
    if (!sheet.name.trim()) { msg.textContent = "El nombre no puede estar vacío."; msg.className = "msg msg-error"; return; }
    try {
      meta = await characterApi.patch(id, { sheet, folder: folder.value, tags: tags.value.split(",").map((t) => t.trim()).filter(Boolean) });
      msg.textContent = "Ficha guardada.";
      msg.className = "msg";
      onSaved?.(meta);
    } catch (err) {
      msg.textContent = `No se pudo guardar: ${(err as Error).message}`;
      msg.className = "msg msg-error";
    }
  };
  openModal(`Ficha: ${meta.sheet.name}`, "ficha-dialog", [
    ...fields,
    h("label", { class: "field" }, h("span", {}, "Carpeta"), folder),
    h("label", { class: "field" }, h("span", {}, "Etiquetas (separadas por comas)"), tags),
    msg,
    h("div", { class: "row" }, h("button", { type: "button", class: "btn btn-primary big", "data-testid": "ficha-save", onclick: () => void save() }, "Guardar ficha")),
  ], { wide: true });
}
