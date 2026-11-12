import type { ExportCapabilitiesDTO, ExportFileDTO, ExportJobDTO, ExportOptions, NewProject, Project } from "@gas/core";

export interface SummaryRow {
  summary?: { id: string; name: string; updatedAt: string; fps: number; seasons: number; episodes: number };
  error?: { id: string; message: string };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError("No hay conexión con el servidor del estudio", 0, "network");
  }
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const b = body as { message?: string; error?: string };
    throw new ApiError(b.message ?? `Error ${res.status}`, res.status, b.error ?? "unknown");
  }
  return body as T;
}

const json = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(data),
});

export const api = {
  list: () => request<{ projects: SummaryRow[] }>("/api/projects").then((r) => r.projects),
  create: (input: NewProject) => request<Project>("/api/projects", json("POST", input)),
  load: (id: string) => request<Project>(`/api/projects/${encodeURIComponent(id)}`),
  save: (p: Project) => request<Project>(`/api/projects/${encodeURIComponent(p.id)}`, json("PUT", p)),
};

import type { Animation } from "@gas/core";

const animUrl = (pid: string, eid: string) => `/api/projects/${encodeURIComponent(pid)}/episodes/${encodeURIComponent(eid)}/animation`;

export const animationApi = {
  load: (pid: string, eid: string) => request<Animation>(animUrl(pid, eid)),
  save: (pid: string, a: Animation) => request<{ revision: number }>(animUrl(pid, a.episodeId), json("PUT", a)),
  /** Envío al cerrar la pestaña: `keepalive` sobrevive a la descarga de la página (límite ~64 KB; si no cabe, queda el borrador local). */
  saveOnExit: (pid: string, a: Animation): boolean => {
    const body = JSON.stringify(a);
    if (body.length > 60_000) return false;
    void fetch(animUrl(pid, a.episodeId), { method: "PUT", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
    return true;
  },
};

export class ExportApiError extends ApiError {
  constructor(
    message: string,
    status: number,
    code: string,
    readonly suggestion?: string,
  ) {
    super(message, status, code);
  }
}

async function exportRequest<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ExportApiError("No hay conexión con el servidor del estudio", 0, "network");
  }
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const b = body as { message?: string; error?: string; suggestion?: string };
    throw new ExportApiError(b.message ?? `Error ${res.status}`, res.status, b.error ?? "unknown", b.suggestion);
  }
  return body as T;
}

const P = encodeURIComponent;

export const exportApi = {
  capabilities: () => exportRequest<ExportCapabilitiesDTO>("/api/export/capabilities"),
  start: (pid: string, eid: string, o: ExportOptions) => exportRequest<ExportJobDTO>(`/api/projects/${P(pid)}/episodes/${P(eid)}/exports`, json("POST", o)),
  job: (id: string) => exportRequest<ExportJobDTO>(`/api/exports/${P(id)}`),
  cancel: (id: string) => exportRequest<ExportJobDTO>(`/api/exports/${P(id)}/cancel`, { method: "POST" }),
  list: (pid: string, eid: string) => exportRequest<{ files: ExportFileDTO[]; jobs: ExportJobDTO[] }>(`/api/projects/${P(pid)}/exports?episode=${P(eid)}`),
  fileUrl: (pid: string, name: string, inline = false) => `/api/projects/${P(pid)}/exports/files/${P(name)}${inline ? "?inline=1" : ""}`,
};

/* ───────────── Biblioteca de personajes (Fase 4) ───────────── */
import type { CharacterMeta, CharacterSheet } from "@gas/core";

const charUrl = (id: string) => `/api/characters/${encodeURIComponent(id)}`;

export const characterApi = {
  list: (q = "", folder = "") => request<{ characters: CharacterMeta[]; folders: string[] }>(`/api/characters?${new URLSearchParams({ ...(q ? { q } : {}), ...(folder ? { folder } : {}) })}`),
  create: (name: string, folder?: string) => request<CharacterMeta>("/api/characters", json("POST", { name, ...(folder ? { folder } : {}) })),
  meta: (id: string) => request<CharacterMeta>(charUrl(id)),
  patch: (id: string, patch: { sheet?: CharacterSheet; folder?: string; tags?: string[]; thumbnail?: string | null }) => request<CharacterMeta>(charUrl(id), json("PATCH", patch)),
  remove: (id: string) => request<unknown>(charUrl(id), { method: "DELETE" }),
  duplicate: (id: string, name?: string) => request<CharacterMeta>(`${charUrl(id)}/duplicate`, json("POST", name ? { name } : {})),
  drawing: (id: string) => request<Animation>(`${charUrl(id)}/drawing`),
  saveDrawing: (a: Animation) => request<{ revision: number }>(`${charUrl(a.episodeId)}/drawing`, json("PUT", a)),
  saveDrawingOnExit: (a: Animation): boolean => {
    const body = JSON.stringify(a);
    if (body.length > 60_000) return false;
    void fetch(`${charUrl(a.episodeId)}/drawing`, { method: "PUT", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
    return true;
  },
  files: (id: string) => request<{ files: string[] }>(`${charUrl(id)}/files`).then((r) => r.files),
  fileUrl: (id: string, name: string) => `${charUrl(id)}/files/${encodeURIComponent(name)}`,
  putFile: (id: string, name: string, blob: Blob) => request<unknown>(`${charUrl(id)}/files/${encodeURIComponent(name)}`, { method: "PUT", headers: { "content-type": blob.type || "image/png" }, body: blob }),
  deleteFile: (id: string, name: string) => request<unknown>(`${charUrl(id)}/files/${encodeURIComponent(name)}`, { method: "DELETE" }),
};
