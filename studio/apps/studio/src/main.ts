import { FPS_PRESETS, addEpisode, addSeason, type Project } from "@gas/core";
import { api, type ApiError, type SummaryRow } from "./api";
import { h } from "./dom";
import { es } from "./es";
import { logoMark } from "./logo";
import "./styles.css";

const root = document.getElementById("app") as HTMLElement;

/** Proyecto abierto y su copia guardada, para saber si hay cambios sin guardar. */
let current: { project: Project; savedJson: string } | null = null;
const isDirty = () => current !== null && JSON.stringify(current.project) !== current.savedJson;

window.addEventListener("beforeunload", (e) => {
  if (isDirty()) e.preventDefault();
});

function shell(...content: (Node | null)[]): HTMLElement {
  return h(
    "div",
    { class: "shell" },
    h(
      "header",
      { class: "topbar" },
      logoMark(),
      h("div", { class: "brand" }, h("h1", {}, es.appName), h("p", {}, es.tagline)),
    ),
    h("main", { class: "main" }, ...content.filter((n): n is Node => n !== null)),
    h("footer", { class: "foot" }, es.phase),
  );
}

function render(node: HTMLElement): void {
  root.replaceChildren(node);
}

function errorBox(message: string): HTMLElement {
  return h("p", { class: "msg msg-error", role: "alert" }, message);
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" });

/* ───────────── Inicio: lista de proyectos + nuevo proyecto ───────────── */

async function showHome(note?: string): Promise<void> {
  if (isDirty() && !confirm(es.leaveWarning)) return;
  current = null;
  let rows: SummaryRow[] = [];
  let loadError: string | undefined;
  try {
    rows = await api.list();
  } catch (e) {
    loadError = `${es.loadError}: ${(e as Error).message}`;
  }

  const list = h("ul", { class: "project-list", "data-testid": "project-list" });
  for (const row of rows) {
    if (row.summary) {
      const s = row.summary;
      list.append(
        h(
          "li",
          { class: "project-card" },
          h(
            "div",
            { class: "project-info" },
            h("strong", {}, s.name),
            h(
              "span",
              { class: "meta" },
              `${s.fps} FPS · ${es.seasonsCount(s.seasons)} · ${es.episodes(s.episodes)} · ${es.updated} ${fmtDate(s.updatedAt)}`,
            ),
          ),
          h("button", { class: "btn", type: "button", onclick: () => void openProject(s.id) }, es.open),
        ),
      );
    } else if (row.error) {
      list.append(
        h(
          "li",
          { class: "project-card broken" },
          h("div", { class: "project-info" }, h("strong", {}, row.error.id), h("span", { class: "meta" }, `${es.brokenProject}: ${row.error.message}`)),
        ),
      );
    }
  }

  const nameInput = h("input", { id: "p-name", name: "name", type: "text", maxlength: 120, placeholder: es.projectNamePlaceholder, autocomplete: "off", required: true });
  const fpsSelect = h("select", { id: "p-fps", name: "fps" }, ...FPS_PRESETS.map((f) => h("option", { value: f, selected: f === 24 }, `${f} FPS`)));
  const resSelect = h("select", { id: "p-res", name: "res" }, ...Object.entries(es.res).map(([v, label]) => h("option", { value: v }, label)));
  const formMsg = h("div", { "data-testid": "form-msg" });
  const form = h(
    "form",
    { class: "panel form", novalidate: true, onsubmit: (e) => void onCreate(e) },
    h("h2", {}, es.newProject),
    h("label", { for: "p-name" }, es.projectName),
    nameInput,
    h("label", { for: "p-fps" }, es.fps),
    fpsSelect,
    h("p", { class: "hint" }, es.fpsHint),
    h("label", { for: "p-res" }, es.resolution),
    resSelect,
    formMsg,
    h("button", { class: "btn btn-primary", type: "submit" }, es.create),
  );

  async function onCreate(e: Event): Promise<void> {
    e.preventDefault();
    formMsg.replaceChildren();
    if (!nameInput.value.trim()) {
      formMsg.append(errorBox(es.nameRequired));
      return;
    }
    const [w, hh] = resSelect.value.split("x").map(Number);
    try {
      const p = await api.create({ name: nameInput.value, settings: { fps: Number(fpsSelect.value), width: w!, height: hh! } });
      await openProject(p.id);
    } catch (err) {
      formMsg.append(errorBox((err as Error).message));
    }
  }

  render(
    shell(
      h(
        "section",
        { class: "panel" },
        h("h2", {}, es.projects),
        note ? h("p", { class: "msg" }, note) : null,
        loadError ? errorBox(loadError) : null,
        rows.length ? list : loadError ? null : h("p", { class: "empty" }, es.noProjects),
      ),
      form,
    ),
  );
}

/* ───────────── Proyecto abierto ───────────── */

async function openProject(id: string): Promise<void> {
  try {
    const project = await api.load(id);
    current = { project, savedJson: JSON.stringify(project) };
    showProject();
  } catch (err) {
    await showHome(`${es.loadError}: ${(err as Error).message}`);
  }
}

function showProject(status?: { text: string; error?: boolean }): void {
  if (!current) return;
  const c = current;
  const p = c.project;
  const update = (next: Project, rerender = false) => {
    c.project = next;
    if (rerender) showProject();
    else refreshSaveBar();
  };

  const saveMsg = h("span", { class: "save-state", "data-testid": "save-state", role: "status" });
  const saveBtn = h("button", { class: "btn btn-primary", type: "button", "data-testid": "save", onclick: () => void doSave() }, es.save);
  const extra = h("div", { class: "save-extra" });

  function refreshSaveBar(): void {
    const dirty = isDirty();
    const nameOk = c.project.name.trim().length > 0;
    saveBtn.toggleAttribute("disabled", !dirty || !nameOk);
    if (!nameOk) saveMsg.textContent = es.nameRequired;
    else saveMsg.textContent = dirty ? es.unsaved : es.saved;
    saveMsg.className = `save-state ${dirty ? "dirty" : "clean"}`;
  }

  async function doSave(): Promise<void> {
    saveBtn.setAttribute("disabled", "");
    saveMsg.textContent = es.saving;
    extra.replaceChildren();
    try {
      const saved = await api.save({ ...c.project, name: c.project.name.trim() });
      current = { project: saved, savedJson: JSON.stringify(saved) };
      showProject({ text: es.saved });
    } catch (err) {
      const e = err as ApiError;
      extra.append(errorBox(e.message));
      if (e.status === 409) extra.append(h("button", { class: "btn", type: "button", onclick: () => void reloadFromDisk() }, es.reload));
      refreshSaveBar();
    }
  }

  async function reloadFromDisk(): Promise<void> {
    current = null;
    await openProject(p.id);
  }

  const nameInput = h("input", { id: "proj-name", type: "text", maxlength: 120, value: p.name, "data-testid": "proj-name", oninput: (e) => update({ ...c.project, name: (e.target as HTMLInputElement).value }) });

  const seasonsEl = h("div", { class: "seasons" });
  if (p.seasons.length === 0) seasonsEl.append(h("p", { class: "empty" }, es.noSeasons));
  for (const s of p.seasons) {
    const ep = h("ol", { class: "episodes" });
    if (s.episodes.length === 0) ep.append(h("li", { class: "empty" }, es.noEpisodes));
    for (const e of s.episodes) {
      ep.append(
        h("li", {}, h("input", { type: "text", maxlength: 120, value: e.title, "aria-label": es.episodeTitle, "data-testid": "episode-title", oninput: (ev) => {
          const title = (ev.target as HTMLInputElement).value;
          update({ ...c.project, seasons: c.project.seasons.map((x) => x.id === s.id ? { ...x, episodes: x.episodes.map((y) => y.id === e.id ? { ...y, title } : y) } : x) });
        } })),
      );
    }
    seasonsEl.append(
      h(
        "section",
        { class: "season", "data-testid": "season" },
        h("div", { class: "season-head" },
          h("input", { type: "text", maxlength: 120, value: s.name, "aria-label": es.seasonName, "data-testid": "season-name", oninput: (ev) => {
            const name = (ev.target as HTMLInputElement).value;
            update({ ...c.project, seasons: c.project.seasons.map((x) => (x.id === s.id ? { ...x, name } : x)) });
          } }),
          h("button", { class: "btn", type: "button", "data-testid": "add-episode", onclick: () => update(addEpisode(c.project, s.id), true) }, es.addEpisode),
        ),
        ep,
      ),
    );
  }

  render(
    shell(
      h("div", { class: "project-head" },
        h("button", { class: "btn", type: "button", onclick: () => void showHome() }, es.back),
        h("div", { class: "save-bar" }, saveMsg, saveBtn),
      ),
      extra,
      status?.error ? errorBox(status.text) : null,
      h("section", { class: "panel" },
        h("label", { for: "proj-name" }, es.projectName),
        nameInput,
        h("dl", { class: "settings" },
          h("div", {}, h("dt", {}, es.fps), h("dd", {}, h("select", { "aria-label": es.fps, "data-testid": "proj-fps", onchange: (e) => update({ ...c.project, settings: { ...c.project.settings, fps: Number((e.target as HTMLSelectElement).value) } }) },
            ...[...new Set<number>([...FPS_PRESETS, p.settings.fps])].sort((a, b) => a - b).map((f) => h("option", { value: f, selected: f === p.settings.fps }, `${f} FPS`))))),
          h("div", {}, h("dt", {}, es.resolution), h("dd", {}, `${p.settings.width}×${p.settings.height}`)),
        ),
      ),
      h("section", { class: "panel" },
        h("div", { class: "season-head" }, h("h2", {}, es.seasons), h("button", { class: "btn", type: "button", "data-testid": "add-season", onclick: () => update(addSeason(c.project), true) }, es.addSeason)),
        seasonsEl,
      ),
    ),
  );
  refreshSaveBar();
  if (status && !status.error) saveMsg.textContent = status.text;
}

void showHome();
