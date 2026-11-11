import type { ExportFileDTO, ExportFormat, ExportJobDTO, ExportOptions, ExportCapabilitiesDTO, Quality, ResolutionSpec } from "@gas/core";
import { FPS_PRESETS } from "@gas/core";
import { outputSize, planFrames, sanitizeFileName, FORMAT_EXT, supportsAlpha } from "@gas/export/plan";
import { exportApi, type ExportApiError } from "../api";
import { h } from "../dom";
import { es } from "../es";
import { icon } from "./icons";
import type { AutoSave } from "./autosave";
import type { EditorModel } from "./model";

const X = es.exp;
const FORMATS: ExportFormat[] = ["mp4", "webm", "png-seq", "png"];
const RES: Array<{ key: string; label: string; spec: ResolutionSpec }> = [
  { key: "original", label: X.original, spec: { kind: "original" } },
  { key: "480", label: "480p", spec: { kind: "short-side", px: 480 } },
  { key: "720", label: "720p", spec: { kind: "short-side", px: 720 } },
  { key: "1080", label: "1080p", spec: { kind: "short-side", px: 1080 } },
  { key: "1440", label: "1440p (2K)", spec: { kind: "short-side", px: 1440 } },
  { key: "2160", label: "2160p (4K)", spec: { kind: "short-side", px: 2160 } },
];
const PREFS_KEY = "gas.export.v1";

interface Form {
  format: ExportFormat;
  res: string;
  fps: "same" | number;
  quality: Quality;
  bg: "white" | "color" | "transparent";
  bgColor: string;
  fileName: string;
}

export interface ExportDialogOptions {
  projectId: string;
  episodeId: string;
  episodeTitle: string;
  model: EditorModel;
  autosave: AutoSave;
  onClose: () => void;
}

