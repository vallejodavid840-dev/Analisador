import type { CharacterMeta } from "@gas/core";
import { characterApi } from "./api";
import { askText, confirmDialog } from "./dialogs";
import { h } from "./dom";
import { openFicha } from "./ficha";
import { icon } from "./editor/icons";

export interface LibraryOptions {
  root: HTMLElement;
  onBack: () => void;
  onOpen: (id: string) => void;
}

/** Biblioteca local de personajes: buscar, organizar en carpetas, editar, duplicar, renombrar, eliminar (con confirmación). */
export async function showLibrary(o: LibraryOptions): Promise<void> {
  let q = "";
  let folder = "";
  const grid = h("ul", { class: "char-grid", "data-testid": "char-grid" });
  const folderSel = h("select", { "data-testid": "lib-folder", "aria-label": "Carpeta" });
  const search = h("input", { type: "search", placeholder: "Buscar por nombre, pandilla, ropa, etiquetas…", "aria-label": "Buscar personajes", "data-testid": "lib-search" });
  const msg = h("p", { class: "msg", role: "alert", "data-testid": "lib-msg" });
  const count = h("span", { class: "meta", "data-testid": "lib-count" });

  const card = (c: CharacterMeta): HTMLElement => {
    const thumb = c.thumbnail ? h("img", { src: c.thumbnail, alt: `Vista frontal de ${c.sheet.name}`, class: "char-thumb" }) : h("div", { class: "char-thumb empty" }, icon("person", 40));
    const act = (label: string, testid: string, fn: () => void | Promise<void>, cls = "") => h("button", { type: "button", class: `btn sm ${cls}`.trim(), "data-testid": testid, onclick: () => void fn() }, label);
    return h("li", { class: "char-card", "data-testid": "char-card", "data-id": c.id },
      thumb,
      h("div", { class: "char-info" },
        h("strong", { "data-testid": "char-name" }, c.sheet.name),
        h("span", { class: "meta" }, [c.sheet.gang, c.sheet.rank].filter(Boolean).join(" · ") || "Sin pandilla"),
        c.folder ? h("span", { class: "chip-mini" }, c.folder) : null,
        ...c.tags.map((t) => h("span", { class: "chip-mini tag" }, t))),
      h("div", { class: "char-actions" },
        act("Editar", "char-edit", () => o.onOpen(c.id), "primary"),
        act("Ficha", "char-sheet", () => openFicha(c.id, () => void refresh())),
        act("Renombrar", "char-rename", async () => {
          const n = await askText("Renombrar personaje", "Nombre", c.sheet.name, "rename");
          if (n?.trim()) await run(() => characterApi.patch(c.id, { sheet: { ...c.sheet, name: n.trim() } }));
        }),
        act("Duplicar", "char-dup", () => run(() => characterApi.duplicate(c.id))),
        act("Carpeta", "char-folder", async () => {
          const f = await askText("Mover a carpeta", "Carpeta (vacío = sin carpeta)", c.folder, "folder");
          if (f !== null) await run(() => characterApi.patch(c.id, { folder: f.trim() }));
        }),
        act("Eliminar", "char-del", async () => {
          if (await confirmDialog("Eliminar personaje", `Se eliminará «${c.sheet.name}» con su dibujo, esqueleto, expresiones y ficha. Los episodios donde ya lo hayas insertado conservan su copia. No se puede deshacer.`, "Eliminar para siempre", "del-confirm")) await run(() => characterApi.remove(c.id));
        }, "danger")));
  };

  async function run(fn: () => Promise<unknown>): Promise<void> {
    msg.textContent = "";
    try {
      await fn();
    } catch (err) {
      msg.textContent = (err as Error).message;
      msg.className = "msg msg-error";
    }
    await refresh();
  }

  async function refresh(): Promise<void> {
    try {
      const r = await characterApi.list(q, folder);
      folderSel.replaceChildren(h("option", { value: "" }, "Todas las carpetas"), ...r.folders.map((f) => h("option", { value: f, selected: f === folder }, f)));
      folderSel.value = folder;
      grid.replaceChildren(...r.characters.map(card));
      count.textContent = `${r.characters.length} personaje${r.characters.length === 1 ? "" : "s"}`;
      if (r.characters.length === 0) grid.append(h("li", { class: "empty", "data-testid": "lib-empty" }, q || folder ? "Ningún personaje coincide con la búsqueda." : "Aún no hay personajes. Crea el primero con «Nuevo personaje»."));
    } catch (err) {
      msg.textContent = `No se pudo cargar la biblioteca: ${(err as Error).message}`;
      msg.className = "msg msg-error";
    }
  }

  let timer = 0;
  search.addEventListener("input", () => { clearTimeout(timer); timer = window.setTimeout(() => { q = search.value; void refresh(); }, 200); });
  folderSel.addEventListener("change", () => { folder = folderSel.value; void refresh(); });

  const create = async () => {
    const n = await askText("Nuevo personaje", "Nombre del personaje", "", "new-char");
    if (!n?.trim()) return;
    try {
      const c = await characterApi.create(n.trim(), folder || undefined);
      o.onOpen(c.id);
    } catch (err) {
      msg.textContent = (err as Error).message;
      msg.className = "msg msg-error";
    }
  };

  o.root.replaceChildren(
    h("div", { class: "shell" },
      h("header", { class: "topbar" }, h("button", { class: "btn", type: "button", "data-testid": "lib-back", onclick: o.onBack }, "← Proyectos"), h("div", { class: "brand" }, h("h1", {}, "Biblioteca de personajes"), h("p", {}, "Diseña una vez, reutiliza en todos los episodios"))),
      h("main", { class: "main" },
        h("section", { class: "panel" },
          h("div", { class: "lib-tools" }, search, folderSel, h("button", { class: "btn btn-primary", type: "button", "data-testid": "char-new", onclick: () => void create() }, "Nuevo personaje"), count),
          msg, grid))));
  await refresh();
}