const fmtBytes = (n: number) => (n >= 2 ** 20 ? `${(n / 2 ** 20).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fmtSecs = (s: number) => s.toFixed(2).replace(".", ",");

function loadForm(title: string): Form {
  const base: Form = { format: "mp4", res: "original", fps: "same", quality: "high", bg: "white", bgColor: "#101018", fileName: title };
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Partial<Form> | null;
    if (raw) return { ...base, ...raw, fileName: title };
  } catch {
    /* sin preferencias guardadas */
  }
  return base;
}

/** Ventana de exportación: opciones, progreso real, cancelación y acceso al archivo. Devuelve su función de cierre. */
export async function openExportDialog(o: ExportDialogOptions): Promise<() => void> {
  const { model } = o;
  const form = loadForm(o.episodeTitle);
  let caps: ExportCapabilitiesDTO | null = null;
  try {
    caps = await exportApi.capabilities();
  } catch {
    caps = null;
  }
  const available = (f: ExportFormat) => (caps ? caps.formats[f].available : f === "png" || f === "png-seq");
  if (!available(form.format)) form.format = FORMATS.find(available) ?? "png";
  if (form.bg === "transparent" && !supportsAlpha(form.format)) form.bg = "white";

  let job: ExportJobDTO | null = null;
  let poll = 0;
  let closed = false;
  let startedAt = 0;
  let conflict: { name: string; suggestion: string } | null = null;
  let error: string | null = null;
  let notice: string | null = null;
  let saving = false;
  let previous: ExportFileDTO[] = [];

  const body = h("div", { class: "modal-body" });
  const titleEl = h("h2", { id: "export-title" }, X.title);
  const closeBtn = h("button", { type: "button", class: "ibtn", "aria-label": X.close, title: X.close, "data-testid": "export-close", onclick: () => close() }, icon("close", 22));
  const panel = h("div", { class: "modal-panel", role: "dialog", "aria-modal": "true", "aria-labelledby": "export-title", "data-testid": "export-dialog" },
    h("header", { class: "modal-head" }, icon("film", 22), titleEl, closeBtn), body);
  const backdrop = h("div", { class: "modal-backdrop" }, panel);
  backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) close(); });
  panel.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); e.stopPropagation(); });
  document.body.append(backdrop);

  function close(): void {
    if (closed) return;
    closed = true;
    clearInterval(poll);
    backdrop.remove();
    o.onClose();
  }

  const active = () => job !== null && (job.state === "queued" || job.state === "running");

  /* ───────── cálculos ───────── */
  function computed() {
    const doc = model.doc;
    const res = RES.find((r) => r.key === form.res)!.spec;
    const fps = form.fps === "same" ? doc.fps : form.fps;
    try {
      const size = outputSize(doc, res, form.format);
      if (form.format === "png") return { size, text: X.summaryPng(model.frameIndex + 1, doc.frames.length, size.width, size.height), fps };
      const plan = planFrames(doc, fps);
      return { size, text: X.summaryVideo(plan.runs.length, plan.totalFrames, fps, fmtSecs(plan.durationSec), size.width, size.height), fps };
    } catch {
      return { size: { width: 0, height: 0 }, text: "", fps };
    }
  }

  function options(extra: Partial<ExportOptions> = {}): ExportOptions {
    return {
      format: form.format,
      fileName: form.fileName,
      resolution: RES.find((r) => r.key === form.res)!.spec,
      ...(form.format !== "png" ? { fps: form.fps === "same" ? model.doc.fps : form.fps } : {}),
      quality: form.quality,
      background: { transparent: form.bg === "transparent", color: form.bg === "white" ? "#ffffff" : form.bgColor },
      ...(form.format === "png" ? { frameIndex: model.frameIndex } : {}),
      ...extra,
    };
  }

  /* ───────── vistas ───────── */
  function render(): void {
    body.replaceChildren(...(job && job.state === "done" ? doneView() : active() ? runningView() : formView()));
    if (job && job.state === "running") updateProgress();
  }

  function field(label: string, control: Node, hint?: string): HTMLElement {
    return h("div", { class: "field" }, h("label", {}, label), control, hint ? h("p", { class: "hint" }, hint) : null);
  }

  function formView(): Node[] {
    const c = computed();
    const isVideo = form.format === "mp4" || form.format === "webm";
    const isPng = form.format === "png";

    const seg = h("div", { class: "seg", role: "radiogroup", "aria-label": X.format });
    for (const f of FORMATS) {
      const ok = available(f);
      const reason = caps?.formats[f].reason ?? X.unavailable;
      seg.append(h("button", {
        type: "button", class: `seg-opt ${form.format === f ? "on" : ""}`, role: "radio", "aria-checked": String(form.format === f), disabled: !ok, title: ok ? undefined : reason,
        "data-testid": `export-format-${f}`,
        onclick: () => { form.format = f; if (form.bg === "transparent" && !supportsAlpha(f)) form.bg = "white"; save(); render(); },
      }, h("strong", {}, X.formats[f]!.name), h("span", {}, ok ? X.formats[f]!.desc : `${X.unavailable}. ${reason}`)));
    }

    const resSel = h("select", { "data-testid": "export-resolution", "aria-label": X.resolution, onchange: (e) => { form.res = (e.target as HTMLSelectElement).value; save(); render(); } },
      ...RES.map((r) => { let t = r.label; try { const s = outputSize(model.doc, r.spec, form.format); t = `${r.label} (${s.width}×${s.height})`; } catch { /* tamaño no válido */ } return h("option", { value: r.key, selected: r.key === form.res }, t); }));

    const presets = [...new Set<number>([...FPS_PRESETS, model.doc.fps])].sort((a, b) => a - b);
    const fpsSel = h("select", { "data-testid": "export-fps", "aria-label": X.fps, onchange: (e) => { const v = (e.target as HTMLSelectElement).value; form.fps = v === "same" ? "same" : Number(v); save(); render(); } },
      h("option", { value: "same", selected: form.fps === "same" }, X.fpsSame(model.doc.fps)),
      ...presets.map((f) => h("option", { value: f, selected: form.fps === f }, `${f} FPS`)));

    const qSel = h("select", { "data-testid": "export-quality", "aria-label": X.quality, onchange: (e) => { form.quality = (e.target as HTMLSelectElement).value as Quality; save(); } },
      ...(["low", "medium", "high", "max"] as const).map((q) => h("option", { value: q, selected: form.quality === q }, X.qualities[q]!)));

    const bgBtn = (k: Form["bg"], label: string, disabled = false) => h("button", { type: "button", class: `chip ${form.bg === k ? "on" : ""}`, role: "radio", "aria-checked": String(form.bg === k), disabled, "data-testid": `export-bg-${k}`, title: disabled ? X.bgNoAlpha : undefined, onclick: () => { form.bg = k; save(); render(); } }, label);
    const colorIn = h("input", { type: "color", class: "color-picker", value: form.bgColor, "aria-label": X.bgColor, "data-testid": "export-bg-color", oninput: (e) => { form.bgColor = (e.target as HTMLInputElement).value; form.bg = "color"; save(); } });
    const bgRow = h("div", { class: "chips", role: "radiogroup", "aria-label": X.background }, bgBtn("white", X.bgWhite), bgBtn("color", X.bgColor), colorIn, bgBtn("transparent", X.bgTransparent, !supportsAlpha(form.format)));

    const nameIn = h("input", { type: "text", id: "export-name", value: form.fileName, maxlength: 100, autocomplete: "off", spellcheck: "false", "aria-label": X.fileName, "data-testid": "export-name", oninput: (e) => { form.fileName = (e.target as HTMLInputElement).value; conflict = null; refreshStart(); } });
    const nameRow = h("div", { class: "name-row" }, nameIn, h("span", { class: "ext" }, `.${FORMAT_EXT[form.format]}`));

    const startBtn = h("button", { type: "button", class: "btn btn-primary big", "data-testid": "export-start", onclick: () => void start() }, saving ? X.saving : X.start);
    const refreshStart = () => { startBtn.toggleAttribute("disabled", saving || form.fileName.trim().length === 0 || !available(form.format)); };
    refreshStart();

    const out: Node[] = [h("div", { class: "field" }, h("label", {}, X.format), seg)];
    out.push(field(X.fileName, nameRow));
    out.push(h("div", { class: "grid2" }, field(X.resolution, resSel), isPng ? null : field(X.fps, fpsSel)));
    if (isVideo) out.push(field(X.quality, qSel));
    out.push(field(X.background, bgRow, !supportsAlpha(form.format) ? X.bgNoAlpha : undefined));
    out.push(h("p", { class: "summary", "data-testid": "export-summary" }, c.text));
    if (notice) out.push(h("p", { class: "msg", role: "status" }, notice));
    if (error) out.push(h("p", { class: "msg msg-error", role: "alert", "data-testid": "export-error" }, error));
    if (conflict) {
      const cf = conflict;
      out.push(h("div", { class: "msg msg-warn", role: "alert", "data-testid": "export-exists" },
        h("p", {}, X.exists(cf.name)),
        h("div", { class: "row" },
          h("button", { type: "button", class: "btn", "data-testid": "export-rename", onclick: () => void start({ autoRename: true }) }, X.useSuggestion(cf.suggestion)),
          h("button", { type: "button", class: "btn", "data-testid": "export-overwrite", onclick: () => void start({ overwrite: true }) }, X.overwrite),
          h("button", { type: "button", class: "btn", onclick: () => { conflict = null; render(); nameIn.focus(); } }, X.changeName))));
    }
    out.push(h("div", { class: "modal-foot" }, startBtn));
    out.push(previousList());
    return out;
  }

  function previousList(): Node {
    const wrap = h("section", { class: "prev" }, h("h3", {}, X.previous));
    if (previous.length === 0) {
      wrap.append(h("p", { class: "hint" }, X.noPrevious));
      return wrap;
    }
    const ul = h("ul", { "data-testid": "export-previous" });
    for (const f of previous.slice(0, 8)) {
      ul.append(h("li", {}, h("a", { href: exportApi.fileUrl(o.projectId, f.name), download: f.name, "data-testid": "export-prev-link" }, icon("download", 18), h("span", {}, f.name)), h("span", { class: "meta" }, fmtBytes(f.bytes))));
    }
    wrap.append(ul);
    return wrap;
  }

  let barEl: HTMLElement | null = null;
  let barFill: HTMLElement | null = null;
  let statusEl: HTMLElement | null = null;
  let pctEl: HTMLElement | null = null;
  let timeEl: HTMLElement | null = null;
  let cancelBtn: HTMLButtonElement | null = null;
  let cancelling = false;

  function runningView(): Node[] {
    barFill = h("div", { class: "bar-fill" });
    barEl = h("div", { class: "bar", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": 0, "aria-label": "Progreso de la exportación", "data-testid": "export-progress" }, barFill);
    statusEl = h("p", { class: "status", role: "status", "aria-live": "polite", "data-testid": "export-status" });
    pctEl = h("span", { class: "pct", "data-testid": "export-pct" });
    timeEl = h("span", { class: "meta" });
    cancelBtn = h("button", { type: "button", class: "btn", "data-testid": "export-cancel", onclick: () => void cancel() }, cancelling ? X.cancelling : X.cancel) as HTMLButtonElement;
    cancelBtn.toggleAttribute("disabled", cancelling);
    return [
      h("p", { class: "run-name" }, job!.fileName),
      h("div", { class: "run-top" }, statusEl, pctEl),
      barEl,
      h("div", { class: "run-bottom" }, timeEl, cancelBtn),
      h("p", { class: "hint" }, X.closeNote),
    ];
  }

  function progressFraction(j: ExportJobDTO): number {
    if (j.phase === "done") return 1;
    if (j.phase === "validating") return 0.98;
    if (j.phase === "finalizing") return 0.96;
    if (j.phase === "rendering" && j.total > 0) return Math.min(0.95, (j.done / j.total) * 0.95);
    return 0;
  }

  function updateProgress(): void {
    if (!job || !barEl || !barFill || !statusEl || !pctEl || !timeEl) return;
    const f = progressFraction(job);
    const pct = Math.round(f * 100);
    barFill.style.width = `${pct}%`;
    barEl.setAttribute("aria-valuenow", String(pct));
    pctEl.textContent = `${pct} %`;
    statusEl.textContent = cancelling ? X.cancelling : job.state === "queued" ? X.phases["queued"]! : job.phase === "rendering" ? X.rendering(job.done, job.total) : X.phases[job.phase] ?? "";
    timeEl.textContent = X.elapsed(Math.round((Date.now() - startedAt) / 1000));
  }

  function doneView(): Node[] {
    const r = job!.result!;
    const url = exportApi.fileUrl(o.projectId, r.fileName);
    const inline = exportApi.fileUrl(o.projectId, r.fileName, true);
    const ext = r.fileName.split(".").pop()!.toLowerCase();
    const out: Node[] = [
      h("div", { class: "done-head" }, icon("film", 28), h("div", {}, h("strong", { "data-testid": "export-done" }, X.done), h("p", { class: "meta", "data-testid": "export-result" }, X.doneInfo(r.fileName, fmtBytes(r.bytes), r.width, r.height, r.durationSec > 0 ? fmtSecs(r.durationSec) : "")))),
      h("div", { class: "row" },
        h("a", { class: "btn btn-primary big", href: url, download: r.fileName, "data-testid": "export-download" }, icon("download", 20), h("span", {}, X.download)),
        h("button", { type: "button", class: "btn big", "data-testid": "export-new", onclick: () => { job = null; error = null; notice = null; void refreshPrevious().then(render); } }, X.newExport)),
    ];
    if (ext === "mp4" || ext === "webm") {
      const mime = ext === "mp4" ? "video/mp4" : "video/webm";
      if (document.createElement("video").canPlayType(mime)) out.push(h("video", { class: "preview", controls: true, playsinline: true, preload: "metadata", src: inline, "data-testid": "export-preview" }));
      else out.push(h("p", { class: "hint", "data-testid": "export-nopreview" }, X.noPreview));
    } else if (ext === "png") out.push(h("img", { class: "preview", src: inline, alt: X.preview, "data-testid": "export-preview" }));
    out.push(previousList());
    return out;
  }

  /* ───────── acciones ───────── */
  function save(): void {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ format: form.format, res: form.res, fps: form.fps, quality: form.quality, bg: form.bg, bgColor: form.bgColor })); } catch { /* sin almacenamiento */ }
  }

  async function refreshPrevious(): Promise<void> {
    try { previous = (await exportApi.list(o.projectId, o.episodeId)).files; } catch { previous = []; }
  }

  /** Exportar usa lo GUARDADO: antes se asegura de que el editor ha guardado hasta el último trazo. */
  async function ensureSaved(): Promise<boolean> {
    const a = o.autosave;
    const t0 = Date.now();
    while (Date.now() - t0 < 20_000) {
      if (a.status === "conflict") return false;
      if (!a.dirty && a.status === "saved") return true;
      if (!a.dirty && a.status !== "saving") return true;
      await a.save();
      if (a.status === "saving" || a.dirty) await new Promise((r) => setTimeout(r, 150));
    }
    return !a.dirty;
  }

  async function start(extra: Partial<ExportOptions> = {}): Promise<void> {
    error = null; notice = null; conflict = null; saving = true; render();
    try {
      if (!(await ensureSaved())) { saving = false; error = X.saveFailed; render(); return; }
      try { sanitizeFileName(form.fileName, form.format); } catch (e) { saving = false; error = (e as Error).message; render(); return; }
      saving = false;
      job = await exportApi.start(o.projectId, o.episodeId, options(extra));
      startedAt = Date.now();
      cancelling = false;
      watch();
      render();
    } catch (e) {
      saving = false;
      job = null;
      const err = e as ExportApiError;
      if (err.code === "file-exists" && err.suggestion) conflict = { name: sanitizeFileName(form.fileName, form.format), suggestion: err.suggestion };
      else error = err.message;
      render();
    }
  }

  function watch(): void {
    clearInterval(poll);
    poll = window.setInterval(async () => {
      if (!job || closed) return;
      try {
        const j = await exportApi.job(job.id);
        job = j;
        if (j.state === "done") { clearInterval(poll); await refreshPrevious(); render(); }
        else if (j.state === "error") { clearInterval(poll); error = j.error?.message ?? X.failed; job = null; await refreshPrevious(); render(); }
        else if (j.state === "cancelled") { clearInterval(poll); notice = X.cancelled; job = null; cancelling = false; await refreshPrevious(); render(); }
        else updateProgress();
      } catch { /* un fallo de red puntual: se reintenta en el siguiente ciclo */ }
    }, 350);
  }

  async function cancel(): Promise<void> {
    if (!job) return;
    cancelling = true;
    if (cancelBtn) { cancelBtn.setAttribute("disabled", ""); cancelBtn.textContent = X.cancelling; }
    updateProgress();
    try { await exportApi.cancel(job.id); } catch (e) { error = (e as Error).message; }
  }

  // ¿Hay ya una exportación de este episodio en marcha (p. ej. se cerró la ventana)? Se reanuda su seguimiento.
  try {
    const l = await exportApi.list(o.projectId, o.episodeId);
    previous = l.files;
    const running = l.jobs.find((j) => j.state === "queued" || j.state === "running");
    if (running) { job = running; startedAt = Date.parse(running.createdAt); watch(); }
  } catch { /* sin listado: se muestra el formulario */ }
  render();
  queueMicrotask(() => (body.querySelector("[data-testid=export-start], [data-testid=export-cancel], [data-testid=export-download]") as HTMLElement | null)?.focus());
  return close;
}

